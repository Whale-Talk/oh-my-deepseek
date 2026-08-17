import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // The plugin modules (ralplan.ts / team.ts / deep-interview.ts /
      // deep-interview-skill.ts / vision.ts) are DSH glue that imports the
      // not-yet-published @deepseek-ai/* packages and makes network calls, so
      // they are exercised by the loader in a real profile, not by these unit
      // tests. The testable core is the fixed orchestration logic, the
      // deterministic scoring math, and the pure helpers below; cover it to the
      // "core ≥ 90%" bar from the personal spec.
      include: ['src/shared.ts', 'src/scripts.ts', 'src/scoring.ts', 'src/vision-core.ts'],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
})
