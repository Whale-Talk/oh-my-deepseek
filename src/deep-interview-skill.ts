/**
 * Embedded `deep-interview` skill provider, mirroring DSH's `skill-badge`
 * pattern: registers a fixed skill on `ctx.skills` whose body is the ported
 * Socratic-interview playbook. The skill body lives at
 * `lib/skills/deep-interview.md` (copied from `src/skills/` at build time) and
 * is read relative to the module URL, independent of `process.cwd()`.
 * @module oh-my-deepseek/deep-interview-skill
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'oh-my-deepseek'
const SKILL_BODY_URL = new URL('./skills/deep-interview.md', import.meta.url)
const SKILL_NAME = 'deep-interview'
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('./skills/', import.meta.url)),
} as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const
const DESCRIPTION = 'Socratic deep interview with mathematical ambiguity gating before execution: ask the user one question at a time to expose hidden assumptions, score clarity across weighted dimensions each round via the deep_interview_score tool, and refuse to proceed until ambiguity drops below the threshold. Use when the user has a vague idea ("interview me", "don\'t assume", "make sure you understand", "ouroboros", "I have a vague idea"). Do NOT use for a detailed request with file paths or acceptance criteria.'

const CANDIDATE: SkillCandidate = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(candidate): Promise<SkillDefinition | undefined> {
    void candidate
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

export const name = 'deep-interview-skill'
export const inject = ['skills']

/** Register the embedded `deep-interview` skill on `ctx.skills`. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
