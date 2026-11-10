/**
 * @file The `/new` command: start a new chat with the harness's own control.
 * @see {@link ../../docs/commands.md#commands | Copilot's slash commands: commands}
 */
import type { HarnessCommand } from '@co-reiner/core';
import { status } from './shared.ts';
import type { ChatHarness } from './types.ts';

export const newCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'new',
  description: 'Start a new chat in the harness',
  async run(host) {
    const result = await self.newChat({ onStatus: status(host) });
    host.setChat(undefined);
    void host.log('new chat');
    const model = result?.appliedModel ? ` with ${result.appliedModel.label}` : '';
    host.print({ kind: 'success', text: `New chat started in ${self.displayName}${model}.` });
    for (const note of result?.notes ?? []) host.print({ kind: 'warning', text: note });
  },
});
