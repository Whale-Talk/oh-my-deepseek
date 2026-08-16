import { describe, expect, it } from 'vitest'
import { RALPLAN_META, RALPLAN_SCRIPT, TEAM_META, TEAM_SCRIPT } from '../src/scripts.ts'
import { loadAllRoles } from '../src/roles.ts'

const PLACEHOLDER_ROLES = {
  planner: 'PLANNER-ROLE',
  architect: 'ARCHITECT-ROLE',
  critic: 'CRITIC-ROLE',
  executor: 'EXECUTOR-ROLE',
  verifier: 'VERIFIER-ROLE',
}

/** Wrap a fixed workflow script as an async function with injected engine hooks. */
function runWorkflow(
  script: string,
  hooks: { agent?: Function; phase?: Function; parallel?: Function } = {},
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const agent = hooks.agent ?? (async () => null)
  const phase = hooks.phase ?? (() => {})
  const parallel = hooks.parallel ?? ((thunks: Function[]) => Promise.all(thunks.map((t) => t())))
  const mergedArgs = { roles: PLACEHOLDER_ROLES, ...args }
  const fn = new Function('agent', 'phase', 'parallel', 'args', `return (async () => { ${script}\n})()`)
  return fn(agent, phase, parallel, mergedArgs)
}

/** Assert a script body parses as valid JS. */
function expectValidScript(script: string): void {
  expect(() => new Function('args', 'agent', 'phase', 'parallel', `return (async () => { ${script}\n})`)).not.toThrow()
}

describe('workflow script syntax', () => {
  it('ralplan script is valid JS', () => {
    expectValidScript(RALPLAN_SCRIPT)
  })

  it('team script is valid JS', () => {
    expectValidScript(TEAM_SCRIPT)
  })
})

describe('metadata', () => {
  it('ralplan meta is kebab-case and named', () => {
    expect(RALPLAN_META.name).toBe('ralplan-consensus')
    expect(RALPLAN_META.phases.map((p) => p.title)).toEqual(['planning', 'review'])
  })

  it('team meta declares the staged pipeline phases', () => {
    expect(TEAM_META.name).toBe('team-staged-pipeline')
    expect(TEAM_META.phases.map((p) => p.title)).toEqual(['team-plan', 'team-exec', 'team-verify'])
  })
})

