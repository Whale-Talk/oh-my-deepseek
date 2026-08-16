/**
 * Fixed orchestration scripts and their metadata, extracted from the plugin
 * modules so the core loop logic can be unit-tested without loading the
 * DeepSeek Harness packages (schemastery, dsh-tools, ...). The scripts are plain
 * JS bodies executed by `ctx.workflowEngine`; `agent`, `phase`, `parallel`, and
 * `args` are injected by the engine, not imported here.
 * @module oh-my-deepseek/scripts
 */

/** Identity block for the ralplan consensus workflow. */
export const RALPLAN_META = {
  name: 'ralplan-consensus',
  description: 'Planner → Architect → Critic consensus planning until approval or the round cap.',
  phases: [
    { title: 'planning', detail: 'Planner drafts and revises the plan snapshot.' },
    { title: 'review', detail: 'Architect then Critic review the same fixed snapshot.' },
  ],
} as const

/** Identity block for the team staged pipeline. */
export const TEAM_META = {
  name: 'team-staged-pipeline',
  description: 'Decompose, execute subtasks in parallel, verify, and fix until passing.',
  phases: [
    { title: 'team-plan', detail: 'Lead decomposes the objective into subtasks.' },
    { title: 'team-exec', detail: 'Executors complete subtasks in parallel.' },
    { title: 'team-verify', detail: 'Verifier checks acceptance criteria.' },
  ],
} as const

/**
 * Fixed ralplan consensus loop. The model supplies data only; it cannot alter
 * the loop, reviewer ordering, schemas, or the rule that only the Planner
 * synthesizes the two reviews.
 */
export const RALPLAN_SCRIPT = String.raw`
const planSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    goal: { type: 'string' },
    successCriteria: { type: 'array', items: { type: 'string' } },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          action: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['id', 'action'],
        additionalProperties: false,
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'goal', 'steps'],
  additionalProperties: false,
}

const verdictSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'ITERATE', 'REJECT'] },
    summary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'summary', 'concerns'],
  additionalProperties: false,
}

function plannerPrompt(objective) {
  return [
    'You are Planner. Produce a decision-complete implementation plan for the following objective.',
    'State the goal and success criteria, then break the work into ordered, concrete steps. Each step needs a short id and an action. List known risks. Return only the structured plan object.',
    '',
    'Objective: ' + objective,
  ].join('\n')
}

function architectPrompt(snapshot) {
  return [
    'You are Architect. Review the following plan for architectural soundness. Provide the strongest steelman antithesis: at least one real tradeoff tension, the most credible objections, and where possible a synthesis. Flag principle violations. Do NOT modify the plan; output prose review only.',
    '',
    'Plan:',
    snapshot,
  ].join('\n')
}

function criticPrompt(snapshot) {
  return [
    'You are Critic, the final quality gate. Independently review the SAME fixed plan snapshot below. Enforce principle-option consistency, fair alternatives, clear risk mitigation, testable acceptance criteria, and concrete verification steps.',
    'Return verdict APPROVE only if the plan is sound; ITERATE for fixable gaps; REJECT for fundamental flaws. List concerns as short strings.',
    '',
    'Plan:',
    snapshot,
  ].join('\n')
}

function revisionPrompt(snapshot, architect, critic) {
  return [
    'You are Planner. Revise the plan by synthesizing the Architect and Critic feedback below. Only you combine the two reviews; preserve what was sound and fix the gaps. Return a complete revised plan object.',
    '',
    'Current plan:',
    snapshot,
    '',
    'Architect feedback:',
    architect,
    '',
    'Critic feedback:',
    JSON.stringify(critic),
  ].join('\n')
}

phase('planning')
let plan = await agent(plannerPrompt(args.objective), { label: 'Planner', phase: 'planning', schema: planSchema })
if (plan === null) return { approved: false, error: 'Planner failed to produce a plan' }

for (let round = 1; round <= args.maxIterations; round += 1) {
  phase('review')
  const snapshot = JSON.stringify(plan)
  // Architect and Critic review the SAME fixed snapshot, sequentially, and the
  // Architect's output never reaches the Critic.
  const architect = await agent(architectPrompt(snapshot), { label: 'Architect r' + round, phase: 'review' })
  const critic = await agent(criticPrompt(snapshot), { label: 'Critic r' + round, phase: 'review', schema: verdictSchema })
  if (architect === null || critic === null) return { approved: false, plan: plan, error: 'A reviewer failed to respond' }
  if (critic.verdict === 'APPROVE') return { approved: true, plan: plan, rounds: round }
  const revised = await agent(revisionPrompt(snapshot, architect, critic), { label: 'Planner r' + round, phase: 'planning', schema: planSchema })
  if (revised === null) return { approved: false, plan: plan, error: 'Planner revision failed' }
  plan = revised
}
return { approved: false, plan: plan, rounds: args.maxIterations }
`

