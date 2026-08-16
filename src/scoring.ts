/**
 * Deterministic scoring math for the deep-interview skill. This is the
 * "mathematical ambiguity gating" core: the weighted-average ambiguity formula
 * and the ontology-stability computation are exact code, not LLM arithmetic.
 * The model supplies per-dimension clarity judgements and entity lists; these
 * functions turn them into a reproducible gate.
 * @module oh-my-deepseek/scoring
 */

export type InterviewType = 'greenfield' | 'brownfield'

/** Per-dimension clarity scores in [0, 1]; `context` is brownfield-only. */
export interface DimensionScores {
  goal: number
  constraints: number
  criteria: number
  /** Brownfield only; omitted/ignored for greenfield. */
  context?: number
}

/** Dimension weights, matching the upstream deep-interview brownfield vs greenfield table. */
export const DIMENSION_WEIGHTS = {
  greenfield: { goal: 0.4, constraints: 0.3, criteria: 0.3 },
  brownfield: { goal: 0.35, constraints: 0.25, criteria: 0.25, context: 0.15 },
} as const

/** Active dimensions for a type, in scoring order. */
export function activeDimensions(type: InterviewType): readonly string[] {
  return type === 'greenfield' ? ['goal', 'constraints', 'criteria'] : ['goal', 'constraints', 'criteria', 'context']
}

export interface AmbiguityResult {
  /** Overall ambiguity in [0, 1]; 0 = crystal clear. */
  ambiguity: number
  /** Overall clarity = 1 - ambiguity. */
  clarity: number
  /** One row per active dimension: raw score, weight, weighted contribution. */
  breakdown: { dimension: string; score: number; weight: number; weighted: number }[]
  /** The active dimension with the lowest raw score. */
  weakestDimension: string
}

function assertUnitScore(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${name} must be a finite number in [0, 1]`)
  }
  return value
}

/**
 * Compute the weighted-average ambiguity for one scoring round. Greenfield
 * weights goal/constraints/criteria at 40/30/30; brownfield at 35/25/25/15
 * with the context dimension required.
 */
export function computeAmbiguity(type: InterviewType, scores: DimensionScores): AmbiguityResult {
  const dims = activeDimensions(type)
  const weights = DIMENSION_WEIGHTS[type]
  let clarity = 0
  const breakdown: AmbiguityResult['breakdown'] = []
  let weakestDimension = dims[0]
  let weakestScore = Number.POSITIVE_INFINITY

  for (const dimension of dims) {
    const raw = dimension === 'context' ? scores.context : scores[dimension as keyof Pick<DimensionScores, 'goal' | 'constraints' | 'criteria'>]
    const score = assertUnitScore(dimension, raw)
    const weight = weights[dimension as keyof typeof weights]
    const weighted = score * weight
    clarity += weighted
    breakdown.push({ dimension, score, weight, weighted })
    if (score < weakestScore) {
      weakestScore = score
      weakestDimension = dimension
    }
  }

  // Clamp float noise so "crystal clear" rounds land exactly on 0.
  const ambiguity = Math.min(1, Math.max(0, 1 - clarity))
  return { ambiguity, clarity: 1 - ambiguity, breakdown, weakestDimension }
}

/** One extracted domain entity (noun) from a round. */
export interface Entity {
  name: string
  type: string
  fields: string[]
}

export interface OntologyStability {
  /** Entities with the same name in both rounds. */
  stable: string[]
  /** Entities renamed (same type + >50% field overlap) between rounds. */
  changed: string[]
  /** Entities present only in the current round. */
  newEntities: string[]
  /** Entities present only in the previous round. */
  removed: string[]
  /** (stable + changed) / currentCount; `undefined` when currentCount is 0. */
  ratio: number | undefined
}

function fieldOverlap(prev: Entity, curr: Entity): number {
  if (prev.fields.length === 0 && curr.fields.length === 0) return 0
  const prevSet = new Set(prev.fields)
  const currSet = new Set(curr.fields)
  let intersection = 0
  for (const field of currSet) {
    if (prevSet.has(field)) intersection += 1
  }
  return intersection / Math.max(prevSet.size, currSet.size)
}

/**
 * Compute ontology stability between two consecutive rounds. Renamed entities
 * (different name, same type, >50% field overlap) count toward stability,
 * matching the upstream convergence rule. Greedy matching: exact-name first,
 * then rename-fuzzy.
 */
export function computeOntologyStability(current: Entity[], previous: Entity[]): OntologyStability {
  const stable: string[] = []
  const changed: string[] = []
  const matchedPrev = new Set<number>()
  const matchedCurr = new Set<number>()

  // Exact name match.
  for (let i = 0; i < previous.length; i += 1) {
    for (let j = 0; j < current.length; j += 1) {
      if (matchedCurr.has(j)) continue
      if (previous[i].name === current[j].name) {
        stable.push(current[j].name)
        matchedPrev.add(i)
        matchedCurr.add(j)
        break
      }
    }
  }

  // Rename-fuzzy: different name, same type, >50% field overlap. The exact-name
  // pass above already consumed every same-name pair, so no same-name guard is
  // needed here.
  for (let i = 0; i < previous.length; i += 1) {
    if (matchedPrev.has(i)) continue
    for (let j = 0; j < current.length; j += 1) {
      if (matchedCurr.has(j)) continue
      const prev = previous[i]
      const curr = current[j]
      if (prev.type === curr.type && fieldOverlap(prev, curr) > 0.5) {
        changed.push(curr.name)
        matchedPrev.add(i)
        matchedCurr.add(j)
        break
      }
    }
  }

  const newEntities = current.filter((_, j) => !matchedCurr.has(j)).map(e => e.name)
  const removed = previous.filter((_, i) => !matchedPrev.has(i)).map(e => e.name)

  const currentCount = current.length
  const ratio = currentCount === 0 ? undefined : (stable.length + changed.length) / currentCount

  return { stable, changed, newEntities, removed, ratio }
}
