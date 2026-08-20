import { describe, expect, it } from 'vitest'
import { ROLE_NAMES, loadAllRoles, loadRole } from '../src/roles.ts'

describe('role loader', () => {
  it('loads all nine roles as non-empty prompts', () => {
    const roles = loadAllRoles()
    expect(Object.keys(roles).sort()).toEqual([...ROLE_NAMES].sort())
    for (const name of ROLE_NAMES) {
      expect(roles[name].length).toBeGreaterThan(1000)
      expect(roles[name]).toContain('<Agent_Prompt>')
    }
  })

  it('preserves each upstream role identity marker verbatim', () => {
    expect(loadRole('planner')).toContain('You are Planner')
    expect(loadRole('architect')).toContain('You are Architect')
    expect(loadRole('critic')).toContain('final quality gate')
    expect(loadRole('executor')).toContain('You are Executor')
    expect(loadRole('verifier')).toContain('You are Verifier')
    // Nexus-sourced specialist roles (byte-identical to ~/.nexus/agents/*.md).
    expect(loadRole('code-reviewer')).toContain('You are Code Reviewer')
    expect(loadRole('security-reviewer')).toContain('You are Security Reviewer')
    expect(loadRole('debugger')).toContain('You are Debugger')
    expect(loadRole('test-engineer')).toContain('You are Test Engineer')
  })

  it('preserves the critic investigation protocol verbatim', () => {
    const critic = loadRole('critic')
    expect(critic).toContain('Pre-commitment')
    expect(critic).toContain('Pre-Mortem')
    expect(critic).toContain('ADVERSARIAL')
    expect(critic).toContain('Realist Check')
  })

  it('preserves the ralplan-specific guidance in planner and critic', () => {
    expect(loadRole('planner')).toContain('RALPLAN-DR')
    expect(loadRole('critic')).toContain('principle-option consistency')
  })

  it('preserves the verifier evidence contract', () => {
    const verifier = loadRole('verifier')
    expect(verifier).toContain('VERIFIED / PARTIAL / MISSING')
    expect(verifier).toContain('Verification Report')
  })
})
