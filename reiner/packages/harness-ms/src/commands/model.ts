/**
 * @file The `/model` command: show the project's model, or pick one by part of its name. A pick switches the
 * open chat at once and is saved as the project's model for new chats.
 * @see {@link ../../docs/commands.md#argument-completion | Copilot's slash commands: argument completion}
 * @see {@link ../../docs/module.md#models | Copilot module: models}
 */
import type { HarnessCommand } from '@co-reiner/core';
import { status } from './shared.ts';
import type { ChatHarness } from './types.ts';

export const modelCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'model',
  complete: 'model',
  args: '<name>',
  description: 'Pick a model in the harness, e.g. /model think deeper or /model sol quick',
  async run(host, args) {
    const query = args.join(' ').trim();
    if (!query) {
      host.print({ kind: 'model-current', preference: await host.modelPreference() });
      return;
    }
    const result = await self.selectModel(query, { onStatus: status(host) });
    host.setSignIn(result.signIn);
    host.print({ kind: 'model', result, query });
  },
});
