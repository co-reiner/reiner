/**
 * @file Helpers several commands share: status updates, patch number padding and finding a chat.
 * @see {@link ../../docs/commands.md#choosing-a-chat | Copilot's slash commands: choosing a chat}
 */
import { type ChatInfo, type CommandHost, matchChats } from '@co-reiner/core';
import type { ChatHarness } from './types.ts';

export const status = (host: CommandHost) => (s: string) => host.busy(s);

/**
 * Resolve a chat from what the user typed: the last /chats list first (so numbers match what they saw),
 * then a fresh read of the harness's list. Prints the choices and returns undefined when unclear.
 */
export async function findChat(
  host: CommandHost,
  self: ChatHarness,
  query: string,
): Promise<ChatInfo | undefined> {
  let chats = await host.lastChats();
  let found = matchChats(chats, query);
  if (found.length === 0) {
    chats = await self.listChats({ onStatus: status(host) });
    found = matchChats(chats, query);
  }
  if (found.length === 1) return found[0];
  if (found.length === 0)
    host.print({ kind: 'error', text: `No chat in the recent list matches "${query}".` });
  else {
    host.print({
      kind: 'info',
      text: `"${query}" matches ${found.length} chats. Be more specific, or use its number:`,
    });
    host.print({ kind: 'chats', chats: found });
  }
  return undefined;
}
