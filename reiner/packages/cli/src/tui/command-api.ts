/**
 * @file Builds the TUI's `CommandApi` and runs a typed slash command, global or the harness's.
 * @see {@link ../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 * @see {@link ../../../../docs/architecture/cli-ux.md#harness-commands | CLI and TUI: harness commands}
 */
import type { PickOption } from '@co-reiner/core';
import type { Session } from '../session.ts';
import type { ChecksState } from './checks.ts';
import { type CommandApi, parseCommand } from './commands.ts';
import type { Entry } from './entries.ts';
import type { HarnessState } from './useHarness.ts';

/**
 * What waits for the user under the transcript: a y/N question, or a list to tick (row 0 of a pick list is
 * "(Select all)", so `cursor` counts it).
 */
export type Question =
  | { kind: 'confirm'; text: string; answer(yes: boolean): void }
  | {
      kind: 'pick';
      text: string;
      options: PickOption[];
      cursor: number;
      ticked: number[];
      answer(chosen: number[]): void;
    };

export interface CommandApiDeps {
  session: Session;
  checks: ChecksState;
  /** Starts a chat turn; the app fills it in once the API exists. */
  chat(text: string): Promise<void>;
  harness: HarnessState;
  print(entry: Entry): void;
  setBusy(label: string | null): void;
  setQuestion(question: Question | null): void;
  /** Empty the transcript on screen. */
  clearScreen(): void;
  exit(): void;
}

/** What slash commands can do in the TUI. */
export function createCommandApi(d: CommandApiDeps): CommandApi {
  return {
    session: d.session,
    checks: d.checks,
    chat: d.chat,
    print: d.print,
    busy: d.setBusy,
    setSignIn: d.harness.setSignIn,
    setChat: (chat) => d.harness.trackChat(chat),
    confirm: (text) =>
      new Promise<boolean>((resolve) =>
        d.setQuestion({
          kind: 'confirm',
          text,
          answer: (yes) => {
            d.setQuestion(null);
            resolve(yes);
          },
        }),
      ),
    pick: (text, options) =>
      new Promise<number[]>((resolve) =>
        d.setQuestion({
          kind: 'pick',
          text,
          options,
          cursor: 0,
          ticked: [],
          answer: (chosen) => {
            d.setQuestion(null);
            resolve(chosen);
          },
        }),
      ),
    startHarness: d.harness.start,
    switchHarness: d.harness.switchHarness,
    clear: d.clearScreen,
    exit: d.exit,
  };
}

/** The command running now, so Esc can ask it to stop. One TUI runs one command at a time. */
let running: AbortController | null = null;

/** Ask the running command to stop. False when no command is running. */
export function cancelRunningCommand(): boolean {
  if (!running || running.signal.aborted) return false;
  running.abort();
  return true;
}

/** The signal of the running command, for its `CommandHost`; one that never aborts outside a command. */
export const commandSignal = (): AbortSignal => running?.signal ?? new AbortController().signal;

/** Run a slash command typed at the prompt, reporting unknown commands and errors. */
export async function runSlashCommand(api: CommandApi, text: string, refresh: () => void): Promise<void> {
  const { command, name, args } = parseCommand(text, api.session.module);
  if (!command) {
    api.print({ kind: 'error', text: `Unknown command /${name}. Type /help for the list.` });
    return;
  }
  running = new AbortController();
  try {
    api.busy(`Running /${command.name}…`);
    await command.run(api, args);
  } catch (error) {
    api.print({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
  } finally {
    running = null;
    api.busy(null);
    refresh();
  }
}
