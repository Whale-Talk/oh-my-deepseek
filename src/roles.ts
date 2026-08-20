/**
 * Role-prompt loader. The role files under `roles/` are byte-for-byte copies
 * of upstream agent prompts:
 *   - planner/architect/critic/executor/verifier ← oh-my-claudecode `agents/*.md`
 *   - code-reviewer/security-reviewer/debugger/test-engineer ← Nexus-Code
 *     `~/.nexus/agents/*.md` (Nexus' customized variants of the same OMC roles)
 * (MIT licensed, see THIRD_PARTY_NOTICES.md). They are kept as plain Markdown
 * assets so the ported prompts remain diffable against their upstream source,
 * and are loaded at runtime relative to the module URL — independent of
 * `process.cwd()` and of the bundler's asset handling.
 * @module oh-my-deepseek/roles
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Role names this bundle ships. */
export const ROLE_NAMES = [
  'planner',
  'architect',
  'critic',
  'executor',
  'verifier',
  'code-reviewer',
  'security-reviewer',
  'debugger',
  'test-engineer',
] as const

export type RoleName = (typeof ROLE_NAMES)[number]

/** Load one role prompt verbatim from the bundled Markdown asset. */
export function loadRole(name: RoleName): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return readFileSync(join(here, 'roles', `${name}.md`), 'utf8')
}

/**
 * Load every role this bundle ships, keyed by role name. Used by the plugins to
 * inject the full upstream role prompt into each worker.
 */
export function loadAllRoles(): Record<RoleName, string> {
  const roles = {} as Record<RoleName, string>
  for (const name of ROLE_NAMES) {
    roles[name] = loadRole(name)
  }
  return roles
}
