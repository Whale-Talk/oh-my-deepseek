// Link the @deepseek-ai peer dependencies into this package's node_modules.
//
// The @deepseek-ai/* packages are NOT published to npm yet (DSH is pre-1.0),
// so `npm install` cannot fetch the peerDependencies and `legacy-peer-deps`
// deliberately skips them. At runtime the DeepSeek Harness installation
// provides them under `$DSH_HOME/profiles/node_modules/@deepseek-ai` (the
// `healProfilesModuleFallback` flat tree). Because a `link:`/`file:` install
// resolves this package's real path (Node realpaths the symlink), its internal
// `import "@deepseek-ai/..."` walks up from THIS directory and needs the
// symlinks here — the profile's node_modules is not on that walk.
//
// This script mirrors the runtime packages into `node_modules/@deepseek-ai`
// (symlinks, gitignored), so `lib/ralplan.js` / `lib/team.js` resolve their
// peer deps the same way the loader will at runtime.
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const profilesRoot = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'profiles', 'node_modules', '@deepseek-ai')
  : join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai')

// The runtime (non-type-only) peer imports plus the full declared peer set.
const peers = [
  'cordis',
  'schemastery',
  'dsh-tools',
  'dsh-llm',
  'dsh-session',
  'dsh-workflow',
  'dsh-subagent',
  'dsh-system-prompt',
  'dsh-skill',
]

const dest = join(root, 'node_modules', '@deepseek-ai')
mkdirSync(dest, { recursive: true })

let linked = 0
for (const peer of peers) {
  const source = join(profilesRoot, peer)
  if (!existsSync(source)) {
    console.warn(`[link-peers] SKIP ${peer}: not found at ${source}`)
    continue
  }
  const target = join(dest, peer)
  try {
    symlinkSync(source, target, 'dir')
    linked += 1
  } catch (error) {
    // Already-linked or a transient race is fine; report only real failures.
    if (error.code !== 'EEXIST') throw error
  }
}
console.log(`[link-peers] linked ${linked} @deepseek-ai peer(s) from ${profilesRoot}`)
