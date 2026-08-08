import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      // `src/index.ts` is the Firebase adapter: importing it calls
      // `initializeApp()` and `getFirestore()` at module load, so it cannot be
      // unit-tested without an emulator or a live project. It is deliberately
      // kept to thin glue — claim check, payload parse, patch build, error map —
      // and every decision it delegates to lives in `policy.ts`, which is what
      // these thresholds cover. The gap is recorded in docs/vcqa-report.md.
      include: ['src/policy.ts'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
});
