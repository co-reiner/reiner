/**
 * @file Keys for a pick list under the prompt: move, tick one row, a group of rows or all of them, confirm or
 * cancel.
 * @see {@link ../../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 */
import type { PickOption } from '@co-reiner/core';
import type { Key } from 'ink';
import type { Question } from './command-api.ts';

export type PickQuestion = Extract<Question, { kind: 'pick' }>;

/** The rows under group row `i` (rows with an `indent`, up to the next row without one). */
export function groupItems(options: PickOption[], i: number): number[] {
  if (options[i]?.indent) return [];
  const items: number[] = [];
  for (let j = i + 1; j < options.length && options[j]?.indent; j++) items.push(j);
  return items;
}

/** The group row an indented row belongs to. */
function groupOf(options: PickOption[], i: number): number | undefined {
  for (let j = i - 1; j >= 0; j--) if (!options[j]?.indent) return j;
  return undefined;
}

/** Tick every option, or none when all are ticked already. */
function toggleAll(q: PickQuestion): number[] {
  return q.ticked.length === q.options.length ? [] : q.options.map((_, i) => i);
}

/**
 * Tick or untick the row under the cursor; row 0 is "(Select all)". A group row with items sets them all
 * (on, unless all are on already); an item row then sets its group to "all items ticked".
 */
function toggleRow(q: PickQuestion): number[] {
  if (q.cursor === 0) return toggleAll(q);
  const i = q.cursor - 1;
  const ticked = new Set(q.ticked);
  const items = groupItems(q.options, i);
  if (items.length) {
    const on = !items.every((j) => ticked.has(j));
    for (const j of [i, ...items]) on ? ticked.add(j) : ticked.delete(j);
  } else {
    ticked.has(i) ? ticked.delete(i) : ticked.add(i);
    const group = q.options[i]?.indent ? groupOf(q.options, i) : undefined;
    if (group !== undefined) {
      const all = groupItems(q.options, group).every((j) => ticked.has(j));
      all ? ticked.add(group) : ticked.delete(group);
    }
  }
  return [...ticked].sort((a, b) => a - b);
}

/**
 * Apply one key to a pick list. ↑/↓ move (wrapping), Space ticks the row (on "(Select all)", all rows; on a
 * group, its items), `a` ticks all, Enter answers with the ticked rows, Esc cancels (or answers with none
 * when the list cannot be cancelled). Returns the list's next state, or undefined when the key answered it
 * or does nothing.
 */
export function pickKey(q: PickQuestion, char: string, key: Key): PickQuestion | undefined {
  const rows = q.options.length + 1;
  if (key.upArrow || key.downArrow)
    return { ...q, cursor: (q.cursor + (key.upArrow ? -1 : 1) + rows) % rows };
  if (char === ' ') return { ...q, ticked: toggleRow(q) };
  if (char === 'a' || char === 'A') return { ...q, ticked: toggleAll(q) };
  if (key.return) q.answer(q.ticked);
  else if (key.escape) q.cancel ? q.cancel() : q.answer([]);
  return undefined;
}
