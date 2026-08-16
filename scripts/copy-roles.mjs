// Copy the role Markdown assets into lib/ after tsdown builds, so the bundled
// package carries them next to the compiled entry points. `lib/roles/*.md` is
// what loadRole() reads at runtime via `new URL('./roles/<name>.md', import.meta.url)`.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const from = join(root, 'src', 'roles')
const to = join(root, 'lib', 'roles')

mkdirSync(to, { recursive: true })
cpSync(from, to, { recursive: true })
console.log(`[copy-roles] ${from} -> ${to}`)
