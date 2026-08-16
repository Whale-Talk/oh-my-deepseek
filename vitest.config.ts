import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // The two plugin modules (ralplan.ts / team.ts) are DSH glue that imports
      // the not-yet-published @deepseek-ai/* packages, so they are exercised by
      // the loader in a real profile, not by these unit tests. The testable core
      // is the fixed orchestration logic below; cover it to the "core ≥ 90%"
      // bar from the personal spec.
      include: ['src/shared.ts', 'src/scripts.ts'],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
})