describe('ralplan consensus loop', () => {
  interface RalplanAgent {
    calls: { label: string; prompt: string }[]
    agent: (prompt: string, opts: { label: string }) => Promise<unknown>
  }

  function makeRalplanAgent(verdicts: Array<'APPROVE' | 'ITERATE' | 'REJECT'>): RalplanAgent {
    const calls: { label: string; prompt: string }[] = []
    let criticRound = 0
    return {
      calls,
      agent: async (prompt: string, opts: { label: string }) => {
        calls.push({ label: opts.label, prompt })
        if (opts.label === 'Planner') {
          return { title: 'T', goal: 'G', steps: [{ id: '1', action: 'do' }] }
        }
        if (opts.label.startsWith('Architect')) return 'architect-feedback'
        if (opts.label.startsWith('Critic')) {
          criticRound += 1
          return { verdict: verdicts[criticRound - 1], summary: 's', concerns: ['c'] }
        }
        // Planner revision
        return { title: 'T2', goal: 'G', steps: [{ id: '1', action: 'do better' }] }
      },
    }
  }

  it('approves on the first round in Planner→Architect→Critic order', async () => {
    const { calls, agent } = makeRalplanAgent(['APPROVE'])
    const result = (await runWorkflow(RALPLAN_SCRIPT, { agent }, { objective: 'x', maxIterations: 5 })) as Record<string, unknown>
    expect(result.approved).toBe(true)
    expect(result.rounds).toBe(1)
    expect(calls.map((c) => c.label)).toEqual(['Planner', 'Architect r1', 'Critic r1'])
  })

  it('iterates and revises until approval, without leaking Architect feedback to Critic', async () => {
    const { calls, agent } = makeRalplanAgent(['ITERATE', 'APPROVE'])
    const result = (await runWorkflow(RALPLAN_SCRIPT, { agent }, { objective: 'x', maxIterations: 5 })) as Record<string, unknown>
    expect(result.approved).toBe(true)
    expect(result.rounds).toBe(2)
    // Critic reviews the same fixed snapshot; Architect's prose must never reach it.
    for (const c of calls.filter((c) => c.label.startsWith('Critic'))) {
      expect(c.prompt).not.toContain('architect-feedback')
    }
    // Only Planner synthesizes both reviews.
    const revision = calls.find((c) => c.label === 'Planner r1')
    expect(revision?.prompt).toContain('architect-feedback')
  })

  it('stops unapproved at the iteration cap', async () => {
    const { agent } = makeRalplanAgent(['ITERATE', 'ITERATE'])
    const result = (await runWorkflow(RALPLAN_SCRIPT, { agent }, { objective: 'x', maxIterations: 2 })) as Record<string, unknown>
    expect(result.approved).toBe(false)
    expect(result.rounds).toBe(2)
  })

  it('fails when the Planner produces no plan', async () => {
    const result = (await runWorkflow(RALPLAN_SCRIPT, { agent: async () => null }, { objective: 'x', maxIterations: 5 })) as Record<string, unknown>
    expect(result.approved).toBe(false)
    expect(result.error).toBe('Planner failed to produce a plan')
  })

  it('injects the full role prompts into Planner, Architect, and Critic', async () => {
    const roles = loadAllRoles()
    const { calls, agent } = makeRalplanAgent(['APPROVE'])
    await runWorkflow(RALPLAN_SCRIPT, { agent }, {
      objective: 'x',
      maxIterations: 1,
      roles: { planner: roles.planner, architect: roles.architect, critic: roles.critic },
    })
    expect(calls.find((c) => c.label === 'Planner')?.prompt).toContain('You are Planner')
    expect(calls.find((c) => c.label === 'Architect r1')?.prompt).toContain('You are Architect')
    expect(calls.find((c) => c.label === 'Critic r1')?.prompt).toContain('final quality gate')
  })

  it('instructs critic and architect to stay read-only', async () => {
    const roles = loadAllRoles()
    const { calls, agent } = makeRalplanAgent(['APPROVE'])
    await runWorkflow(RALPLAN_SCRIPT, { agent }, {
      objective: 'x',
      maxIterations: 1,
      roles: { planner: roles.planner, architect: roles.architect, critic: roles.critic },
    })
    expect(calls.find((c) => c.label === 'Architect r1')?.prompt).toContain('READ-ONLY')
    expect(calls.find((c) => c.label === 'Critic r1')?.prompt).toContain('READ-ONLY')
  })
})

