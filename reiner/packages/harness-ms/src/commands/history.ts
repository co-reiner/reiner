/**
 * @file The `/history` command: show the open chat's latest turns, read back from the page.
 * @see {@link ../../docs/commands.md#commands | Copilot's slash commands: commands}
 */
import type { HarnessCommand } from '@co-reiner/core';
import { status } from './shared.ts';
import type { ChatHarness } from './types.ts';

export const historyCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'history',
  args: '[turns]',
  description: 'Show the latest turns of the open chat (default 5)',
  async run(host, args) {
    const turns = await self.readHistory({
      turns: Math.max(1, Number(args[0]) || 5),
      onStatus: status(host),
    });
    if (turns.length === 0) {
      host.print({ kind: 'info', text: 'This chat has no messages yet.' });
      return;
    }
    const chat = await self.currentChat();
    host.print({ kind: 'history', turns, title: chat?.title ?? '', harness: self.displayName });
  },
});
