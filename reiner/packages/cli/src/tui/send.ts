/**
 * @file One send in a chat turn: the message (in parts when it has more files than the harness takes),
 * the streamed reply, printing it, and recording what the chat now has.
 * @see {@link ../../../../docs/architecture/tool-protocol.md#messages-in-parts | Tool protocol: messages in parts}
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 */
import { type ChatReply, type HarnessModule, messageParts, type PreparedPrompt } from '@co-reiner/core';
import type { CommandApi } from './commands.ts';
import { hasCommand } from './hints.ts';

/** What a send needs of the chat loop. */
export interface SendDeps {
  api: CommandApi;
  setBusy(label: string | null): void;
  setStreaming(markdown: string | null): void;
  trackChat(chat: Awaited<ReturnType<NonNullable<HarnessModule['currentChat']>>>): void;
}

/** Send one message and stream its reply into the live area. */
async function sendOne(d: SendDeps, module: HarnessModule, message: PreparedPrompt): Promise<ChatReply> {
  const name = module.displayName;
  for (const note of message.notes ?? []) d.api.print({ kind: 'info', text: note });
  d.setStreaming('');
  const reply = await module.send(message.prompt, {
    ...(message.attachments.length ? { attachments: message.attachments } : {}),
    onStatus: (s) => d.setBusy(`${s} (Esc to stop)`),
    onDelta: (markdown) => {
      d.setStreaming(markdown);
      d.setBusy(`${name} is writing… (Esc to stop)`);
    },
  });
  d.setStreaming(null);
  return reply;
}

/**
 * Send a prepared message: in parts when it has more files than the harness takes with one message. The
 * replies to the earlier parts are printed but not read for tool calls or changes; one that was stopped,
 * or not sent, ends the turn there. Then the reply to the last part is printed, and the exchange records
 * what the chat now has.
 */
export async function sendRound(
  d: SendDeps,
  module: HarnessModule,
  prepared: PreparedPrompt,
  original: string,
): Promise<{ reply: ChatReply; chatId: string | undefined }> {
  const parts = messageParts(prepared, module.maxAttachments);
  if (parts.length > 1) {
    d.api.print({
      kind: 'info',
      text: `${prepared.attachments.length} files are more than ${module.displayName} takes at once: sending in ${parts.length} parts.`,
    });
  }
  let reply: ChatReply | undefined;
  let whole = false;
  for (const [i, part] of parts.entries()) {
    if (i > 0) d.setBusy(`Sending part ${i + 1} of ${parts.length} to ${module.displayName}…`);
    reply = await sendOne(d, module, part);
    if (reply.notSent) {
      // Cancelled inside the harness before the prompt went: nothing to print or record as sent.
      d.api.print({ kind: 'info', text: `Cancelled before the prompt reached ${module.displayName}.` });
      for (const note of reply.notes ?? []) d.api.print({ kind: 'warning', text: note });
      return { reply, chatId: undefined };
    }
    printReply(d.api, module, reply);
    whole = i === parts.length - 1;
    if (reply.stopped && !whole) {
      d.api.print({
        kind: 'info',
        text: `Stopped after part ${i + 1} of ${parts.length}; the rest was not sent.`,
      });
      break;
    }
  }
  const last = reply as ChatReply;
  // The first prompt in a new chat creates it in the harness; show it in the status line.
  const current = await module.currentChat?.().catch(() => undefined);
  d.trackChat(current);
  // Only a message that went whole is recorded as sent: a stopped part leaves the later files unsent.
  if (whole) {
    await module.exchange?.afterSend(current?.id, prepared, original);
  }
  return { reply: last, chatId: current?.id };
}

export function printReply(api: CommandApi, module: HarnessModule, reply: ChatReply): void {
  const name = module.displayName;
  const model = reply.model ? { model: reply.model } : {};
  api.print({
    kind: 'assistant',
    markdown: reply.markdown,
    harness: name,
    elapsedMs: reply.elapsedMs,
    stopped: reply.stopped,
    ...model,
  });
  if (reply.closedDocument) {
    api.print({
      kind: 'info',
      text: `Closed the document ${name} opened for co-editing, so it leaves the prompt context.`,
    });
  }
  for (const note of reply.notes ?? []) api.print({ kind: 'warning', text: note });
  if (!reply.markdown && !reply.stopped) {
    api.print({
      kind: 'error',
      text: `No reply text could be read from ${name}. Check the browser window${hasCommand(module, 'history') ? ', or run /history' : ''}.`,
    });
  }
  void api.session.transcript.append({
    role: 'assistant',
    text: reply.markdown,
    harness: module.id,
    elapsedMs: reply.elapsedMs,
    stopped: reply.stopped,
    ...model,
  });
}
