/**
 * Model-facing `team` staged-pipeline tool: decompose → execute (parallel) →
 * verify → fix (loop), adapted from OMC's `team` skill. The model supplies only
 * the objective; the pipeline, fan-out, and verify/fix loop are deployment-owned
 * and cannot be rewritten by the model.
 * @module oh-my-deepseek/team
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

export const name = 'team'
export const inject = ['tools', 'workflowEngine', 'subagents', 'systemPrompt']

/** Deployment policy for the fixed team workflow. */
export interface Config {
  /** Model-facing tool name (default `team`). */
  toolName?: string
  /** Default and deployment ceiling for verify/fix rounds (default 3). */
  maxIterations?: number
  /** Maximum subtasks one run fans out to (default 12). */
  maxSubtasks?: number
  /** Fresh structured-output provider used for every child (default `spawn`). */
  subagentProvider?: string
  /** Rendered-result ceiling in characters (default 50000). */
  maxResultChars?: number
}

export const Config: z<Config> = z.object({
  toolName: z.string().default('team'),
  maxIterations: z.number().step(1).min(1).max(16).default(3),
  maxSubtasks: z.number().step(1).min(1).max(64).default(12),
  subagentProvider: z.string().default('spawn'),
  maxResultChars: z.number().step(1).min(1).default(50_000),
})

interface ResolvedConfig {
  readonly toolName: string
  readonly maxIterations: number
  readonly maxSubtasks: number
  readonly subagentProvider: string
  readonly maxResultChars: number
}

/** Validate defaults even when a caller invokes apply() without Loader normalization. */
function resolveConfig(config: Config): ResolvedConfig {
  const toolName = config.toolName ?? 'team'
  const maxIterations = config.maxIterations ?? 3
  const maxSubtasks = config.maxSubtasks ?? 12
  const subagentProvider = config.subagentProvider ?? 'spawn'
  const maxResultChars = config.maxResultChars ?? 50_000
  if (toolName.length === 0 || toolName !== toolName.trim()) {
    throw new TypeError('toolName must be a non-empty normalized string')
  }
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new TypeError('maxIterations must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxSubtasks) || maxSubtasks < 1) {
    throw new TypeError('maxSubtasks must be a positive safe integer')
  }
  if (subagentProvider.length === 0 || subagentProvider !== subagentProvider.trim()) {
    throw new TypeError('subagentProvider must be a non-empty normalized string')
  }
  if (!Number.isSafeInteger(maxResultChars) || maxResultChars < 1) {
    throw new TypeError('maxResultChars must be a positive safe integer')
  }
  return { toolName, maxIterations, maxSubtasks, subagentProvider, maxResultChars }
}

const TEAM_META = {
  name: 'team-staged-pipeline',
  description: 'Decompose, execute subtasks in parallel, verify, and fix until passing.',
  phases: [
    { title: 'team-plan', detail: 'Lead decomposes the objective into subtasks.' },
    { title: 'team-exec', detail: 'Executors complete subtasks in parallel.' },
    { title: 'team-verify', detail: 'Verifier checks acceptance criteria.' },
  ],
}

/**
 * Fixed, deployment-owned orchestration. The model supplies data only; it
 * cannot alter the pipeline, fan-out, or the verify/fix loop.
 */
const TEAM_SCRIPT = String.raw`
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

const DESCRIPTION = 'Run a foreground staged team pipeline toward one objective: decompose into subtasks, execute them in '
  + 'parallel with executor subagents in the shared workspace, verify the combined result against acceptance criteria, and '
  + 'loop on fixes until passing or the round cap. Returns a worker-reported status (complete / budget-limited / error). '
  + 'Use when the user asks to run a team of agents on one objective; prefer plain subagent calls for one or two small delegations.'

type TeamCallArgs = {
  objective: string
  maxIterations?: number
}

const OUTPUT_PROPERTIES = {
  runId: { type: 'string', required: true },
  agentsStarted: { type: 'integer', required: true },
  result: { type: 'json', required: true },
} as const

function presentCall(args: TeamCallArgs): ToolCallView {
  return { card: 'generic', title: 'team', rawInput: args.objective }
}

function presentResult(args: TeamCallArgs, result: { content: ContentBlock[]; isError: boolean }): ToolResultView {
  void args
  void result
  return { card: 'generic' }
}

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({
    name: `tool:${resolved.toolName}`,
    order: 118,
    text: `Use the ${resolved.toolName} tool when the user asks to run a team of agents on one objective: it decomposes, executes subtasks in parallel, verifies, and fixes until passing. Prefer plain subagent calls for one or two small delegations.`,
  })
  ctx.tools.register(defineTool({
    name: resolved.toolName,
    description: DESCRIPTION,
    parameters: {
      objective: {
        type: 'string',
        required: true,
        description: 'The objective the team works toward.',
      },
      maxIterations: {
        type: 'number',
        description: 'Optional positive safe-integer verify/fix round cap, bounded by the deployment ceiling.',
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
        throw new Error('team tool requires a calling agent (exec.agent was undefined)')
      }
      const objective = args.objective.trim()
      if (objective.length === 0) throw new Error('team objective must be a non-empty string')
      const maxIterations = resolveBounded(args.maxIterations, resolved.maxIterations)
      void requireFreshProvider(ctx, resolved.subagentProvider)

      const run: WorkflowRun = ctx.workflowEngine.start({
        script: TEAM_SCRIPT,
        meta: TEAM_META,
        args: { objective, maxIterations, maxSubtasks: resolved.maxSubtasks },
        subagentProvider: resolved.subagentProvider,
        maxTotalAgents: 1 + (resolved.maxSubtasks + 1) * maxIterations,
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
