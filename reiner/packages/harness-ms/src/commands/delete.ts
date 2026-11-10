/**
 * @file The `/delete` command: delete a chat after a y/N question, refusing "(Keep)" chats.
 * @see {@link ../../docs/commands.md#yn-questions-and-keep | Copilot's slash commands: y/N questions and (Keep)}
 * @see {@link ../../docs/commands.md#choosing-a-chat | Copilot's slash commands: choosing a chat}
 * @see {@link ../../docs/commands.md#argument-completion | Copilot's slash commands: argument completion}
 */
import type { HarnessCommand } from '@co-reiner/core';
import { isKeepChat } from '../copilot/chats.ts';
import { findChat, status } from './shared.ts';
import type { ChatHarness } from './types.ts';

export const deleteCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'delete',
  complete: 'chat',
  args: '[name or number]',
  description: 'Delete a chat from the harness (the open one by default); asks first',
  async run(host, args) {
    const query = args.join(' ').trim();
    const chat = query
      ? await findChat(host, self, query)
      : await self.currentChat({ onStatus: status(host) });
    if (!chat) {
      if (!query) host.print({ kind: 'error', text: 'No saved chat is open. Name the chat to delete.' });
      return;
    }
    const title = chat.title || chat.id;
    if (isKeepChat(title)) {
      host.print({
        kind: 'error',
        text: `"${title}" is marked (Keep). Rename it first if you really want to delete it.`,
      });
      return;
    }
    host.busy(null);
    const yes = await host.confirm(`Delete "${title}" from ${self.displayName}? This cannot be undone.`);
    if (!yes) {
      host.print({ kind: 'info', text: 'Not deleted.' });
      return;
    }
    host.busy('Deleting…');
    // Asked before deleting: afterwards the tab may still show the deleted chat's address.
    const wasOpen = (await self.currentChat())?.id === chat.id;
    await self.deleteChat(chat.id, { onStatus: status(host) });
    host.log(`deleted chat ${title}`);
    if (!wasOpen) {
      host.setChat(await self.currentChat());
      host.print({ kind: 'success', text: `Deleted "${title}".` });
      return;
    }
    // The tab would stay on the deleted conversation, and the next prompt would go into it.
    const started = await self.newChat({ onStatus: status(host) });
    host.setChat(undefined);
    const model = started?.appliedModel ? ` with ${started.appliedModel.label}` : '';
    host.print({ kind: 'success', text: `Deleted "${title}" and started a new chat${model}.` });
    for (const note of started?.notes ?? []) host.print({ kind: 'warning', text: note });
  },
});
