import { describe, expect, it } from 'vitest'
import {
  activeDimensions,
  computeAmbiguity,
  computeOntologyStability,
  DIMENSION_WEIGHTS,
} from '../src/scoring.ts'

describe('activeDimensions', () => {
  it('greenfield has no context dimension', () => {
    expect(activeDimensions('greenfield')).toEqual(['goal', 'constraints', 'criteria'])
  })

  it('brownfield includes context', () => {
    expect(activeDimensions('brownfield')).toEqual(['goal', 'constraints', 'criteria', 'context'])
  })
})

describe('computeAmbiguity', () => {
  it('computes greenfield weights 40/30/30 exactly', () => {
    const r = computeAmbiguity('greenfield', { goal: 1, constraints: 0.5, criteria: 0 })
    expect(r.breakdown.map(b => b.weight)).toEqual([0.4, 0.3, 0.3])
    // clarity = 1*0.4 + 0.5*0.3 + 0*0.3 = 0.55
    expect(r.clarity).toBeCloseTo(0.55)
    expect(r.ambiguity).toBeCloseTo(0.45)
  })

  it('computes brownfield weights 35/25/25/15 exactly', () => {
    const r = computeAmbiguity('brownfield', { goal: 1, constraints: 1, criteria: 1, context: 0.5 })
    expect(r.breakdown.map(b => b.weight)).toEqual([0.35, 0.25, 0.25, 0.15])
    // clarity = 0.35 + 0.25 + 0.25 + 0.075 = 0.925
    expect(r.clarity).toBeCloseTo(0.925)
    expect(r.ambiguity).toBeCloseTo(0.075)
  })

  it('identifies the weakest dimension', () => {
    const r = computeAmbiguity('greenfield', { goal: 0.9, constraints: 0.4, criteria: 0.7 })
    expect(r.weakestDimension).toBe('constraints')
  })

  it('clamps float noise to [0, 1]', () => {
    const allOne = computeAmbiguity('greenfield', { goal: 1, constraints: 1, criteria: 1 })
    expect(allOne.ambiguity).toBe(0)
    const allZero = computeAmbiguity('greenfield', { goal: 0, constraints: 0, criteria: 0 })
    expect(allZero.ambiguity).toBe(1)
  })

  it('rejects out-of-range scores', () => {
    expect(() => computeAmbiguity('greenfield', { goal: 1.5, constraints: 0, criteria: 0 })).toThrow(/\[0, 1\]/)
    expect(() => computeAmbiguity('greenfield', { goal: Number.NaN, constraints: 0, criteria: 0 })).toThrow(/\[0, 1\]/)
  })

  it('requires context for brownfield', () => {
    expect(() => computeAmbiguity('brownfield', { goal: 1, constraints: 1, criteria: 1 })).toThrow(/\[0, 1\]/)
  })
})

describe('computeOntologyStability', () => {
  const e = (name: string, type: string, fields: string[]): { name: string; type: string; fields: string[] } => ({ name, type, fields })

  it('counts same-name entities as stable', () => {
    const prev = [e('User', 'core', ['id', 'email'])]
    const curr = [e('User', 'core', ['id', 'email', 'name'])]
    const r = computeOntologyStability(curr, prev)
    expect(r.stable).toEqual(['User'])
    expect(r.changed).toEqual([])
    expect(r.newEntities).toEqual([])
    expect(r.removed).toEqual([])
    expect(r.ratio).toBe(1)
  })

  it('treats same-type + >50% field overlap as renamed (changed), counting toward stability', () => {
    const prev = [e('Buyer', 'core', ['id', 'email', 'orders'])]
    const curr = [e('Customer', 'core', ['id', 'email', 'orders'])]
    const r = computeOntologyStability(curr, prev)
    expect(r.changed).toEqual(['Customer'])
    expect(r.removed).toEqual([])
    expect(r.ratio).toBe(1)
  })

  it('classifies unmatched current entities as new and unmatched previous as removed', () => {
    const prev = [e('User', 'core', ['id']), e('Legacy', 'core', ['a'])]
    const curr = [e('User', 'core', ['id']), e('Tag', 'core', ['name'])]
    const r = computeOntologyStability(curr, prev)
    expect(r.stable).toEqual(['User'])
    expect(r.newEntities).toEqual(['Tag'])
    expect(r.removed).toEqual(['Legacy'])
    // (1 stable + 0 changed) / 2 = 0.5
    expect(r.ratio).toBe(0.5)
  })

  it('matches the upstream example: 3 stable + 1 new over 4 = 75%', () => {
    const prev = [
      e('User', 'core', ['id']),
      e('Task', 'core', ['id']),
      e('Project', 'core', ['id']),
    ]
    const curr = [
      e('User', 'core', ['id']),
      e('Task', 'core', ['id']),
      e('Project', 'core', ['id']),
      e('Tag', 'core', ['name']),
    ]
    const r = computeOntologyStability(curr, prev)
    expect(r.stable).toHaveLength(3)
    expect(r.newEntities).toEqual(['Tag'])
    expect(r.ratio).toBe(0.75)
  })

  it('returns undefined ratio for an empty current round', () => {
    const r = computeOntologyStability([], [e('User', 'core', ['id'])])
    expect(r.ratio).toBeUndefined()
    expect(r.removed).toEqual(['User'])
  })

  it('does not treat different types as renamed', () => {
    const prev = [e('Order', 'core', ['id', 'total'])]
    const curr = [e('OrderRecord', 'external', ['id', 'total'])]
    const r = computeOntologyStability(curr, prev)
    expect(r.changed).toEqual([])
    expect(r.newEntities).toEqual(['OrderRecord'])
    expect(r.removed).toEqual(['Order'])
  })

  it('does not treat empty-field entities as renamed', () => {
    const prev = [e('A', 'core', [])]
    const curr = [e('B', 'core', [])]
    const r = computeOntologyStability(curr, prev)
    expect(r.changed).toEqual([])
    expect(r.newEntities).toEqual(['B'])
    expect(r.removed).toEqual(['A'])
  })
})
