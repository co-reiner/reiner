/**
 * @file The harness module contract: what every harness module offers and what the host gives it.
 * @see {@link ../../../docs/architecture/modules.md#contract | Harness modules: contract}
 */
import type { ChatActionOptions, ChatInfo, HistoryTurn } from './chats.ts';
import type { HarnessCommand } from './commands.ts';
import type { ProjectExchange } from './exchange.ts';

export type { ChatActionOptions, ChatInfo, HistoryTurn } from './chats.ts';

/** Browser channels we can drive. `auto` tries Edge, then Chrome, then Playwright's Chromium. */
export type BrowserChannel = 'auto' | 'msedge' | 'chrome' | 'chromium';

export interface BrowserOptions {
  channel: BrowserChannel;
  /** false shows the browser window. Useful while debugging selectors. */
  headless: boolean;
  /** One-shot commands only: keep a visible window open after the command until the user closes it. */
  keepOpen: boolean;
  /**
   * Keep a sign-in that lives in session cookies (an account where "Stay signed in?" is off) between runs:
   * the browser starts with its own last-session restore. Off by default.
   */
  keepSession?: boolean;
}

/** Everything a harness module needs from the host (CLI now, Reiner Agent later). */
export interface HarnessContext {
  projectRoot: string;
  /** Persistent browser profile for this module, inside `.reiner/profiles/<module>/`. Secret. */
  profileDir: string;
  /** Module state, inside `.reiner/modules/<module>/`. */
  stateDir: string;
  logDir: string;
  browser: BrowserOptions;
  /** Module-specific settings from config, as they were when the module was created. */
  settings: Record<string, unknown>;
  /**
   * The same settings read fresh from config, so an edit counts without a restart. For settings read at
   * the time of use, such as search `include` and `exclude`. Absent: use `settings`.
   */
  readSettings?(): Promise<Record<string, unknown>>;
}

export type SignInState =
  | { signedIn: true; checkedAt: string; channel?: string }
  | { signedIn: false; checkedAt: string; reason: string; channel?: string };

export interface ModelInfo {
  /** Stable identifier if the harness exposes one, otherwise the label. */
  id: string;
  label: string;
  description?: string;
  /** Submenu the model sits in, e.g. "GPT · OpenAI". Absent for top-level entries. */
  group?: string;
  /** Labels to click through in the picker, from the top menu down to this model. */
  path?: string[];
  /** True when this is the currently selected model. */
  selected?: boolean;
}

export interface SelectModelResult {
  signIn: SignInState;
  /**
   * selected: clicked and confirmed. already: it was the current model. ambiguous: the query matched
   * several models (see `candidates`). not-found: nothing matched. failed: clicking did not stick.
   */
  status: 'selected' | 'already' | 'ambiguous' | 'not-found' | 'failed' | 'signed-out';
  model?: ModelInfo;
  candidates: ModelInfo[];
  /** Every model seen in the picker, so callers can refresh their cached list. */
  models: ModelInfo[];
  notes: string[];
}

/** The model the user chose for this project, kept in `.reiner/modules/<id>/model.json`. */
export interface ModelPreference {
  id: string;
  label: string;
  group?: string;
  path?: string[];
  chosenAt: string;
}

export interface ModelListResult {
  signIn: SignInState;
  models: ModelInfo[];
  /** Where the list came from: the harness's model picker on the page, or nowhere. */
  source: 'picker' | 'none';
  notes: string[];
  /** Path of a debug dump, when one was written. */
  debugFile?: string;
}

export type StatusListener = (message: string) => void;

export interface SendOptions {
  onStatus?: StatusListener;
  /** The reply so far, as markdown, each time it grows. */
  onDelta?: (markdown: string) => void;
  /** Give up waiting after this long. Default 5 minutes. */
  timeoutMs?: number;
  /** Local files to upload with the prompt, through the harness's own upload control. */
  attachments?: string[];
}

export interface ChatReply {
  /** The reply converted from the rendered page to markdown. */
  markdown: string;
  /** True when the reply was cut short with stopGenerating(). */
  stopped: boolean;
  /**
   * True when the turn was cancelled before the prompt was sent: nothing reached the model, so the host
   * records nothing for it (no `afterSend`).
   */
  notSent?: boolean;
  /**
   * Things the user should know about this turn, e.g. what a cancelled turn left behind in the harness
   * (a file already uploaded), or that the harness may still answer.
   */
  notes?: string[];
  /** The harness's own link to this conversation, if it has one. */
  conversationUrl?: string;
  /** The model the harness showed while answering, if known. */
  model?: string;
  /**
   * Names of the files the reply offers (files the model created: download links, file cards). Left out
   * when the page was not checked, as for a reply read back from the chat history: a reply mode that needs
   * the files then looks in the page itself.
   */
  downloads?: string[];
  /** The harness had opened a document for co-editing, and it was closed to keep it out of the context. */
  closedDocument?: boolean;
  elapsedMs: number;
}

/**
 * What a harness remembers between runs, read without opening the browser: for the status line and for
 * suggestions while the user types. Where and how it is stored is the module's own business.
 */
export interface HarnessMemory {
  signIn?(): Promise<SignInState | undefined>;
  /** Models seen the last time the picker was read. */
  models?(): Promise<ModelInfo[]>;
  /** The model the user chose for this project. */
  modelPreference?(): Promise<ModelPreference | undefined>;
  /** The recent chats as last shown to the user, so names and numbers match what they saw. */
  chats?(): Promise<ChatInfo[]>;
}

/** What starting a new chat did about the project's model. */
export interface NewChatResult {
  /** The project's saved model, selected in the new chat. */
  appliedModel?: ModelInfo;
  /** For example, that the saved model is not available in this chat right now. */
  notes: string[];
}