/**
 * Fixed team staged pipeline. The model supplies data only; it cannot alter
 * the pipeline, fan-out, or the verify/fix loop.
 */
export const TEAM_SCRIPT = String.raw`
const planSchema = {
  type: 'object',
  properties: {
    subtasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          details: { type: 'string' },
          acceptance: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'details', 'acceptance'],
        additionalProperties: false,
      },
    },
  },
  required: ['subtasks'],
  additionalProperties: false,
}

const verdictSchema = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'findings'],
  additionalProperties: false,
}

function leadPrompt(objective) {
  return [
    'You are the Team lead. Decompose the objective into a list of mostly independent subtasks, each completable by one executor and verifiable by concrete acceptance criteria. Order foundational work first. Return only the structured plan object.',
    '',
    'Objective: ' + objective,
  ].join('\n')
}

function execPrompt(task, findings) {
  return [
    'You are an Executor. Complete exactly this subtask in the shared workspace, using the available tools to read, edit, run, and verify real changes. Deliver the full implementation; do not reduce scope or skip verification.',
    '',
    'Subtask:',
    JSON.stringify(task),
    '',
    findings && findings.length > 0
      ? 'Prior verification findings to address:\n' + JSON.stringify(findings)
      : 'No prior findings.',
    '',
    'Report what you changed and how you verified it.',
  ].join('\n')
}

function verifyPrompt(subtasks, results) {
  return [
    'You are a Verifier. Inspect the shared workspace and verify the completed subtasks against their acceptance criteria with fresh evidence. Do not claim a pass you did not verify; if anything is unmet, list concrete findings to fix.',
    '',
    'Subtasks:',
    JSON.stringify(subtasks),
    '',
    'Executor reports:',
    JSON.stringify(results),
  ].join('\n')
}

phase('team-plan')
const plan = await agent(leadPrompt(args.objective), { label: 'team-plan', phase: 'team-plan', schema: planSchema })
if (plan === null) return { status: 'error', error: 'Team plan failed' }
const subtasks = plan.subtasks.slice(0, args.maxSubtasks)

let findings = []
for (let round = 1; round <= args.maxIterations; round += 1) {
  phase('team-exec')
  const execResults = await parallel(subtasks.map((task) => () => agent(
    execPrompt(task, findings),
    { label: 'exec:' + task.id, phase: 'team-exec' },
  )))
  phase('team-verify')
  const verdict = await agent(verifyPrompt(subtasks, execResults), { label: 'team-verify', phase: 'team-verify', schema: verdictSchema })
  if (verdict === null) return { status: 'error', error: 'Verifier failed', rounds: round }
  if (verdict.pass) return { status: 'complete', subtasks: subtasks.length, rounds: round, findings: verdict.findings }
  findings = verdict.findings
}
return { status: 'budget-limited', subtasks: subtasks.length, rounds: args.maxIterations, findings: findings }
`
