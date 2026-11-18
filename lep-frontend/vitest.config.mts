import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest runs the pure TypeScript: normaliser, grader, content adapter, auth mutex, problem
// parsing, outbox, runner machine and the guardrail scans (DECISIONS §6.2). Nothing here may
// import react-native; component tests run under Jest (jest.config.js).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/guardrails/**/*.test.ts', 'tests/sweep/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
