/**
 * @file Splitting a message with more files than the harness takes at once into parts: the first says how
 * many follow, the last carries the text.
 * @see {@link ../../../docs/architecture/tool-protocol.md#messages-in-parts | Tool protocol: messages in parts}
 * @see {@link ../../../docs/architecture/modules.md#required-and-optional | Harness modules: required and optional}
 */
import type { PreparedPrompt } from './exchange.ts';

/** What the model is asked to reply to every part but the last. */
export const PART_REPLY = 'waiting';

/**
 * The parts to send `prepared` in, when it has more than `max` files: each part carries up to `max` of
 * them, in order. The first part says how many parts there are and asks the model to wait for the last;
 * the last carries the message's whole text, so the model reads it with every file already in the chat.
 * A message within the limit (or with no limit) is one part, unchanged.
 */
export function messageParts(prepared: PreparedPrompt, max: number | undefined): PreparedPrompt[] {
  const files = prepared.attachments;
  if (!max || max < 1 || files.length <= max) return [prepared];
  const count = Math.ceil(files.length / max);
  return Array.from({ length: count }, (_, i): PreparedPrompt => {
    const attachments = files.slice(i * max, (i + 1) * max);
    const n = i + 1;
    if (n === count) {
      const { notes: _shownWithPart1, ...rest } = prepared;
      return { ...rest, prompt: `Part ${n} of ${count}, the last.\n\n${prepared.prompt}`, attachments };
    }
    const prompt =
      n === 1
        ? `This answer is too large for one message, so it comes in ${count} parts. Wait for part ${count} before you continue, and reply to the parts before it only with "${PART_REPLY}".\n\nPart 1 of ${count}.`
        : `Part ${n} of ${count}. Reply only with "${PART_REPLY}".`;
    // Notes about the files (what is attached and why) are shown once, with the first part.
    return { prompt, attachments, ...(n === 1 && prepared.notes ? { notes: prepared.notes } : {}) };
  });
}
