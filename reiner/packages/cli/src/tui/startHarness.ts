/**
 * @file Opens the active harness's browser, checks sign-in and reopens the chat that was open last time.
 * @see {@link ../../../../docs/architecture/cli-ux.md#startup | CLI and TUI: startup}
 * @see {@link ../../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: harnesses and the live browser}
 */
import {
  type ChatInfo,
  chatModelNote,
  type HarnessModule,
  type SignInState,
  type StartResult,
} from '@co-reiner/core';
import type { Session } from '../session.ts';
import type { Entry } from './entries.ts';

export interface StartDeps {
  session: Session;
  print(entry: Entry): void;
  setBusy(label: string | null): void;
  setSignIn(state: SignInState): void;
  trackChat(chat: ChatInfo | undefined): void;
  refreshCache(): void;
}

/** Open the active harness's browser, check sign-in, and pick up the chat the user had open last time. */
export async function startHarness(d: StartDeps): Promise<void> {
  const module = d.session.module;
  if (!module) return;
  d.setBusy(`Opening ${module.displayName}…`);
  try {
    // The last chat opens as part of start, before any model is applied: it keeps the model it shows.
    const last = module.openChat ? await d.session.lastOpenChat() : undefined;
    const onStatus = (s: string) => d.setBusy(last && /chat/i.test(s) ? `${s} (your last chat)` : s);
    const result = await module.start({ onStatus, ...(last ? { chatId: last.id } : {}) });
    d.setSignIn(result.signIn);
    d.print({ kind: 'started', result, harness: module.displayName });
    if (result.signIn.signedIn) await resumeLastChat(d, module, last, result);
  } catch (error) {
    d.print({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
  } finally {
    d.setBusy(null);
    d.refreshCache();
  }
}

/**
 * After start: say whether the last chat reopened (and whether its model differs from the project's), then
 * show its latest turns, for harnesses that keep a chat history. A harness that ignored `chatId` gets the
 * chat opened here instead.
 */
async function resumeLastChat(
  d: StartDeps,
  module: HarnessModule,
  last: ChatInfo | undefined,
  result: StartResult,
): Promise<void> {
  if (!module.openChat || !module.currentChat) return;
  let opened = result.chat;
  if (last && !opened && result.chatError === undefined) {
    opened = await module
      .openChat(last.id, { onStatus: (s) => d.setBusy(`${s} (your last chat)`) })
      .catch(() => undefined);
  }
  if (last && !opened)
    d.print({ kind: 'info', text: `Could not reopen your last chat "${last.title}". Starting a new one.` });
  const note = opened ? chatModelNote(opened) : undefined;
  if (note) d.print({ kind: 'warning', text: note });
  const current = await module.currentChat().catch(() => undefined);
  d.trackChat(current);
  if (!current) return;
  const turns = (await module.readHistory?.({ turns: 3, onStatus: d.setBusy }).catch(() => [])) ?? [];
  if (turns.length > 0) {
    d.print({
      kind: 'history',
      turns,
      title: current.title || last?.title || '',
      harness: module.displayName,
    });
  }
}
