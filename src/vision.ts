/**
 * `oh-my-deepseek/vision`: free multimodal vision for DeepSeek Harness.
 *
 * DeepSeek is a text-only model, so images (screenshots, error shots, UI
 * mockups, diagrams) are invisible to it. This plugin gives the agent an
 * `understand_image` tool that sends an image to the free Zhipu GLM-4V-Flash
 * API (OpenAI-compatible `chat/completions`) and returns a text description —
 * the same "give DeepSeek eyes" pattern used by several community projects,
 * implemented natively as a DSH tool.
 *
 * The image may be a local file path (read + base64 → data URI), an http(s)
 * URL (passed through), or an already-encoded data URI.
 *
 * @module oh-my-deepseek/vision
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export const name = 'vision'
export const inject = ['tools']

/** Default Zhipu OpenAI-compatible endpoint (free GLM-4V-Flash). */
export const VISION_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'

/** The free vision model id. */
export const VISION_DEFAULT_MODEL = 'glm-4v-flash'

/** Max chars of the returned description, to bound model-visible output. */
export const VISION_MAX_DESCRIPTION_CHARS = 2000

/** Plugin config: all optional; `apply` fills constant defaults. */
export interface Config {
  /** Model-facing tool name (default `understand_image`). */
  toolName?: string
  /** Zhipu OpenAI-compatible base URL (default `VISION_DEFAULT_BASE_URL`). */
  baseURL?: string
  /** Vision model id (default `glm-4v-flash`). */
  model?: string
  /** API key env var (default `ZHIPU_API_KEY`). */
  apiKeyEnv?: string
}

export const Config: z<Config> = z.object({
  toolName: z.string().default('understand_image'),
  baseURL: z.string().default(VISION_DEFAULT_BASE_URL),
  model: z.string().default(VISION_DEFAULT_MODEL),
  apiKeyEnv: z.string().default('ZHIPU_API_KEY'),
})

interface ResolvedConfig {
  readonly toolName: string
  readonly baseURL: string
  readonly model: string
  readonly apiKeyEnv: string
}

function resolveConfig(config: Config): ResolvedConfig {
  const toolName = config.toolName ?? 'understand_image'
  const baseURL = config.baseURL ?? VISION_DEFAULT_BASE_URL
  const model = config.model ?? VISION_DEFAULT_MODEL
  const apiKeyEnv = config.apiKeyEnv ?? 'ZHIPU_API_KEY'
  if (toolName.length === 0 || toolName !== toolName.trim()) {
    throw new TypeError('toolName must be a non-empty normalized string')
  }
  if (!URL.canParse(baseURL)) throw new TypeError('baseURL must be a valid URL')
  if (model.length === 0) throw new TypeError('model must be a non-empty string')
  if (apiKeyEnv.length === 0 || apiKeyEnv !== apiKeyEnv.trim()) {
    throw new TypeError('apiKeyEnv must be a non-empty normalized string')
  }
  return { toolName, baseURL, model, apiKeyEnv }
}

/** Infer a mime type from a file extension; falls back to application/octet-stream. */
function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

/**
 * Resolve an image input to a data URI or pass-through URL.
 * - `data:` → used as-is
 * - `http(s)://` → used as-is
 * - relative or absolute path → read + base64 → data URI
 * @throws when the file cannot be read.
 */
export async function resolveImageInput(input: string, cwd: string | undefined): Promise<string> {
  if (input.startsWith('data:') || /^https?:\/\//i.test(input)) return input
  const path = isAbsolute(input) ? input : (cwd !== undefined ? join(cwd, input) : input)
  const mime = mimeFromPath(path)
  const data = await readFile(path)
  return `data:${mime};base64,${data.toString('base64')}`
}

interface ChatResponse {
  choices?: { message?: { content?: unknown } }[]
  error?: { message?: string; code?: string }
}

/** Extract the assistant text from a chat/completions response. */
export function extractDescription(payload: ChatResponse): string {
  if (payload.error !== undefined) {
    throw new Error(`GLM vision API error: ${payload.error.message ?? 'unknown'}${payload.error.code ? ` (${payload.error.code})` : ''}`)
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim().length > 0) return content
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { type: 'text'; text: string } => typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text' && typeof (part as { text?: unknown }).text === 'string')
      .map(part => part.text)
      .join('\n')
    if (text.trim().length > 0) return text
  }
  throw new Error('GLM vision API returned no text description')
}

const DESCRIPTION = 'Understand an image with the free GLM-4V-Flash vision model and return a text description. '
  + 'Use when the user references an image — a screenshot, an error dialog, a UI mockup, a diagram, a chart, or a photo — '
  + 'and you need to see it. Pass a local file path (read from the workspace), an http(s) URL, or a data URI. '
  + 'Note: the image is sent to the Zhipu GLM API for vision understanding.'

type VisionArgs = {
  image: string
  question?: string
}

function presentCall(args: VisionArgs): ToolCallView {
  return { card: 'generic', title: 'understand_image', rawInput: args.image }
}

function presentResult(args: VisionArgs, result: { content: ContentBlock[]; isError: boolean }): ToolResultView {
  void args
  void result
  return { card: 'generic' }
}

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.tools.register(defineTool({
    name: resolved.toolName,
    description: DESCRIPTION,
    parameters: {
      image: {
        type: 'string',
        required: true,
        description: 'Image path (workspace-relative or absolute), http(s) URL, or data URI.',
      },
      question: {
        type: 'string',
        description: 'Optional question about the image; omitted → general description.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: (value as { description: string }).description,
      }],
    },
    async execute(args, exec) {
      const apiKey = process.env[resolved.apiKeyEnv]
      if (apiKey === undefined || apiKey.trim() === '') {
        throw new Error(`vision tool requires ${resolved.apiKeyEnv} to be set (Zhipu GLM-4V-Flash free API key)`)
      }
      const cwd = exec.agent?.session.header.cwd
      const image = await resolveImageInput(args.image, cwd)

      const content: Array<Record<string, unknown>> = [
        { type: 'image_url', image_url: { url: image } },
        {
          type: 'text',
          text: args.question !== undefined && args.question.trim() !== ''
            ? args.question
            : 'Describe this image in detail: what is shown, any visible text, layout, and notable elements.',
        },
      ]

      const response = await fetch(`${resolved.baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: resolved.model,
          messages: [{ role: 'user', content }],
        }),
        signal: exec.signal,
      })

      if (!response.ok) {
        const status = response.status
        let message = `GLM vision API error (HTTP ${status})`
        try {
          const body = await response.text()
          if (body.trim().length > 0) message = body.trim().slice(0, 400)
        } catch {
          // Keep the HTTP-status fallback.
        }
        throw new Error(message)
      }

      const payload = (await response.json()) as ChatResponse
      const description = extractDescription(payload)
      const clipped = description.length > VISION_MAX_DESCRIPTION_CHARS
        ? `${description.slice(0, VISION_MAX_DESCRIPTION_CHARS)}\n… [truncated]`
        : description
      return { description: clipped }
    },
    presentCall,
    presentResult,
  }))
}
