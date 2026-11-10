/**
 * @file The `/chat` command: show the open chat, or switch to one by name or number and show its last turns.
 * @see {@link ../../docs/commands.md#choosing-a-chat | Copilot's slash commands: choosing a chat}
 * @see {@link ../../docs/commands.md#argument-completion | Copilot's slash commands: argument completion}
 */
import { chatModelNote, type HarnessCommand } from '@co-reiner/core';
import { findChat, status } from './shared.ts';
import type { ChatHarness } from './types.ts';

export const chatCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'chat',
  complete: 'chat',
  args: '<name or number>',
  description: 'Switch to another chat, e.g. /chat large chat or /chat 2',
  async run(host, args) {
    const query = args.join(' ').trim();
    if (!query) {
      const current = await self.currentChat({ onStatus: status(host) });
      host.print({
        kind: 'info',
        text: current
          ? `Open chat: ${current.title || current.id}`
          : 'A new chat is open (not saved until you send a prompt).',
      });
      return;
    }
    const chat = await findChat(host, self, query);
    if (!chat) return;
    const opened = await self.openChat(chat.id, { onStatus: status(host) });
    const title = opened.title || chat.title;
    host.setChat({ ...opened, title });
    host.log(`opened chat ${title}`);
    host.print({ kind: 'success', text: `Opened chat "${title}".` });
    // The chat keeps its own model; a difference from the project's model is reported, never switched.
    const note = chatModelNote(opened);
    if (note) host.print({ kind: 'warning', text: note });
    const turns = await self.readHistory({ turns: 3, onStatus: status(host) });
    if (turns.length > 0) host.print({ kind: 'history', turns, title, harness: self.displayName });
  },
});
