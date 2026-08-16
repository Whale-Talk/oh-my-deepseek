// Copy the Markdown assets into lib/ after tsdown builds, so the bundled
// package carries them next to the compiled entry points:
//   - lib/roles/*.md   — role prompts, read by loadRole()
//   - lib/skills/*.md  — skill playbooks, read by the embedded skill provider
// Both resolve via `new URL('./roles/…', import.meta.url)` / `new URL('./skills/…', import.meta.url)`.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

for (const asset of ['roles', 'skills']) {
  const from = join(root, 'src', asset)
  const to = join(root, 'lib', asset)
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true })
  console.log(`[copy-assets] ${from} -> ${to}`)
}
