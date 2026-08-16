/**
 * Shared helpers for the oh-my-deepseek orchestration plugins. Both plugins are
 * fixed Cordis tools over `ctx.workflowEngine` + `ctx.subagents`, mirroring the
 * in-box `@deepseek-ai/dsh-tool-ralph` pattern: the model supplies data, the
 * plugin owns the loop.
 * @module oh-my-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import type { WorkflowResult } from '@deepseek-ai/dsh-workflow'

/**
 * Require the configured route to be a genuinely fresh, structured-output child
 * provider. The fixed scripts need `outputSchema` (structured plan/verdict
 * capture) and must NOT inherit the parent conversation, or cross-round state
 * would leak the orchestrator's context into every worker.
 */
export function requireFreshProvider(ctx: Context, name: string): SubagentProvider {
  const provider = ctx.subagents.getProvider(name)
  if (provider === undefined) {
    throw new Error(`subagent provider "${name}" is not registered`)
  }
  if (!provider.capabilities.outputSchema) {
    throw new Error(`subagent provider "${name}" does not support structured output`)
  }
  if (provider.inheritsParentContext) {
    throw new Error(`subagent provider "${name}" inherits parent context; orchestration requires a fresh provider`)
  }
  return provider
}

/** Map a non-clean workflow finish to an error message; `undefined` for completed. */
export function workflowStopError(result: WorkflowResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'cancelled':
      return `workflow run was cancelled${result.error === undefined ? '' : ` (${result.error})`}`
    case 'error':
      return `workflow run failed: ${result.error ?? 'unknown error'}`
    /* v8 ignore start -- defensive: WorkflowStopReason is closed; a future variant fails loud here. */
    default:
      return `workflow run ended abnormally (${String(result.stopReason satisfies never)})`
    /* v8 ignore stop */
  }
}

/** Resolve one model-selected positive integer against a deployment ceiling. */
export function resolveBounded(requested: number | undefined, ceiling: number): number {
  const value = requested ?? ceiling
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('value must be a positive safe integer')
  }
  if (value > ceiling) {
    throw new TypeError(`value ${value} exceeds the deployment ceiling ${ceiling}`)
  }
  return value
}

const TRUNCATION_NOTICE = '\n… [truncated]'

/** Pretty-print a JSON value, capped to `maxChars` with a truncation notice. */
export function renderJson(value: unknown, maxChars: number): string {
  let rendered: string
  try {
    rendered = JSON.stringify(value, null, 2) ?? 'null'
  } catch {
    rendered = String(value)
  }
  if (rendered.length <= maxChars) return rendered
  if (maxChars <= TRUNCATION_NOTICE.length) return TRUNCATION_NOTICE.slice(0, maxChars)
  return `${rendered.slice(0, maxChars - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}`
}

/**
 * Parse `git status --porcelain` output into a path → status-code map. Rename
 * entries keep the destination path. Empty or blank output yields an empty map.
 */
export function parseGitStatus(porcelain: string): Map<string, string> {
  const map = new Map<string, string>()
  if (porcelain.trim() === '') return map
  for (const line of porcelain.split('\n')) {
    const entry = line.trimEnd()
    if (entry.length < 3) continue
    const status = entry.slice(0, 2)
    let path = entry.slice(3)
    // Renames render as "old -> new"; track the destination only.
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4)
    map.set(path, status)
  }
  return map
}

/**
 * Return the file paths whose git status appeared or changed between two
 * `--porcelain` snapshots, sorted. A path absent from `before` is treated as
 * clean, so any status in `after` counts as a change.
 */
export function diffGitStatus(before: string, after: string): string[] {
  const beforeMap = parseGitStatus(before)
  const afterMap = parseGitStatus(after)
  const changed: string[] = []
  for (const [path, status] of afterMap) {
    if (beforeMap.get(path) !== status) changed.push(path)
  }
  return changed.sort()
}
