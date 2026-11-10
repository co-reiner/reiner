/**
 * @file The `/chats` command: list the harness's recent chats.
 * @see {@link ../../docs/commands.md#commands | Copilot's slash commands: commands}
 */
import type { HarnessCommand } from '@co-reiner/core';
import { status } from './shared.ts';
import type { ChatHarness } from './types.ts';

export const chatsCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'chats',
  description: "List the harness's recent chats",
  async run(host) {
    const chats = await self.listChats({ onStatus: status(host) });
    // The open chat is asked for by itself (the tab's URL): it may not be in the recent list at all.
    host.setChat(await self.currentChat());
    host.print({ kind: 'chats', chats });
  },
});
