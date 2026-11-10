/**
 * @file The harness command contract: slash commands a module brings, the host they run in, and what they print.
 * @see {@link ../../../docs/architecture/modules.md#harness-commands | Harness modules: harness commands}
 */
import type {
  ChatInfo,
  HistoryTurn,
  ModelListResult,
  ModelPreference,
  SelectModelResult,
  SignInState,
  StartResult,
} from './harness.ts';
import type { ChangeSet } from './transfer/apply.ts';

/**
 * Slash commands a harness module brings with it. Everything that depends on what a harness can do (sign
 * in, models, chats, file exchange, custom instructions) is a harness command, defined in the module's
 * package; the host (the CLI's TUI now, Reiner Agent later) only adds global ones such as /help.
 *
 * Commands print plain data (`OutputEntry`), never terminal UI, and reach the host through `CommandHost`.
 */
export type OutputEntry =
  | { kind: 'info'; text: string }
  | { kind: 'success'; text: string }
  /** Something the user should act on, shown in yellow. */
  | { kind: 'warning'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'models'; result: ModelListResult }
  | { kind: 'model'; result: SelectModelResult; query: string }
  | { kind: 'model-current'; preference: ModelPreference | undefined }
  | { kind: 'started'; result: StartResult; harness: string }
  | { kind: 'chats'; chats: ChatInfo[] }
  | { kind: 'history'; turns: HistoryTurn[]; title: string; harness: string }
  | { kind: 'changes'; source: string; items: { path: string; action: 'write' | 'delete' | 'patch' }[] }
  /** A titled panel of lines; lines starting with ● are highlighted. */
  | { kind: 'transfer'; lines: string[] };

/** What a harness command can ask of the host. */
export interface CommandHost {
  projectRoot: string;
  /** This harness's state folder, `.reiner/modules/<id>/`, e.g. for backups. */
  stateDir: string;
  print(entry: OutputEntry): void;
  /** Show a spinner with this label, or clear it with null. */
  busy(label: string | null): void;
  /**
   * Aborted when the user presses Esc while this command runs. A command passes it to the module calls
   * that can stop part-way (`ChatActionOptions.signal`); a host with no way to cancel never aborts it.
   */
  signal: AbortSignal;
  /** Ask the user a yes/no question. Resolves true only for an explicit "y". */
  confirm(question: string): Promise<boolean>;
  /**
   * Let the user tick any of `options` (with a "select all"), e.g. files to remove. Resolves the indexes of
   * the ticked options, in order; empty when the user cancels or ticks nothing, or cannot be asked.
   */
  pick(question: string, options: PickOption[]): Promise<number[]>;
  setSignIn(state: SignInState): void;
  /** Tell the host which chat is open (undefined for a new, unsaved chat). */
  setChat(chat: ChatInfo | undefined): void;
  /** Chats as last listed, so names and numbers match what the user saw. */
  lastChats(): Promise<ChatInfo[]>;
  /** The model the user chose for this project, if any. */
  modelPreference(): Promise<ModelPreference | undefined>;
  /** Add a line to the session transcript. */
  log(text: string): void;
  /**
   * Show change sets (from the harness's exchange, e.g. the last reply again), ask the user, and apply
   * the ones they accept. Nothing is written without an explicit "y".
   */
  offerChanges(sets: ChangeSet[], notes: string[]): Promise<void>;
}

/** One row the user can tick in `CommandHost.pick`. */
export interface PickOption {
  label: string;
  /** A short description shown next to it. */
  detail?: string;
}

/** A fixed value a command's argument can take, suggested while the user types. */
export interface CommandChoice {
  /** What goes after the command name, e.g. `onedrive` or `index on`. */
  value: string;
  /** A short description shown next to it. */
  detail?: string;
}

export interface HarnessCommand {
  name: string;
  /** Argument hint shown in /help, e.g. `<name or number>`. */
  args?: string;
  description: string;
  /** What the argument names, so the host can suggest values while the user types. */
  complete?: 'model' | 'chat';
  /** Fixed values the argument can take (e.g. the reply modes for /transfer), suggested as the user types. */
  choices?(): CommandChoice[];
  run(host: CommandHost, args: string[]): Promise<void> | void;
}
