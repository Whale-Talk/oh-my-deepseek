/**
 * Model-facing `team` staged-pipeline tool: decompose → execute (parallel) →
 * verify → fix (loop), adapted from OMC's `team` skill. The model supplies only
 * the objective; the pipeline, fan-out, and verify/fix loop are deployment-owned
 * and cannot be rewritten by the model.
 * @module oh-my-deepseek/team
 */

import { execFileSync } from 'node:child_process'
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
import { diffGitStatus, renderJson, requireFreshProvider, resolveBounded, workflowStopError } from './shared.ts'
import { TEAM_META, TEAM_SCRIPT } from './scripts.ts'
import { loadAllRoles } from './roles.ts'

export const name = 'team'
export const inject = ['tools', 'workflowEngine', 'subagents', 'systemPrompt']

/**
 * Best-effort `git status --porcelain` of the workspace; `undefined` when git
 * is unavailable, the cwd is absent, or the command fails. The run still
 * proceeds — this is a transparency observation, never a gate.
 */
function gitStatus(cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })
  } catch {
    return undefined
  }
}

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

      const roles = loadAllRoles()
      const cwd = parent.session.header.cwd
      const gitBefore = gitStatus(cwd)
      const run: WorkflowRun = ctx.workflowEngine.start({
        script: TEAM_SCRIPT,
        meta: TEAM_META,
        args: {
          objective,
          maxIterations,
          maxSubtasks: resolved.maxSubtasks,
          roles: { planner: roles.planner, executor: roles.executor, verifier: roles.verifier },
        },
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
        const gitAfter = gitStatus(cwd)
        const changedFiles = gitBefore !== undefined && gitAfter !== undefined
          ? diffGitStatus(gitBefore, gitAfter)
          : undefined
        const scriptResult = settled.value
        const result = {
          ...(typeof scriptResult === 'object' && scriptResult !== null && !Array.isArray(scriptResult)
            ? scriptResult as Record<string, unknown>
            : { value: scriptResult }),
          ...(changedFiles !== undefined ? { changedFiles } : {}),
        }
        return {
          runId: run.id,
          agentsStarted: settled.agentsStarted,
          result: result as JsonValue,
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
