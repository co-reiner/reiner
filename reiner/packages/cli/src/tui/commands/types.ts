/**
 * @file The TUI's slash command types: `CommandApi`, what a command may do in the TUI, and `SlashCommand`.
 * @see {@link ../../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 * @see {@link ../../../../../docs/architecture/cli-ux.md#harness-commands | CLI and TUI: harness commands}
 */
import type { ChatInfo, CommandChoice, PickOption, SignInState } from '@co-reiner/core';
import type { Session } from '../../session.ts';
import type { ChecksState } from '../checks.ts';
import type { Entry } from '../entries.ts';

export interface CommandApi {
  session: Session;
  /** What the project's checks remember this session (approvals, files a patch changed). */
  checks: ChecksState;
  /** Send a prompt as a chat turn, e.g. the output of a failing check. Absent where there is no chat. */
  chat?(text: string): Promise<void>;
  print(entry: Entry): void;
  /** Show a spinner with this label, or clear it with null. */
  busy(label: string | null): void;
  setSignIn(state: SignInState): void;
  /** Open the active harness's browser (if needed), check sign-in, re-apply the model, and report. */
  startHarness(): Promise<void>;
  /** Ask the user a yes/no question under the prompt. Resolves true only for an explicit "y". */
  confirm(question: string): Promise<boolean>;
  /** Let the user tick options under the prompt; resolves the ticked indexes (empty on Esc). */
  pick(question: string, options: PickOption[]): Promise<number[]>;
  /** Tell the status line which chat is open (undefined for a new, unsaved chat). */
  setChat(chat: ChatInfo | undefined): void;
  /** Make another harness active: closes the current browser, opens the new one. */
  switchHarness(id: string): Promise<void>;
  clear(): void;
  exit(): void;
}

export interface SlashCommand {
  name: string;
  args?: string;
  description: string;
  /**
   * `harness`: brought by the active harness module (its `commands`), listed first. `global`: Reiner's own,
   * listed last.
   */
  scope: 'harness' | 'global';
  /** What the argument names, so the prompt can suggest values (from the harness command). */
  complete?: 'model' | 'chat';
  /** Fixed values the argument can take, suggested after the command name. */
  choices?(): CommandChoice[];
  run(api: CommandApi, args: string[]): Promise<void> | void;
}
