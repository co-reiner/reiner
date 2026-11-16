/**
 * @file Tests for a tree pick list: a group row with its items, and Esc that cancels.
 * @see {@link ../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 */
import type { PickOption } from '@co-reiner/core';
import type { Key } from 'ink';
import { describe, expect, it } from 'vitest';
import { type PickQuestion, pickKey } from '../src/tui/pick.ts';

const key = (k: Partial<Key>) => k as Key;

/** figma with two tools, docs with one: rows 0 figma, 1-2 its tools, 3 docs, 4 its tool. */
const tree: PickOption[] = [
  { label: 'figma' },
  { label: 'get_metadata', indent: 1 },
  { label: 'get_screenshot', indent: 1 },
  { label: 'docs' },
  { label: 'search', indent: 1 },
];

const question = (ticked: number[], cursor: number): PickQuestion => ({
  kind: 'pick',
  text: 'Tools',
  options: tree,
  cursor,
  ticked,
  answer: () => {},
});

describe('a tree pick list', () => {
  it('ticks or unticks a group with all its items', () => {
    expect(pickKey(question([], 1), ' ', key({}))?.ticked).toEqual([0, 1, 2]);
    expect(pickKey(question([0, 1, 2, 3, 4], 1), ' ', key({}))?.ticked).toEqual([3, 4]);
    // Some items ticked: the group ticks the rest.
    expect(pickKey(question([1], 1), ' ', key({}))?.ticked).toEqual([0, 1, 2]);
  });

  it('ticks a group when its last item is ticked, and unticks it with any item', () => {
    expect(pickKey(question([1], 3), ' ', key({}))?.ticked).toEqual([0, 1, 2]);
    expect(pickKey(question([0, 1, 2], 2), ' ', key({}))?.ticked).toEqual([2]);
  });

  it('cancels on Esc when the list can be cancelled', () => {
    const seen: string[] = [];
    pickKey({ ...question([0], 1), cancel: () => seen.push('cancel') }, '', key({ escape: true }));
    expect(seen).toEqual(['cancel']);
  });
});
