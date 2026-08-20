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
import { RALPLAN_META, RALPLAN_SCRIPT } from './scripts.ts'
import { loadAllRoles } from './roles.ts'

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

      const roles = loadAllRoles()
      const run: WorkflowRun = ctx.workflowEngine.start({
        script: RALPLAN_SCRIPT,
        meta: RALPLAN_META,
        args: {
          objective,
          maxIterations,
          roles: {
            planner: roles.planner,
            architect: roles.architect,
            critic: roles.critic,
            codeReviewer: roles['code-reviewer'],
            securityReviewer: roles['security-reviewer'],
          },
        },
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