describe('team staged pipeline', () => {
  function makeTeamAgent(verdicts: Array<{ pass: boolean; findings: string[]; modifiedFiles?: string[] }>) {
    const calls: { label: string; prompt: string }[] = []
    let verifyRound = 0
    return {
      calls,
      agent: async (prompt: string, opts: { label: string }) => {
        calls.push({ label: opts.label, prompt })
        if (opts.label === 'team-plan') {
          return {
            subtasks: [
              { id: 'a', title: 'A', details: 'do A', acceptance: ['A ok'] },
              { id: 'b', title: 'B', details: 'do B', acceptance: ['B ok'] },
            ],
          }
        }
        if (opts.label.startsWith('exec:')) return 'done ' + opts.label
        if (opts.label === 'team-verify') {
          verifyRound += 1
          const v = verdicts[verifyRound - 1]
          return { ...v, modifiedFiles: v.modifiedFiles ?? [] }
        }
        return null
      },
    }
  }

  it('executes subtasks in parallel and completes when verified', async () => {
    let parallelCount = 0
    let thunkCount = 0
    const { calls, agent } = makeTeamAgent([{ pass: true, findings: [] }])
    const parallel = async (thunks: Function[]) => {
      parallelCount += 1
      thunkCount = thunks.length
      return Promise.all(thunks.map((t) => t()))
    }
    const result = (await runWorkflow(TEAM_SCRIPT, { agent, parallel }, { objective: 'x', maxIterations: 3, maxSubtasks: 12 })) as Record<string, unknown>
    expect(result.status).toBe('complete')
    expect(result.subtasks).toBe(2)
    expect(result.rounds).toBe(1)
    expect(parallelCount).toBe(1)
    expect(thunkCount).toBe(2)
    expect(calls.filter((c) => c.label.startsWith('exec:')).map((c) => c.label)).toEqual(['exec:a', 'exec:b'])
  })

  it('loops on findings and feeds them to the next executor round', async () => {
    const { calls, agent } = makeTeamAgent([
      { pass: false, findings: ['fix this'] },
      { pass: true, findings: [] },
    ])
    const result = (await runWorkflow(TEAM_SCRIPT, { agent }, { objective: 'x', maxIterations: 3, maxSubtasks: 12 })) as Record<string, unknown>
    expect(result.status).toBe('complete')
    expect(result.rounds).toBe(2)
    const round2Exec = calls.find((c) => c.label === 'exec:a' && calls.filter((x) => x.label === 'exec:a').length > 1)
    // The second round's executor prompt must carry the prior findings.
    const secondExec = calls.filter((c) => c.label.startsWith('exec:')).slice(2)[0]
    expect(secondExec?.prompt).toContain('fix this')
    void round2Exec
  })

  it('reports budget-limited when verification never passes', async () => {
    const { agent } = makeTeamAgent([
      { pass: false, findings: ['a'] },
      { pass: false, findings: ['b'] },
    ])
    const result = (await runWorkflow(TEAM_SCRIPT, { agent }, { objective: 'x', maxIterations: 2, maxSubtasks: 12 })) as Record<string, unknown>
    expect(result.status).toBe('budget-limited')
    expect(result.rounds).toBe(2)
    expect(result.findings).toEqual(['b'])
  })

  it('fails when the lead produces no plan', async () => {
    const result = (await runWorkflow(TEAM_SCRIPT, { agent: async () => null }, { objective: 'x', maxIterations: 3, maxSubtasks: 12 })) as Record<string, unknown>
    expect(result.status).toBe('error')
    expect(result.error).toBe('Team plan failed')
  })

  it('injects the full role prompts into Lead, Executor, and Verifier', async () => {
    const roles = loadAllRoles()
    const { calls, agent } = makeTeamAgent([{ pass: true, findings: [] }])
    await runWorkflow(TEAM_SCRIPT, { agent }, {
      objective: 'x',
      maxIterations: 1,
      maxSubtasks: 12,
      roles: { planner: roles.planner, executor: roles.executor, verifier: roles.verifier },
    })
    expect(calls.find((c) => c.label === 'team-plan')?.prompt).toContain('You are Planner')
    expect(calls.find((c) => c.label === 'exec:a')?.prompt).toContain('You are Executor')
    expect(calls.find((c) => c.label === 'team-verify')?.prompt).toContain('You are Verifier')
  })

  it('tells the verifier it is read-only and surfaces its modifiedFiles', async () => {
    const roles = loadAllRoles()
    const { calls, agent } = makeTeamAgent([{ pass: true, findings: [], modifiedFiles: ['src/sneaky.ts'] }])
    const result = (await runWorkflow(TEAM_SCRIPT, { agent }, {
      objective: 'x',
      maxIterations: 1,
      maxSubtasks: 12,
      roles: { planner: roles.planner, executor: roles.executor, verifier: roles.verifier },
    })) as Record<string, unknown>
    const verifyPrompt = calls.find((c) => c.label === 'team-verify')?.prompt ?? ''
    expect(verifyPrompt).toContain('READ-ONLY')
    expect(verifyPrompt).toContain('modifiedFiles')
    expect(result.verifierModifiedFiles).toEqual(['src/sneaky.ts'])
  })
})