export interface StartResult {
  signIn: SignInState;
  /** The project's saved model, if it was re-applied in the picker (Copilot resets it on every load). */
  appliedModel?: ModelInfo;
  /** The chat `start` was asked to open (`chatId`), once open. */
  chat?: ChatInfo;
  /** Why the chat `start` was asked to open could not be opened; a new chat is open instead. */
  chatError?: string;
  notes: string[];
}

/**
 * A harness module owns one live browser window with one tab on its harness. `start` opens it and it
 * stays open for the whole session; every other call works in that same tab. Calls are not concurrent:
 * the host runs one at a time. If the user closes the window, the next call opens it again.
 *
 * Only opening, sending and closing are required. Sign-in, models and chat history are optional, since not
 * every harness has them; the module's own `commands` expose what it has to the user.
 */
export interface HarnessModule {
  id: string;
  displayName: string;
  /** Slash commands this harness adds, listed before the host's global ones. */
  commands?: HarnessCommand[];
  /**
   * Open the browser on the harness (if not already open) and check sign-in. With `chatId`, open that chat
   * straight away and keep the model it shows (no model is applied first); without, re-apply the saved
   * model. A harness without chats ignores `chatId`.
   */
  start(opts?: { onStatus?: StatusListener; chatId?: string }): Promise<StartResult>;
  /** Wait in the visible window for the user to sign in. Relaunches visibly if the browser was headless. */
  login?(opts?: { timeoutMs?: number; onStatus?: StatusListener }): Promise<StartResult>;
  /** Check the tab is still signed in, without user interaction. */
  checkSignIn?(opts?: { onStatus?: StatusListener }): Promise<SignInState>;
  /** List the models the harness offers to this account. */
  listModels?(opts?: { debug?: boolean; onStatus?: StatusListener }): Promise<ModelListResult>;
  /** Choose a model in the harness's picker by name (fuzzy match), then confirm it is selected. */
  selectModel?(query: string, opts?: { onStatus?: StatusListener }): Promise<SelectModelResult>;
  /**
   * Start a new chat with the harness's own "New chat" control and select the project's saved model in it. Notes say when that model is not
   * available; a harness without models returns nothing.
   */
  newChat?(opts?: { onStatus?: StatusListener }): Promise<NewChatResult | undefined>;
  /**
   * Type `prompt` into the harness, send it, and wait for the reply. `onDelta` is called with the whole
   * reply so far (markdown) while it is being written. Throws when not signed in or nothing comes back.
   */
  send(prompt: string, opts?: SendOptions): Promise<ChatReply>;
  /** Press the harness's "stop generating" button, if a reply is being written. */
  stopGenerating(): Promise<void>;
  /** Recent chats from the harness's history list, newest first. */
  listChats?(opts?: ChatActionOptions): Promise<ChatInfo[]>;
  /** The chat open in the tab, if it has been saved as a conversation yet. */
  currentChat?(opts?: ChatActionOptions): Promise<ChatInfo | undefined>;
  /** Open a chat by id, from the history list (or its link, if it is no longer listed). */
  openChat?(id: string, opts?: ChatActionOptions): Promise<ChatInfo>;
  /**
   * The last `turns` prompts and replies of the open chat, oldest first, read from the page. Long chats
   * are loaded lazily by the harness, so only turns it has rendered can be read.
   */
  readHistory?(opts?: ChatActionOptions & { turns?: number }): Promise<HistoryTurn[]>;
  /** Rename a chat through the harness's own Rename control. Defaults to the open chat. */
  renameChat?(title: string, opts?: ChatActionOptions & { id?: string }): Promise<ChatInfo>;
  /**
   * Delete a chat through the harness's own Delete control and confirm the harness's dialog. Permanent.
   * Refuses chats whose title contains "(Keep)". Callers must ask the user first.
   */
  deleteChat?(id: string, opts?: ChatActionOptions): Promise<void>;
  /**
   * The user's custom instructions in the harness's own settings page. `write` replaces the whole text,
   * so callers read first and change only Reiner's marked sections (`setSections`). Writing changes
   * the user's account: callers ask first.
   */
  customInstructions?: {
    read(opts?: ChatActionOptions): Promise<string>;
    write(text: string, opts?: ChatActionOptions): Promise<void>;
  };
  /**
   * How this harness exchanges project files with its model. Absent when it has no way to: prompts then go
   * as typed, and only a diff written in a reply is offered.
   */
  exchange?: ProjectExchange;
  /** What the module remembers between runs, for the host's status line and suggestions. */
  remembered?: HarnessMemory;
  /** Close and reopen the browser, e.g. after switching between visible and headless. */
  restart(opts?: { onStatus?: StatusListener }): Promise<StartResult>;
  /** True while the browser window is open. */
  isOpen(): boolean;
  /** Called when the browser window closes, whether we closed it or the user did. Returns an unsubscribe. */
  onClosed(listener: () => void): () => void;
  /** Resolves when the window is closed (used by one-shot commands with `browser.keepOpen`). */
  waitUntilClosed(): Promise<void>;
  /**
   * Close the browser. Pass `wait: true` to wait for the full shutdown (flushes cookies to disk);
   * otherwise it closes in the background.
   */
  stop(opts?: { wait?: boolean }): Promise<void>;
}

/** A harness the CLI can offer. The factory is only called once the user picks it. */
export interface HarnessEntry {
  id: string;
  displayName: string;
  description: string;
  /** Settings written to the project config when the harness is first added. */
  defaultSettings?: Record<string, unknown>;
  create: (ctx: HarnessContext) => HarnessModule;
}
