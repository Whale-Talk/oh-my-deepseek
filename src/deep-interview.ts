/**
 * Model-facing `deep_interview_score` tool: the deterministic ambiguity gate
 * for the deep-interview skill. It applies the exact weighted-average ambiguity
 * formula and the ontology-stability computation — the "mathematical gating"
 * core — so the model never recomputes the arithmetic by hand.
 * @module oh-my-deepseek/deep-interview
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import {
  computeAmbiguity,
  computeOntologyStability,
  type DimensionScores,
  type Entity,
  type InterviewType,
} from './scoring.ts'

export const name = 'deep-interview-score'
export const inject = ['tools']

/** Deployment policy for the fixed scoring gate. */
export interface Config {
  /** Model-facing tool name (default `deep_interview_score`). */
  toolName?: string
  /** Ambiguity threshold in [0, 1]; below it the interview may proceed (default 0.2). */
  ambiguityThreshold?: number
}

export const Config: z<Config> = z.object({
  toolName: z.string().default('deep_interview_score'),
  ambiguityThreshold: z.number().min(0).max(1).default(0.2),
})

interface ResolvedConfig {
  readonly toolName: string
  readonly ambiguityThreshold: number
}

function resolveConfig(config: Config): ResolvedConfig {
  const toolName = config.toolName ?? 'deep_interview_score'
  const ambiguityThreshold = config.ambiguityThreshold ?? 0.2
  if (toolName.length === 0 || toolName !== toolName.trim()) {
    throw new TypeError('toolName must be a non-empty normalized string')
  }
  if (!Number.isFinite(ambiguityThreshold) || ambiguityThreshold < 0 || ambiguityThreshold > 1) {
    throw new TypeError('ambiguityThreshold must be a finite number in [0, 1]')
  }
  return { toolName, ambiguityThreshold }
}

const entitySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', required: true },
    type: { type: 'string', required: true },
    fields: { type: 'array', required: true, items: { type: 'string' } },
  },
  additionalProperties: false,
} as const

type ScoreArgs = {
  type: InterviewType
  scores: DimensionScores
  entities: Entity[]
  previousEntities?: Entity[]
}

const DESCRIPTION = 'Compute the deep-interview ambiguity gate deterministically. Given per-dimension clarity '
  + 'judgements (goal/constraints/criteria, plus context for brownfield) and the current round\'s ontology '
  + 'entities (optionally with the previous round for stability), return the exact weighted-average ambiguity, '
  + 'the weighted breakdown, the weakest dimension, the ontology-stability ratio, and whether the threshold '
  + 'is met. Weights are fixed: greenfield 40/30/30; brownfield 35/25/25/15.'

function presentCall(args: ScoreArgs): ToolCallView {
  return { card: 'generic', title: 'deep_interview_score', rawInput: `type=${args.type}` }
}

function presentResult(args: ScoreArgs, result: { content: ContentBlock[]; isError: boolean }): ToolResultView {
  void args
  void result
  return { card: 'generic' }
}

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.tools.register(defineTool({
    name: resolved.toolName,
    description: DESCRIPTION,
    parameters: {
      type: {
        type: 'string',
        enum: ['greenfield', 'brownfield'],
        required: true,
        description: 'greenfield (no existing codebase) or brownfield (modifying/extending existing code).',
      },
      scores: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          goal: { type: 'number', required: true, description: 'Goal-clarity score in [0, 1].' },
          constraints: { type: 'number', required: true, description: 'Constraint-clarity score in [0, 1].' },
          criteria: { type: 'number', required: true, description: 'Success-criteria-clarity score in [0, 1].' },
          context: { type: 'number', description: 'Context-clarity score in [0, 1]; required for brownfield.' },
        },
      },
      entities: {
        type: 'array',
        required: true,
        description: 'Current round\'s extracted entities (nouns) with name, type, and fields.',
        items: entitySchema,
      },
      previousEntities: {
        type: 'array',
        description: 'Previous round\'s entities, for ontology-stability (round 2+).',
        items: entitySchema,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ambiguity: { type: 'number', required: true },
          clarity: { type: 'number', required: true },
          threshold: { type: 'number', required: true },
          belowThreshold: { type: 'boolean', required: true },
          weakestDimension: { type: 'string', required: true },
          breakdown: { type: 'json', required: true },
          ontologyStability: { type: 'json', required: true },
        },
      },
      render: (_args, value) => {
        const v = value as {
          ambiguity: number
          threshold: number
          belowThreshold: boolean
          weakestDimension: string
          ontologyStability: { ratio?: number; stable: string[]; changed: string[]; newEntities: string[]; removed: string[] }
        }
        const pct = Math.round(v.ambiguity * 100)
        const ratio = v.ontologyStability.ratio === undefined ? 'n/a' : `${Math.round(v.ontologyStability.ratio * 100)}%`
        const text = [
          `Ambiguity: ${pct}% (threshold ${Math.round(v.threshold * 100)}%) — ${v.belowThreshold ? 'below threshold' : 'above threshold'}.`,
          `Weakest dimension: ${v.weakestDimension}.`,
          `Ontology stability: ${ratio} (stable ${v.ontologyStability.stable.length}, changed ${v.ontologyStability.changed.length}, new ${v.ontologyStability.newEntities.length}, removed ${v.ontologyStability.removed.length}).`,
        ].join('\n')
        return [{ type: 'text', text }]
      },
    },
    async execute(args, exec) {
      void exec
      const type = args.type as InterviewType
      const scores = args.scores
      const ambiguity = computeAmbiguity(type, scores)
      const stability = computeOntologyStability(args.entities, args.previousEntities ?? [])
      return {
        ambiguity: ambiguity.ambiguity,
        clarity: ambiguity.clarity,
        threshold: resolved.ambiguityThreshold,
        belowThreshold: ambiguity.ambiguity <= resolved.ambiguityThreshold,
        weakestDimension: ambiguity.weakestDimension,
        breakdown: ambiguity.breakdown as unknown as JsonValue,
        ontologyStability: stability as unknown as JsonValue,
      }
    },
    presentCall,
    presentResult,
  }))
}
