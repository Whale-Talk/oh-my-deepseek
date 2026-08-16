/**
 * `oh-my-deepseek/exa-search`: a keyless Exa search provider for `ctx.web`.
 *
 * Talks to Exa's public MCP endpoint (`https://mcp.exa.ai/mcp`) over JSON-RPC
 * `tools/call` with the `web_search_exa` tool — the same provider-independent
 * transport Nexus-Code and opencode use for web search. No API key is required,
 * so the model-facing `web_search` tool keeps working even when the DeepSeek
 * search route has no valid key.
 *
 * Unlike `@deepseek-ai/dsh-web-search-exa` (which requires `EXA_API_KEY` and
 * speaks the REST `api.exa.ai/search` API), this provider registers into the
 * same `ctx.web` seam but implements the keyless MCP flavor.
 *
 * @module oh-my-deepseek/exa-search
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'exa-search'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Stable id this provider registers under; matches the `web.searchProvider` pin. */
export const EXA_MCP_PROVIDER_ID = 'exa'

/** Default keyless Exa MCP endpoint. */
export const EXA_MCP_DEFAULT_BASE_URL = 'https://mcp.exa.ai/mcp'

/** Default Exa MCP tool invoked over `tools/call`. */
export const EXA_MCP_DEFAULT_TOOL = 'web_search_exa'

/** Attribution header sent on every request. */
const USER_AGENT = 'oh-my-deepseek/0.1.0'

/** Snippet ceiling so one result cannot flood the model-visible search result. */
const SNIPPET_MAX_CHARS = 500

/** Plugin config (all optional — `apply` fills constant defaults). */
export interface Config {
  /** MCP endpoint base; defaults to the keyless `mcp.exa.ai`. */
  baseURL?: string
  /** Exa MCP tool name; defaults to `web_search_exa`. */
  toolName?: string
  /** Default result count when a request carries no `maxResults`. */
  numResults?: number
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
  toolName: z.string(),
  numResults: z.number().step(1).min(1),
})

/** Resolved provider options (the plugin's `apply` supplies constant defaults). */
export interface ExaMcpProviderOptions {
  baseURL: string
  toolName: string
  numResults?: number
}

/** Register the keyless Exa MCP provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new ExaMcpProvider({
    baseURL: config.baseURL ?? EXA_MCP_DEFAULT_BASE_URL,
    toolName: config.toolName ?? EXA_MCP_DEFAULT_TOOL,
    ...config.numResults !== undefined ? { numResults: config.numResults } : {},
  }))
}

/** The keyless Exa MCP search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class ExaMcpProvider implements WebSearchProvider {
  readonly id = EXA_MCP_PROVIDER_ID

  constructor(private readonly options: ExaMcpProviderOptions) {}

  available(): boolean {
    return URL.canParse(this.options.baseURL)
      && (this.options.numResults === undefined || isPositiveInteger(this.options.numResults))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // A per-request bound wins over the configured default; either may be absent.
    const numResults = request.maxResults ?? this.options.numResults
    let response: Response
    try {
      response = await fetch(this.options.baseURL, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: this.options.toolName,
            arguments: {
              query: request.query,
              ...numResults !== undefined ? { numResults } : {},
            },
          },
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Exa MCP search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Exa MCP search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Exa MCP API error (HTTP ${status})`
      try {
        const body = await response.text()
        if (body.trim().length > 0) message = body.trim().slice(0, 400)
      } catch (error: unknown) {
        if (isAbortError(error)) throw new WebError('Exa MCP search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    const body = await response.text()
    const sources = parseMcpResponse(body)
    if (sources.length === 0) {
      throw new WebError('Exa MCP returned no search results', 'WEB_PROVIDER_ERROR')
    }
    return { sources, truncated: false }
  }
}

/**
 * Parse an Exa MCP `tools/call` response body into normalized sources. The
 * response is typically an SSE stream (`event: message` / `data: {…}`) carrying
 * JSON-RPC result blocks whose `content[]` text entries hold "Title:/URL:/
 * Highlights:" records; a non-streamed JSON body is also accepted as a fallback.
 *
 * @param body - the raw response text.
 * @returns the mapped sources.
 * @throws {@link WebError} when the JSON-RPC layer reports an error and no
 *   source text arrived.
 */
