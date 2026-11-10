/**
 * @file The prompt's own line editor: pure key handling (`applyKey`) and the Ink component around it.
 * @see {@link ../../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 */
import { Text, useInput } from 'ink';
import { useRef, useState } from 'react';
import { graphemes } from './width.ts';

/**
 * Pure editing state for the prompt: the text, the cursor, and the other end of a selection.
 * Positions count the characters a person sees (grapheme clusters), so an emoji, a flag or a letter with
 * a combining accent moves and is deleted as one.
 */
export interface EditState {
  chars: string[];
  cursor: number;
  /** Where a Shift selection started; null when nothing is selected. */
  anchor: number | null;
}

export interface EditKey {
  input: string;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  backspace?: boolean;
  delete?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export const editState = (value: string, cursor?: number): EditState => {
  const chars = graphemes(value);
  return { chars, cursor: cursor ?? chars.length, anchor: null };
};

/** The selected range as [start, end), or null. */
export function selection(s: EditState): [number, number] | null {
  if (s.anchor === null || s.anchor === s.cursor) return null;
  return [Math.min(s.anchor, s.cursor), Math.max(s.anchor, s.cursor)];
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

function wordLeft(chars: string[], from: number): number {
  let i = from;
  while (i > 0 && !isWordChar(chars[i - 1])) i--;
  while (i > 0 && isWordChar(chars[i - 1])) i--;
  return i;
}

function wordRight(chars: string[], from: number): number {
  let i = from;
  while (i < chars.length && !isWordChar(chars[i])) i++;
  while (i < chars.length && isWordChar(chars[i])) i++;
  return i;
}

/** Replace the selection (or insert at the cursor) with `text`. */
function insert(s: EditState, text: string): EditState {
  const [start, end] = selection(s) ?? [s.cursor, s.cursor];
  const added = graphemes(text);
  return {
    chars: [...s.chars.slice(0, start), ...added, ...s.chars.slice(end)],
    cursor: start + added.length,
    anchor: null,
  };
}

function removeRange(s: EditState, start: number, end: number): EditState {
  return { chars: [...s.chars.slice(0, start), ...s.chars.slice(end)], cursor: start, anchor: null };
}

/**
 * Apply one key press. Returns null for keys the prompt does not handle (Enter, Tab, Esc, ↑/↓),
 * which are left to the caller.
 */
export function applyKey(s: EditState, key: EditKey): EditState | null {
  const len = s.chars.length;
  const sel = selection(s);

  // Cursor movement. With Shift held it extends the selection; without, it clears it.
  let target: number | null = null;
  const word = key.ctrl || key.meta;
  if (key.leftArrow) {
    target = word ? wordLeft(s.chars, s.cursor) : !key.shift && sel ? sel[0] : Math.max(0, s.cursor - 1);
  } else if (key.rightArrow) {
    target = word ? wordRight(s.chars, s.cursor) : !key.shift && sel ? sel[1] : Math.min(len, s.cursor + 1);
  } else if (key.home || (key.ctrl && key.input === 'a')) {
    target = 0;
  } else if (key.end || (key.ctrl && key.input === 'e')) {
    target = len;
  }
  if (target !== null) {
    if (key.shift) return { ...s, cursor: target, anchor: s.anchor ?? s.cursor };
    return { ...s, cursor: target, anchor: null };
  }

  // Deleting. Many terminals send the same code for Backspace and Delete, so Ink can report the Backspace
  // key as either; only a real forward delete (Fn+Delete, ESC[3~) arrives as `delete` with no input.
  if (key.backspace || key.delete) {
    if (sel) return removeRange(s, sel[0], sel[1]);
    if (key.delete && !key.backspace) {
      // Forward delete.
      return s.cursor < len ? removeRange(s, s.cursor, s.cursor + 1) : s;
    }
    if (s.cursor === 0) return s;
    const start = word ? wordLeft(s.chars, s.cursor) : s.cursor - 1;
    return removeRange(s, start, s.cursor);
  }
  if (key.ctrl) {
    if (key.input === 'w')
      return sel ? removeRange(s, sel[0], sel[1]) : removeRange(s, wordLeft(s.chars, s.cursor), s.cursor);
    if (key.input === 'u') return removeRange(s, 0, s.cursor);
    if (key.input === 'k') return removeRange(s, s.cursor, len);
    return null;
  }
  if (key.meta) return null;

  if (key.input) {
    // Pasted text arrives as one chunk; line breaks would submit or break the one-line prompt.
    const text = key.input.replace(/\r\n|\r|\n/g, ' ');
    return insert(s, text);
  }
  return null;
}

/**
 * The one-line prompt. Replaces ink-text-input, which has no Home/End and no selection.
 *
 * Keys: ←/→ move, Ctrl+←/→ by word, Home/End (or Ctrl+A/E) to the ends, Shift with any of these selects,
 * Backspace/Delete remove the selection or one character, Ctrl+Backspace or Ctrl+W a word, Ctrl+U to the
 * start, Ctrl+K to the end. Typing replaces the selection. Enter submits; ↑/↓, Tab and Esc are left to
 * the caller. Text set from outside (history, Tab completion) puts the cursor at the end.
 */
export function PromptInput(props: {
  value: string;
  onChange(value: string): void;
  onSubmit(value: string): void;
  placeholder?: string;
  focus?: boolean;
}) {
  const [state, setState] = useState<EditState>(() => editState(props.value));
  // The value we last reported. A different props.value was set by the caller.
  const ours = useRef(props.value);
  let current = state;
  if (props.value !== ours.current && props.value !== state.chars.join('')) {
    current = editState(props.value);
  }
  // Keep the ref and state in step with a value set from outside.
  if (current !== state) {
    ours.current = props.value;
    setState(current);
  }

  useInput(
    (input, key) => {
      if (key.return) {
        props.onSubmit(current.chars.join(''));
        return;
      }
      const next = applyKey(current, { ...key, input });
      if (!next) return;
      setState(next);
      const value = next.chars.join('');
      if (value !== current.chars.join('')) {
        ours.current = value;
        props.onChange(value);
      }
    },
    { isActive: props.focus ?? true },
  );

  const { chars, cursor } = current;
  if (chars.length === 0) {
    const [first = ' ', ...rest] = [...(props.placeholder ?? '')];
    return (
      <Text>
        <Text inverse>{first}</Text>
        <Text color="gray">{rest.join('')}</Text>
      </Text>
    );
  }
  const sel = selection(current);
  if (sel) {
    // The selection shows inverted. The terminal cursor is hidden, so this is where the user looks.
    return (
      <Text>
        {chars.slice(0, sel[0]).join('')}
        <Text inverse>{chars.slice(sel[0], sel[1]).join('')}</Text>
        {chars.slice(sel[1]).join('')}
      </Text>
    );
  }
  return (
    <Text>
      {chars.slice(0, cursor).join('')}
      <Text inverse>{chars[cursor] ?? ' '}</Text>
      {chars.slice(cursor + 1).join('')}
    </Text>
  );
}
