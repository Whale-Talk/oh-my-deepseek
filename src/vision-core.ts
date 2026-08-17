/**
 * Pure helpers for the vision plugin, extracted into a dependency-free module
 * so they can be unit-tested without loading the `@deepseek-ai/*` packages
 * (which are not published to npm yet). The plugin module (`vision.ts`) and the
 * tests both import from here.
 * @module oh-my-deepseek/vision-core
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** Max chars of the returned description, to bound model-visible output. */
export const VISION_MAX_DESCRIPTION_CHARS = 2000

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

/** Clip a description to the max visible length with a truncation notice. */
export function clipDescription(description: string): string {
  return description.length > VISION_MAX_DESCRIPTION_CHARS
    ? `${description.slice(0, VISION_MAX_DESCRIPTION_CHARS)}\n… [truncated]`
    : description
}
