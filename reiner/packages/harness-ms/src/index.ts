/**
 * @file Public entry point of `@co-reiner/harness-ms`: the `m365-copilot` harness entry and its commands.
 * @see {@link ../docs/module.md#settings | Copilot module: settings}
 * @see {@link ../../../docs/architecture/modules.md#adding-a-harness | Harness modules: adding a harness}
 */
import type { HarnessEntry } from '@co-reiner/core';
import { createCopilotModule } from './copilot/module.ts';
import { COPILOT_URL } from './copilot/selectors.ts';

export { type ChatHarness, chatHarnessCommands, type PackHarness } from './commands/index.ts';
export { createCopilotModule } from './copilot/module.ts';

/** Microsoft 365 Copilot Chat, driven through its web page. */
export const m365CopilotHarness: HarnessEntry = {
  id: 'm365-copilot',
  displayName: 'Microsoft 365 Copilot',
  description: 'Copilot Chat in the browser, signed in with your work or school account',
  // include/exclude start empty so new configs show where the glob and grep patterns go.
  defaultSettings: { url: COPILOT_URL, include: [], exclude: [] },
  create: createCopilotModule,
};
