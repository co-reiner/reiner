/**
 * @file The `/rename` command: rename the open chat with the harness's own control.
 * @see {@link ../../docs/commands.md#commands | Copilot's slash commands: commands}
 */
import type { HarnessCommand } from '@co-reiner/core';
import { status } from './shared.ts';
import type { ChatHarness } from './types.ts';

export const renameCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'rename',
  args: '<new title>',
  description: 'Rename the open chat',
  async run(host, args) {
    const title = args.join(' ').trim();
    if (!title) {
      host.print({ kind: 'error', text: 'Give the new title, e.g. /rename Release notes draft' });
      return;
    }
    const chat = await self.renameChat(title, { onStatus: status(host) });
    host.setChat(chat);
    host.print({ kind: 'success', text: `Renamed the chat to "${chat.title}".` });
  },
});
