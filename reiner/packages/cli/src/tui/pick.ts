/**
 * @file Keys for a pick list under the prompt: move, tick one row or all of them, confirm or cancel.
 * @see {@link ../../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 */
import type { Key } from 'ink';
import type { Question } from './command-api.ts';

export type PickQuestion = Extract<Question, { kind: 'pick' }>;

/** Tick every option, or none when all are ticked already. */
function toggleAll(q: PickQuestion): number[] {
  return q.ticked.length === q.options.length ? [] : q.options.map((_, i) => i);
}

/** Tick or untick the row under the cursor; row 0 is "(Select all)". */
function toggleRow(q: PickQuestion): number[] {
  if (q.cursor === 0) return toggleAll(q);
  const i = q.cursor - 1;
  return q.ticked.includes(i) ? q.ticked.filter((t) => t !== i) : [...q.ticked, i].sort((a, b) => a - b);
}

/**
 * Apply one key to a pick list. ↑/↓ move (wrapping), Space ticks the row (on "(Select all)", all rows), `a`
 * ticks all, Enter answers with the ticked rows, Esc answers with none. Returns the list's next state, or
 * undefined when the key answered it or does nothing.
 */
export function pickKey(q: PickQuestion, char: string, key: Key): PickQuestion | undefined {
  const rows = q.options.length + 1;
  if (key.upArrow || key.downArrow)
    return { ...q, cursor: (q.cursor + (key.upArrow ? -1 : 1) + rows) % rows };
  if (char === ' ') return { ...q, ticked: toggleRow(q) };
  if (char === 'a' || char === 'A') return { ...q, ticked: toggleAll(q) };
  if (key.return) q.answer(q.ticked);
  else if (key.escape) q.answer([]);
  return undefined;
}
