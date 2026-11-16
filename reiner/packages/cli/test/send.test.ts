/**
 * @file Tests for sending a message in parts when it has more files than the harness takes.
 * @see {@link ../../../docs/architecture/tool-protocol.md#messages-in-parts | Tool protocol: messages in parts}
 */
import type { ChatReply, HarnessModule, PreparedPrompt, SendOptions } from '@co-reiner/core';
import { describe, expect, it } from 'vitest';
import { type SendDeps, sendRound } from '../src/tui/send.ts';

/** A harness that takes three files a message and records what it was sent. */
function partsSetup(stopAt?: number) {
  const sent: { prompt: string; files: string[] }[] = [];
  const recorded: PreparedPrompt[] = [];
  const printed: string[] = [];
  const module = {
    id: 'fake',
    displayName: 'Copilot',
    maxAttachments: 3,
    send: async (prompt: string, opts: SendOptions = {}): Promise<ChatReply> => {
      sent.push({ prompt, files: opts.attachments ?? [] });
      return { markdown: 'waiting', stopped: sent.length === stopAt, elapsedMs: 1 };
    },
    currentChat: async () => ({ id: 'c1', title: 'chat' }),
    exchange: { afterSend: async (_id: string, prepared: PreparedPrompt) => void recorded.push(prepared) },
  } as unknown as HarnessModule;
  const d = {
    api: {
      print: (e: { kind: string; text?: string }) => printed.push(`${e.kind}: ${e.text ?? ''}`),
      session: { transcript: { append: async () => {} } },
    },
    setBusy: () => {},
    setStreaming: () => {},
    trackChat: () => {},
  } as unknown as SendDeps;
  const message = { prompt: 'answer', attachments: ['1.png', '2.png', '3.png', '4.png', '5.png'] };
  return { module, d, message, sent, recorded, printed };
}

describe('sending in parts', () => {
  it('sends more files than the harness takes in parts, and records the message once', async () => {
    const { module, d, message, sent, recorded, printed } = partsSetup();
    const { chatId } = await sendRound(d, module, message, '');
    expect(sent.map((s) => s.files)).toEqual([
      ['1.png', '2.png', '3.png'],
      ['4.png', '5.png'],
    ]);
    expect(sent[0]?.prompt).toMatch(/^This answer is too large for one message, so it comes in 2 parts\./);
    expect(sent[1]?.prompt).toBe('Part 2 of 2, the last.\n\nanswer');
    expect(printed[0]).toBe('info: 5 files are more than Copilot takes at once: sending in 2 parts.');
    expect(recorded).toEqual([message]);
    expect(chatId).toBe('c1');
  });

  it('stops after a stopped part, and does not record the message as sent', async () => {
    const { module, d, message, sent, recorded, printed } = partsSetup(1);
    const { reply } = await sendRound(d, module, message, '');
    expect(sent).toHaveLength(1);
    expect(reply.stopped).toBe(true);
    expect(recorded).toEqual([]);
    expect(printed).toContain('info: Stopped after part 1 of 2; the rest was not sent.');
  });
});
