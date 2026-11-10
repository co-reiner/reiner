/**
 * @file React state for the prompt text, the highlighted suggestion and the prompt history.
 * @see {@link ../../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 */
import { useCallback, useRef, useState } from 'react';

/** The prompt's text, the highlighted suggestion, whether the list is hidden, and the prompt history. */
export function usePromptState() {
  const [input, setInput] = useState('');
  /** Highlighted row in the suggestion list. */
  const [selected, setSelected] = useState(0);
  /** Esc hides the suggestion list until the input changes. */
  const [dismissed, setDismissed] = useState(false);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  /** What was typed when ↑ started walking through history; ↓ past the newest entry brings it back. */
  const draft = useRef('');

  /** Every edit to the prompt goes through here, so the suggestion list starts again at the top. */
  const changeInput = useCallback((value: string) => {
    setInput(value);
    setSelected(0);
    setDismissed(false);
  }, []);

  /** Set the prompt text from code (Tab completion, history). The prompt puts its cursor at the end. */
  const replaceInput = useCallback(
    (value: string, opts: { keepListHidden?: boolean } = {}) => {
      changeInput(value);
      if (opts.keepListHidden) setDismissed(true);
    },
    [changeInput],
  );

  /** Remember a submitted prompt for ↑/↓. */
  const remember = useCallback((text: string) => {
    history.current.unshift(text);
    historyIndex.current = -1;
  }, []);

  return {
    input,
    changeInput,
    replaceInput,
    selected,
    setSelected,
    dismissed,
    setDismissed,
    history,
    historyIndex,
    draft,
    remember,
  };
}

export type PromptState = ReturnType<typeof usePromptState>;
