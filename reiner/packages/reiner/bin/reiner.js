#!/usr/bin/env node
/**
 * @file The `reiner` command: the CLI from `@co-reiner/cli` with the harnesses and plugins this package
 * bundles. To bundle another, add its package as a dependency and its entry to the lists below.
 * @see {@link ../../../docs/architecture/tech-stack.md#distribution | Tech stack: distribution}
 * @see {@link ../../../docs/architecture/modules.md#adding-a-harness | Harness modules: adding a harness}
 */
import { run } from '@co-reiner/cli/run';

// Loaded after the CLI has registered tsx, because these packages ship TypeScript source for now.
await run(
  async () => {
    const { m365CopilotHarness } = await import('@co-reiner/harness-ms');
    const { googleSearchHarness } = await import('@co-reiner/harness-gs');
    return [m365CopilotHarness, googleSearchHarness];
  },
  async () => {
    const { mcpPlugin } = await import('@co-reiner/mcp');
    return [mcpPlugin];
  },
);
