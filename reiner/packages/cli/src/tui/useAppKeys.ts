/**
 * @file The TUI's keys outside prompt editing: Esc, y/N answers, the suggestion list and history.
 * @see {@link ../../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 */
import { useInput } from 'ink';
import type { Session } from '../session.ts';
import { cancelRunningCommand, type Question } from './command-api.ts';
import { pickKey } from './pick.ts';
import type { Suggestion } from './suggestions.ts';
import type { PromptState } from './usePromptState.ts';

export interface KeyState {
  session: Session;
  streaming: string | null;
  /** Raised by Esc during a turn, for the chat loop to see between its steps. */
  cancel: { current: boolean };
  question: Question | null;
  busy: string | null;
  choosing: boolean;
  menu: Suggestion[];
  highlighted: number;
  prompt: PromptState;
  setBusy(label: string | null): void;
  setQuestion(question: Question | null): void;
}

/**
 * Keys outside the prompt's own editing: Esc to stop a reply, y/N answers, moving through suggestions,
 * Tab completion, and ↑/↓ through the prompt history.
 */
export function useAppKeys(k: KeyState): void {
  useInput((char, key) => {
    // Esc during a turn stops it wherever it is: the loop cancels before sending, the harness cancels while
    // it uploads or types, and once a reply is being written it presses the harness's own stop button.
    // A question on screen keeps its own Esc (it answers no).
    if (k.streaming !== null && !k.question && key.escape) {
      k.cancel.current = true;
      k.setBusy('Stopping…');
      void k.session.module?.stopGenerating().catch(() => {});
      return;
    }
    // Esc while a slash command runs asks it to stop; a command that can, stops at its next safe step.
    if (k.streaming === null && k.busy && !k.question && key.escape) {
      if (cancelRunningCommand()) k.setBusy('Cancelling…');
      return;
    }
    if (k.question?.kind === 'pick') {
      const next = pickKey(k.question, char, key);
      if (next) k.setQuestion(next);
      return;
    }
    if (k.question) {
      // y answers yes; anything else (n, Enter, Esc) answers no.
      if (char === 'y' || char === 'Y') k.question.answer(true);
      else if (char === 'n' || char === 'N' || key.return || key.escape) k.question.answer(false);
      return;
    }
    if (k.busy || k.choosing) return;
    const { menu, highlighted, prompt } = k;
    const { history, historyIndex } = prompt;
    if (menu.length > 0 && (key.upArrow || key.downArrow)) {
      // Arrows move through the suggestions while the list is showing.
      const step = key.upArrow ? -1 : 1;
      prompt.setSelected((highlighted + step + menu.length) % menu.length);
    } else if (key.tab && menu[highlighted]) {
      prompt.replaceInput(menu[highlighted].complete);
    } else if (key.escape && menu.length > 0) {
      prompt.setDismissed(true);
    } else if (key.upArrow && history.current.length > 0) {
      // Starting a walk through history: keep what was typed, so ↓ can bring it back.
      if (historyIndex.current === -1) prompt.draft.current = prompt.input;
      historyIndex.current = Math.min(historyIndex.current + 1, history.current.length - 1);
      // A recalled command keeps the list hidden, so ↑/↓ keep walking through history.
      prompt.replaceInput(history.current[historyIndex.current] ?? '', { keepListHidden: true });
    } else if (key.downArrow && historyIndex.current > -1) {
      // ↓ only walks back down; with no walk in progress it leaves the prompt alone.
      historyIndex.current -= 1;
      const back = historyIndex.current === -1;
      const text = back ? prompt.draft.current : (history.current[historyIndex.current] ?? '');
      prompt.replaceInput(text, { keepListHidden: !back });
    }
  });
}
