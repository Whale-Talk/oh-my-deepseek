/**
 * Model-facing `ralplan` consensus-planning tool: a fixed Planner → Architect →
 * Critic loop over the workflow and subagent seams, adapted from OMC's `ralplan`
 * skill. The model supplies only the objective (plus an optional iteration cap);
 * the loop, reviewer ordering, and schemas are deployment-owned and cannot be
 * rewritten by the model.
 * @module oh-my-deepseek/ralplan
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
// Declaration merge only: makes ctx.systemPrompt visible for section registration.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-subagent'
import { renderJson, requireFreshProvider, resolveBounded, workflowStopError } from './shared.ts'

export const name = 'ralplan'
export const inject = ['tools', 'workflowEngine', 'subagents', 'systemPrompt']

/** Deployment policy for the fixed ralplan workflow. */
export interface Config {
  /** Model-facing tool name (default `ralplan`). */
  toolName?: string
  /** Default and deployment ceiling for review rounds (default 5). */
  maxIterations?: number
  /** Fresh structured-output provider used for every child (default `spawn`). */
  subagentProvider?: string
  /** Rendered-result ceiling in characters (default 50000). */
  maxResultChars?: number
}

export const Config: z<Config> = z.object({
  toolName: z.string().default('ralplan'),
  maxIterations: z.number().step(1).min(1).max(16).default(5),
  subagentProvider: z.string().default('spawn'),
  maxResultChars: z.number().step(1).min(1).default(50_000),
})

interface ResolvedConfig {
  readonly toolName: string
  readonly maxIterations: number
  readonly subagentProvider: string
  readonly maxResultChars: number
}

/** Validate defaults even when a caller invokes apply() without Loader normalization. */
function resolveConfig(config: Config): ResolvedConfig {
  const toolName = config.toolName ?? 'ralplan'
  const maxIterations = config.maxIterations ?? 5
  const subagentProvider = config.subagentProvider ?? 'spawn'
  const maxResultChars = config.maxResultChars ?? 50_000
  if (toolName.length === 0 || toolName !== toolName.trim()) {
    throw new TypeError('toolName must be a non-empty normalized string')
  }
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new TypeError('maxIterations must be a positive safe integer')
  }
  if (subagentProvider.length === 0 || subagentProvider !== subagentProvider.trim()) {
    throw new TypeError('subagentProvider must be a non-empty normalized string')
  }
  if (!Number.isSafeInteger(maxResultChars) || maxResultChars < 1) {
    throw new TypeError('maxResultChars must be a positive safe integer')
  }
  return { toolName, maxIterations, subagentProvider, maxResultChars }
}

const RALPLAN_META = {
  name: 'ralplan-consensus',
  description: 'Planner → Architect → Critic consensus planning until approval or the round cap.',
  phases: [
    { title: 'planning', detail: 'Planner drafts and revises the plan snapshot.' },
    { title: 'review', detail: 'Architect then Critic review the same fixed snapshot.' },
  ],
}

/**
 * Fixed, deployment-owned orchestration. The model supplies data only; it
 * cannot alter the loop, reviewer ordering, schemas, or the rule that only the
 * Planner synthesizes the two reviews.
 */
const RALPLAN_SCRIPT = String.raw`
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

const DESCRIPTION = 'Run a foreground consensus-planning loop (Planner → Architect → Critic) toward one objective. '
  + 'Each round: Planner produces a plan snapshot, Architect reviews it with the strongest steelman antithesis, then '
  + 'Critic independently reviews the SAME snapshot and returns APPROVE / ITERATE / REJECT. On APPROVE the plan is '
  + 'returned; otherwise Planner (alone) synthesizes both reviews and revises, repeating up to the iteration cap. '
  + 'This is planning-only: it returns the final plan and does not implement it. Use when the user asks for a '
  + 'careful, reviewed plan before implementation.'

type RalplanCallArgs = {
  objective: string
  maxIterations?: number
}

const OUTPUT_PROPERTIES = {
  runId: { type: 'string', required: true },
  agentsStarted: { type: 'integer', required: true },
  result: { type: 'json', required: true },
} as const

function presentCall(args: RalplanCallArgs): ToolCallView {
  return { card: 'generic', title: 'ralplan', rawInput: args.objective }
}

function presentResult(args: RalplanCallArgs, result: { content: ContentBlock[]; isError: boolean }): ToolResultView {
  void args
  void result
  return { card: 'generic' }
}

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({
    name: `tool:${resolved.toolName}`,
    order: 117,
    text: `Use the ${resolved.toolName} tool when the user asks for a consensus/reviewed plan (Planner → Architect → Critic) before implementation. ${resolved.toolName} is planning-only: it returns a plan and does not implement it; carry out the returned plan in later steps.`,
  })
  ctx.tools.register(defineTool({
    name: resolved.toolName,
    description: DESCRIPTION,
    parameters: {
      objective: {
        type: 'string',
        required: true,
        description: 'The objective to plan toward.',
      },
      maxIterations: {
        type: 'number',
        description: 'Optional positive safe-integer review-round cap, bounded by the deployment ceiling.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: OUTPUT_PROPERTIES,
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderJson(value.result, resolved.maxResultChars),
      }],
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error('ralplan tool requires a calling agent (exec.agent was undefined)')
      }
      const objective = args.objective.trim()
      if (objective.length === 0) throw new Error('ralplan objective must be a non-empty string')
      const maxIterations = resolveBounded(args.maxIterations, resolved.maxIterations)
      void requireFreshProvider(ctx, resolved.subagentProvider)

      const run: WorkflowRun = ctx.workflowEngine.start({
        script: RALPLAN_SCRIPT,
        meta: RALPLAN_META,
        args: { objective, maxIterations },
        subagentProvider: resolved.subagentProvider,
        maxTotalAgents: 1 + maxIterations * 3,
        parent,
        signal: exec.signal,
      })
      const onAbort = (): void => { run.cancel('parent step aborted') }
      exec.signal.addEventListener('abort', onAbort, { once: true })
      if (exec.signal.aborted) run.cancel('parent step aborted')

      try {
        const settled = await run.result
        const error = workflowStopError(settled)
        if (error !== undefined) throw new Error(error)
        return {
          runId: run.id,
          agentsStarted: settled.agentsStarted,
          result: settled.value as JsonValue,
        }
      } finally {
        exec.signal.removeEventListener('abort', onAbort)
        await run.dispose()
      }
    },
    presentCall,
    presentResult,
  }))
}
