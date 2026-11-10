/**
 * @file Chats in the harness module contract: what a chat is, one turn of its history, and what to say
 * when an opened chat shows another model than the project's.
 * @see {@link ../../../docs/architecture/modules.md#contract | Harness modules: contract}
 */
import type { StatusListener } from './harness.ts';

/** A conversation in the harness's chat history. */
export interface ChatInfo {
  /** The harness's conversation id (from its URL). */
  id: string;
  title: string;
  /** True for a chat with one of the harness's agents rather than the plain chat. */
  agent?: boolean;
  /** True for the chat open in the tab. */
  current?: boolean;
  /** After opening: the model the chat shows once it has loaded. Opening a chat never changes it. */
  model?: string;
  /** After opening, only when it differs from `model`: the project's saved model, which was not applied. */
  savedModel?: string;
}

/** What to tell the user when an opened chat shows another model than the project's saved one. */
export function chatModelNote(chat: ChatInfo): string | undefined {
  if (!chat.savedModel || !chat.model) return undefined;
  return `This chat uses ${chat.model}; the project's model is ${chat.savedModel}. Reiner keeps the chat's model: /model switches it.`;
}

/** One prompt and the reply to it, as read back from the harness's page. */
export interface HistoryTurn {
  prompt: string;
  /** The reply as markdown. Empty if the turn has no reply (yet). */
  reply: string;
}

export interface ChatActionOptions {
  onStatus?: StatusListener;
  /**
   * Aborted when the user cancels (Esc while a command runs). A module that takes it stops at its next
   * safe step and throws, saying what was and was not done; one that does not simply runs to the end.
   */
  signal?: AbortSignal;
}
