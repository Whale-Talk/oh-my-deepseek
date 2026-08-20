// Generate the specialist-tools rows for cordis.patch.yml from the role
// Markdown assets. Each specialist is a `@deepseek-ai/dsh-tool-subagent`
// instance whose `persona` is the full role prompt (read-only roles also deny
// the file-mutation tools). Run `node scripts/gen-specialist-patch.mjs` after
// changing a role file; it rewrites the `omd-specialist-*` block in
// cordis.patch.yml in place.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const patchPath = join(root, 'cordis.patch.yml')
const rolesDir = join(root, 'src', 'roles')

/** One specialist row spec: role asset, tool name, read-only flag, description. */
const SPECIALISTS = [
  {
    id: 'omd-specialist-code-reviewer',
    toolName: 'code_reviewer',
    role: 'code-reviewer',
    readOnly: true,
    description: 'Expert code review specialist: severity-rated feedback, logic defects, SOLID checks, style and performance. Read-only (reviews, never edits).',
  },
  {
    id: 'omd-specialist-security-reviewer',
    toolName: 'security_reviewer',
    role: 'security-reviewer',
    readOnly: true,
    description: 'Security audit specialist: vulnerabilities, trust boundaries, authn/authz, data exposure. Read-only (audits, never edits).',
  },
  {
    id: 'omd-specialist-debugger',
    toolName: 'debugger',
    role: 'debugger',
    readOnly: false,
    description: 'Root-cause analysis and debugging specialist: reproduces, isolates, and fixes build/type/runtime failures.',
  },
  {
    id: 'omd-specialist-test-engineer',
    toolName: 'test_engineer',
    role: 'test-engineer',
    readOnly: false,
    description: 'Test strategy and implementation specialist: writes tests, hardens coverage, fixes flaky tests.',
  },
]

/** Render one specialist as YAML rows. */
function renderSpecialist(spec) {
  const persona = readFileSync(join(rolesDir, `${spec.role}.md`), 'utf8')
  const lines = [
    `    - id: ${spec.id}`,
    "      name: '@deepseek-ai/dsh-tool-subagent'",
    '      config:',
    `        provider: spawn`,
    `        toolName: ${spec.toolName}`,
    `        description: ${JSON.stringify(spec.description)}`,
    '        enableRunInBackground: false',
    '        maxDepth: 1',
    '        persona: |',
    // Indent every persona line by 10 spaces (YAML block scalar content).
    ...persona.split('\n').map(line => `          ${line}`),
  ]
  if (spec.readOnly) {
    lines.push(
      '        toolFilter:',
      '          deny:',
      '            - write',
      '            - edit',
      '            - str_replace_editor',
    )
  }
  return lines.join('\n')
}

const patch = readFileSync(patchPath, 'utf8')
const generated = SPECIALISTS.map(renderSpecialist).join('\n\n')
// Insert the specialist rows inside the `- insert:` list, right after the
// `omd-exa-search` row (its final line). The block is wrapped in markers so a
// re-run replaces the previous generated rows cleanly.
const START = '    # --- specialist-tools (generated) ---'
const END = '    # --- end specialist-tools ---'
const startIdx = patch.indexOf(START)
const endIdx = patch.indexOf(END)
let next
if (startIdx === -1 || endIdx === -1) {
  // First run: anchor after the omd-exa-search row's config end (numResults line).
  const anchor = '        numResults: 6\n'
  const at = patch.indexOf(anchor)
  if (at === -1) throw new Error('anchor "numResults: 6" not found in cordis.patch.yml')
  const block = `${START}\n${generated}\n${END}\n`
  next = `${patch.slice(0, at + anchor.length)}${block}${patch.slice(at + anchor.length)}`
} else {
  const block = `${START}\n${generated}\n${END}`
  next = `${patch.slice(0, startIdx)}${block}${patch.slice(endIdx + END.length)}`
}
writeFileSync(patchPath, next)
console.log(`[gen-specialist-patch] updated ${patchPath} with ${SPECIALISTS.length} specialist rows`)
