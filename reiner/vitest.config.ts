/**
 * @file Vitest configuration: runs every package's offline tests; live checks are separate scripts.
 * @see {@link docs/architecture/tech-stack.md#recommendation-typescript-on-nodejs-playwright-ink | Tech stack: recommendation}
 * @see {@link AGENTS.md#live-checks | AGENTS.md: live checks}
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}'],
    // Many tests run git, build pack indexes or drive the TUI; a full parallel run can pass the 5 s default.
    testTimeout: 20_000,
  },
});