export function parseMcpResponse(body: string): WebSearchSource[] {
  const texts: string[] = []
  const errors: string[] = []
  let sawData = false
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    sawData = true
    const payload = trimmed.slice(5).trim()
    if (payload === '' || payload === '[DONE]') continue
    try {
      collectMcpTexts(JSON.parse(payload), texts, errors)
    } catch {
      // Skip non-JSON data lines.
    }
  }
  if (!sawData) {
    try {
      collectMcpTexts(JSON.parse(body), texts, errors)
    } catch {
      // Not a JSON body either; sources stay empty.
    }
  }
  if (texts.length === 0 && errors.length > 0) {
    throw new WebError(`Exa MCP tool error: ${errors.join('; ').slice(0, 400)}`, 'WEB_PROVIDER_ERROR')
  }
  const sources: WebSearchSource[] = []
  for (const text of texts) {
    sources.push(...parseExaTextBlock(text))
  }
  return sources.filter((source): source is WebSearchSource => source !== undefined)
}

/**
 * Walk an MCP response node, collecting `{type:'text', text}` blocks and any
 * JSON-RPC `error`/`isError` diagnostics.
 */
function collectMcpTexts(node: unknown, texts: string[], errors: string[]): void {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectMcpTexts(item, texts, errors)
    return
  }
  const obj = node as Record<string, unknown>
  if (obj.type === 'text' && typeof obj.text === 'string') {
    texts.push(obj.text)
    return
  }
  if (obj.error !== undefined && typeof obj.error !== 'object') {
    if (typeof obj.error === 'string') errors.push(obj.error)
  } else if (obj.error !== null && typeof obj.error === 'object') {
    const message = (obj.error as Record<string, unknown>).message
    if (typeof message === 'string') errors.push(message)
  }
  if (obj.isError === true && typeof obj.text === 'string') {
    errors.push(obj.text)
  }
  for (const value of Object.values(obj)) collectMcpTexts(value, texts, errors)
}

/**
 * Split one Exa MCP text block into per-result entries. Entries begin with a
 * `Title:` line and are delimited by `---` separator lines.
 */
function parseExaTextBlock(text: string): (WebSearchSource | undefined)[] {
  const entries: string[][] = []
  let current: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '---') {
      if (current.length > 0) { entries.push(current); current = [] }
      continue
    }
    if (/^Title:\s*/i.test(line) && current.length > 0) {
      entries.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) entries.push(current)
  return entries.map(parseExaEntry)
}

/** Map one `Title:/URL:/Published:/Author:/Highlights:` entry to a source. */
function parseExaEntry(lines: readonly string[]): WebSearchSource | undefined {
  let title: string | undefined
  let url: string | undefined
  let published: string | undefined
  let inHighlights = false
  const highlightLines: string[] = []
  for (const line of lines) {
    const titleMatch = /^Title:\s*(.*)$/i.exec(line)
    const urlMatch = /^URL:\s*(.*)$/i.exec(line)
    const publishedMatch = /^Published:\s*(.*)$/i.exec(line)
    const authorMatch = /^Author:\s*.*$/i.exec(line)
    if (/^Highlights:\s*$/i.test(line)) { inHighlights = true; continue }
    if (titleMatch !== null) { title = titleMatch[1].trim(); inHighlights = false; continue }
    if (urlMatch !== null) { url = urlMatch[1].trim(); inHighlights = false; continue }
    if (publishedMatch !== null) { published = publishedMatch[1].trim(); inHighlights = false; continue }
    if (authorMatch !== null) { inHighlights = false; continue }
    if (inHighlights && line.trim().length > 0) highlightLines.push(line.trim())
  }
  if (url === undefined || url === '') return undefined
  const snippet = highlightLines.join(' ').trim()
  return {
    url,
    ...title !== undefined && title !== '' ? { title } : {},
    ...snippet !== '' ? { snippet: snippet.slice(0, SNIPPET_MAX_CHARS) } : {},
    ...published !== undefined && published !== '' && published !== 'N/A' ? { publishedAt: published } : {},
  }
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for a request limit that can be sent to Exa (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
