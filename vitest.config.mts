import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the reusable offline specs run under `npm test`. Tests that need a
    // paid API are plain .ts scripts, run explicitly via `npm run test:ai`.
    include: ['tests/**/*.spec.ts'],
    exclude: ['node_modules/**'],
    environment: 'node',
    // Playwright's launch helpers are slow to import; keep the default pool but
    // give each file a generous ceiling so a stalled import fails loudly.
    testTimeout: 15000,
  },
});
