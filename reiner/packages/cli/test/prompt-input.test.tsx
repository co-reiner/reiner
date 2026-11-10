/**
 * @file Tests the prompt's line editing, as pure key handling and through the Ink component.
 * @see {@link ../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 */
import { render } from 'ink-testing-library';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  applyKey,
  type EditKey,
  type EditState,
  editState,
  PromptInput,
  selection,
} from '../src/tui/PromptInput.tsx';

const press = (s: EditState, ...keys: EditKey[]) =>
  keys.reduce<EditState>((acc, k) => applyKey(acc, k) ?? acc, s);
const text = (s: EditState) => s.chars.join('');

describe('applyKey', () => {
  it('moves to the ends with Home and End', () => {
    const s = editState('hello world', 5);
    expect(press(s, { input: '', home: true }).cursor).toBe(0);
    expect(press(s, { input: '', end: true }).cursor).toBe(11);
    expect(press(s, { input: 'a', ctrl: true }).cursor).toBe(0);
    expect(press(s, { input: 'e', ctrl: true }).cursor).toBe(11);
  });

  it('selects with Shift and arrows, and typing replaces the selection', () => {
    let s = editState('hello world');
    s = press(s, { input: '', leftArrow: true, shift: true }, { input: '', leftArrow: true, shift: true });
    expect(selection(s)).toEqual([9, 11]);
    s = press(s, { input: 'XY' });
    expect(text(s)).toBe('hello worXY');
    expect(selection(s)).toBeNull();
  });

  it('selects to the start with Shift+Home and deletes it with Backspace', () => {
    let s = editState('hello world', 6);
    s = press(s, { input: '', home: true, shift: true });
    expect(selection(s)).toEqual([0, 6]);
    s = press(s, { input: '', backspace: true });
    expect(text(s)).toBe('world');
    expect(s.cursor).toBe(0);
  });

  it('selects to the end with Shift+End and deletes it with Delete', () => {
    let s = editState('hello world', 5);
    s = press(s, { input: '', end: true, shift: true }, { input: '', delete: true });
    expect(text(s)).toBe('hello');
  });

  it('collapses a selection to its edge on a plain arrow', () => {
    let s = editState('abcdef', 2);
    s = press(s, { input: '', rightArrow: true, shift: true }, { input: '', rightArrow: true, shift: true });
    expect(press(s, { input: '', leftArrow: true })).toMatchObject({ cursor: 2, anchor: null });
    expect(press(s, { input: '', rightArrow: true })).toMatchObject({ cursor: 4, anchor: null });
  });

  it('moves and deletes by word with Ctrl', () => {
    const s = editState('one two three');
    expect(press(s, { input: '', leftArrow: true, ctrl: true }).cursor).toBe(8);
    expect(press(editState('one two three', 0), { input: '', rightArrow: true, ctrl: true }).cursor).toBe(3);
    expect(text(press(s, { input: 'w', ctrl: true }))).toBe('one two ');
    expect(text(press(editState('one two', 3), { input: 'u', ctrl: true }))).toBe(' two');
    expect(text(press(editState('one two', 3), { input: 'k', ctrl: true }))).toBe('one');
  });

  it('moves over and deletes an emoji made of several code points as one character', () => {
    // A family: three people joined by zero-width joiners. One character on screen, five code points.
    const family = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map((p) => String.fromCodePoint(p)).join('');
    const s = editState(`a${family}b`);
    expect(s.chars).toHaveLength(3);
    const left = press(s, { input: '', leftArrow: true }, { input: '', leftArrow: true });
    expect(left.cursor).toBe(1);
    expect(text(press(left, { input: '', delete: true }))).toBe('ab');
    expect(text(press(s, { input: '', leftArrow: true }, { input: '', backspace: true }))).toBe('ab');
  });

  it('forward-deletes with Delete and backspaces with Backspace', () => {
    expect(text(press(editState('abc', 1), { input: '', delete: true }))).toBe('ac');
    expect(text(press(editState('abc', 1), { input: '', backspace: true }))).toBe('bc');
  });

  it('leaves Enter-like and navigation keys to the caller', () => {
    expect(applyKey(editState('x'), { input: '' })).toBeNull();
  });

  it('turns pasted line breaks into spaces', () => {
    expect(text(press(editState(''), { input: 'a\r\nb' }))).toBe('a b');
  });
});

function Harness(props: { initial: string; onSubmit?: (v: string) => void }) {
  const [value, setValue] = useState(props.initial);
  return <PromptInput value={value} onChange={setValue} onSubmit={props.onSubmit ?? (() => {})} />;
}

interface OuterHandle {
  set: (v: string) => void;
  submitted: string;
}

/** Lets a test set the value from outside, as Tab completion and history do. */
function Outer({ handle }: { handle: OuterHandle }) {
  const [value, setValue] = useState('ab');
  handle.set = setValue;
  return (
    <PromptInput
      value={value}
      onChange={setValue}
      onSubmit={(v) => {
        handle.submitted = v;
      }}
    />
  );
}

describe('PromptInput', () => {
  const tick = () => new Promise((r) => setTimeout(r, 20));

  it('handles Home, End and Shift selection from real key sequences', async () => {
    let submitted = '';
    const app = render(<Harness initial="" onSubmit={(v) => (submitted = v)} />);
    await tick();
    app.stdin.write('world');
    await tick();
    app.stdin.write('\x1b[H'); // Home
    await tick();
    app.stdin.write('hello ');
    await tick();
    app.stdin.write('\x1b[F'); // End
    await tick();
    app.stdin.write('\x1b[1;2D'); // Shift+←
    await tick();
    app.stdin.write('\x1b[1;2D');
    await tick();
    app.stdin.write('\x7f'); // Backspace deletes the selection
    await tick();
    app.stdin.write('\x1b[1;2H'); // Shift+Home
    await tick();
    app.stdin.write('X');
    await tick();
    app.stdin.write('\r');
    await tick();
    expect(submitted).toBe('X');
    app.unmount();
  });

  it('puts the cursor at the end when the value is set from outside', async () => {
    const outer: OuterHandle = { set: () => {}, submitted: '' };
    const app = render(<Outer handle={outer} />);
    await tick();
    app.stdin.write('\x1b[H'); // cursor to the start
    await tick();
    outer.set('/model gpt');
    await tick();
    app.stdin.write('!');
    await tick();
    app.stdin.write('\r');
    await tick();
    expect(outer.submitted).toBe('/model gpt!');
    app.unmount();
  });
});
