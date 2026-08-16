import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/ralplan.ts', 'src/team.ts'],
  format: ['esm'],
  outDir: 'lib',
  clean: true,
  // Every @deepseek-ai/* package is provided by the DeepSeek Harness installation
  // at runtime (the profile's parent-walk resolves them from the installed tree).
  // Keep them external so the bundle stays thin and never duplicates the host.
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/schemastery',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-workflow',
    '@deepseek-ai/dsh-subagent',
    '@deepseek-ai/dsh-system-prompt',
  ],
})
