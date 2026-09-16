import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the reusable specs run under `npm test`. One-off probe scripts live
    // in scripts/ and are never part of the suite.
    include: ['tests/**/*.spec.ts'],
    // These need a real browser or a paid API and must stay out of the offline
    // suite; run them explicitly via npm run test:browser / test:ai.
    exclude: ['tests/test-stealth.spec.ts', 'node_modules/**'],
    environment: 'node',
    // Playwright's launch helpers are slow to import; keep the default pool but
    // give each file a generous ceiling so a stalled import fails loudly.
    testTimeout: 15000,
  },
});
