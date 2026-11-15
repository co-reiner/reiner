/**
 * @file Tests for messages in parts: how files are split, and what each part says.
 * @see {@link ../../../docs/architecture/tool-protocol.md#messages-in-parts | Tool protocol: messages in parts}
 */
import { describe, expect, it } from 'vitest';
import { messageParts } from '../src/index.ts';

const files = (n: number) => Array.from({ length: n }, (_, i) => `f${i + 1}.png`);

describe('messageParts', () => {
  it('keeps a message within the limit, or without one, as it is', () => {
    const message = { prompt: 'hi', attachments: files(3), notes: ['n'] };
    expect(messageParts(message, 3)).toEqual([message]);
    expect(messageParts({ ...message, attachments: files(9) }, undefined)).toHaveLength(1);
  });

  it('splits the files in order, announces the parts first, and puts the text last', () => {
    const parts = messageParts({ prompt: 'the answer', attachments: files(7), notes: ['pack note'] }, 3);
    expect(parts.map((p) => p.attachments)).toEqual([files(3), ['f4.png', 'f5.png', 'f6.png'], ['f7.png']]);
    expect(parts[0]?.prompt).toBe(
      'This answer is too large for one message, so it comes in 3 parts. Wait for part 3 before you continue, and reply to the parts before it only with "waiting".\n\nPart 1 of 3.',
    );
    expect(parts[0]?.notes).toEqual(['pack note']);
    expect(parts[1]).toEqual({
      prompt: 'Part 2 of 3. Reply only with "waiting".',
      attachments: parts[1]?.attachments,
    });
    expect(parts[2]?.prompt).toBe('Part 3 of 3, the last.\n\nthe answer');
    expect(parts[2]?.notes).toBeUndefined();
  });
});
