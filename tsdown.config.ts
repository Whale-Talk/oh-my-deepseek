import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/ralplan.ts',
    'src/team.ts',
    'src/scoring.ts',
    'src/deep-interview.ts',
    'src/deep-interview-skill.ts',
    'src/vision.ts',
    'src/exa-search.ts',
  ],
  format: ['esm'],
  outDir: 'lib',
  clean: true,
  // Keep chunk filenames stable (no content hash) so `lib/*.js` matches the
  // package.json `exports` map exactly.
  hash: false,
  // Emit `.js` (not `.mjs`) to match the `exports` map and `main`.
  outExtensions: () => ({ js: '.js' }),
  // Every @deepseek-ai/* package is provided at runtime by the DeepSeek Harness
  // installation (the profile's node_modules), not by this package. Keep them
  // external so the bundle stays thin and never duplicates the host.
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/schemastery',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-workflow',
      '@deepseek-ai/dsh-subagent',
      '@deepseek-ai/dsh-system-prompt',
      '@deepseek-ai/dsh-skill',
      '@deepseek-ai/dsh-web',
    ],
  },
})
