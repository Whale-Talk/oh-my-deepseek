import { describe, expect, it } from 'vitest'
import { diffGitStatus, parseGitStatus, renderJson, requireFreshProvider, resolveBounded, workflowStopError } from '../src/shared.ts'

describe('workflowStopError', () => {
  it('returns undefined for a completed run', () => {
    expect(workflowStopError({ stopReason: 'completed' } as never)).toBeUndefined()
  })

  it('reports a cancellation without an error', () => {
    expect(workflowStopError({ stopReason: 'cancelled' } as never)).toBe('workflow run was cancelled')
  })

  it('reports a cancellation with its error', () => {
    expect(workflowStopError({ stopReason: 'cancelled', error: 'boom' } as never)).toBe('workflow run was cancelled (boom)')
  })

  it('reports an error with a fallback message when absent', () => {
    expect(workflowStopError({ stopReason: 'error' } as never)).toBe('workflow run failed: unknown error')
  })

  it('reports an error with its message', () => {
    expect(workflowStopError({ stopReason: 'error', error: 'kaput' } as never)).toBe('workflow run failed: kaput')
  })

  it('fails loud on an unknown stop reason', () => {
    const unknown = { stopReason: 'future-variant' } as never
    expect(workflowStopError(unknown)).toMatch(/^workflow run ended abnormally/)
  })
})

describe('resolveBounded', () => {
  it('accepts a value within the ceiling', () => {
    expect(resolveBounded(3, 5)).toBe(3)
  })

  it('falls back to the ceiling when omitted', () => {
    expect(resolveBounded(undefined, 5)).toBe(5)
  })

  it('rejects a value above the ceiling', () => {
    expect(() => resolveBounded(6, 5)).toThrow(/exceeds the deployment ceiling/)
  })

  it('rejects a non-positive value', () => {
    expect(() => resolveBounded(0, 5)).toThrow(/positive safe integer/)
  })

  it('rejects a non-integer value', () => {
    expect(() => resolveBounded(1.5, 5)).toThrow(/positive safe integer/)
  })

  it('rejects NaN', () => {
    expect(() => resolveBounded(Number.NaN, 5)).toThrow(/positive safe integer/)
  })
})

describe('renderJson', () => {
  it('pretty-prints a plain object', () => {
    expect(renderJson({ a: 1 }, 1000)).toBe(JSON.stringify({ a: 1 }, null, 2))
  })

  it('truncates oversized output with a notice', () => {
    const out = renderJson({ long: 'x'.repeat(200) }, 50)
    expect(out.length).toBeLessThanOrEqual(50)
    expect(out).toContain('[truncated]')
  })

  it('clamps when maxChars is smaller than the truncation notice itself', () => {
    const out = renderJson({ long: 'x'.repeat(100) }, 3)
    expect(out.length).toBeLessThanOrEqual(3)
  })

  it('renders undefined as null', () => {
    expect(renderJson(undefined, 100)).toBe('null')
  })

  it('falls back to String() for unserializable values', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(renderJson(circular, 100)).toBe('[object Object]')
  })
})

describe('requireFreshProvider', () => {
  const fresh = {
    capabilities: { outputSchema: true, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
  }

  const ctxWith = (provider: unknown): never => ({ subagents: { getProvider: () => provider } }) as never

  it('returns a valid fresh structured provider', () => {
    expect(requireFreshProvider(ctxWith(fresh), 'spawn')).toBe(fresh)
  })

  it('rejects an unregistered provider', () => {
    expect(() => requireFreshProvider(ctxWith(undefined), 'missing')).toThrow(/not registered/)
  })

  it('rejects a provider without structured output', () => {
    const noSchema = { ...fresh, capabilities: { ...fresh.capabilities, outputSchema: false } }
    expect(() => requireFreshProvider(ctxWith(noSchema), 'x')).toThrow(/structured output/)
  })

  it('rejects a provider that inherits parent context', () => {
    const inheriting = { ...fresh, inheritsParentContext: true }
    expect(() => requireFreshProvider(ctxWith(inheriting), 'x')).toThrow(/fresh provider/)
  })
})

describe('parseGitStatus', () => {
  it('returns an empty map for blank output', () => {
    expect(parseGitStatus('')).toEqual(new Map())
    expect(parseGitStatus('  \n  ')).toEqual(new Map())
  })

  it('maps paths to status codes', () => {
    const map = parseGitStatus(' M src/a.ts\n?? new.ts\nA  added.ts\nD  deleted.ts')
    expect(map.get('src/a.ts')).toBe(' M')
    expect(map.get('new.ts')).toBe('??')
    expect(map.get('added.ts')).toBe('A ')
    expect(map.get('deleted.ts')).toBe('D ')
  })

  it('tracks the destination path of a rename', () => {
    const map = parseGitStatus('R  old.ts -> new.ts')
    expect(map.get('new.ts')).toBe('R ')
    expect(map.has('old.ts -> new.ts')).toBe(false)
  })

  it('skips lines too short to carry a status and path', () => {
    const map = parseGitStatus(' M src/a.ts\n\nX\n M src/b.ts')
    expect(map.size).toBe(2)
  })
})

describe('diffGitStatus', () => {
  it('detects files that appeared between snapshots', () => {
    expect(diffGitStatus('', ' M src/a.ts\n?? b.ts')).toEqual(['b.ts', 'src/a.ts'])
  })

  it('detects a status change on an existing path', () => {
    expect(diffGitStatus(' M src/a.ts', 'MM src/a.ts')).toEqual(['src/a.ts'])
  })

  it('returns nothing when snapshots are equal', () => {
    expect(diffGitStatus(' M src/a.ts\n?? b.ts', ' M src/a.ts\n?? b.ts')).toEqual([])
  })

  it('ignores files that were already dirty and unchanged', () => {
    expect(diffGitStatus(' M src/a.ts', ' M src/a.ts\n M src/b.ts')).toEqual(['src/b.ts'])
  })
})
