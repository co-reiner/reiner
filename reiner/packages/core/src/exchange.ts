/**
 * @file The exchange hook: how a harness carries the project to its model and brings changes back, as the
 * host sees it. The host calls it at fixed points of a chat turn and knows nothing of how it is done.
 * @see {@link ../../../docs/architecture/modules.md#file-exchange | Harness modules: file exchange}
 * @see {@link ../../../docs/architecture/file-exchange.md | File exchange}
 */
import type { ChatReply, StatusListener } from './harness.ts';
import type { ParsedTools, ToolAnswer } from './tools/protocol.ts';
import type { ChangeSet } from './transfer/apply.ts';

/** A prompt ready to send: the text as it goes, and local files to upload with it. */
export interface PreparedPrompt {
  prompt: string;
  attachments: string[];
  /** Lines for the user about what goes with it, e.g. the files being attached and why. */
  notes?: string[];
}

export interface ToolRunOptions {
  /** Asks the user y/N. Without it, tools that widen what the chat sees are refused. */
  confirm?: (question: string) => Promise<boolean>;
  onStatus?: StatusListener;
  /**
   * Runs one of the project's named tasks for a `run_task` call and returns what to tell the model. The
   * host owns this (the project's config, the y/N, the limits), whichever exchange answers the reply's
   * calls. Absent: tasks cannot be run here, and the call is answered so.
   */
  runTask?: (name: string, reason?: string) => Promise<ToolAnswer>;
}

/**
 * How a harness carries the project to its model and brings changes back. The host calls these at fixed
 * points of a chat turn and knows nothing of how it is done: one harness uploads packs, another may quote
 * files into the prompt, a third has no exchange at all and leaves this out. Whatever a harness does, what
 * leaves the machine goes through the share rules (`transfer/share.ts`) and what comes back is a
 * `ChangeSet` the host shows, asks about and applies (`transfer/apply.ts`).
 */
export interface ProjectExchange {
  /** Before a send: the user's text as the prompt that goes, with anything to attach. */
  prepare(text: string, chatId: string | undefined): Promise<PreparedPrompt>;
  /**
   * After a send went through: record what the chat now has. `userText` is what the user typed, or `''`
   * for a tool answer. The chat id is only known after the first send of a new chat.
   */
  afterSend(chatId: string | undefined, sent: PreparedPrompt, userText: string): Promise<void>;
  /** After a reply: the changes it carries, downloaded where needed. Nothing is applied here. */
  collect(reply: ChatReply, onStatus?: StatusListener): Promise<{ sets: ChangeSet[]; notes: string[] }>;
  /** Run a reply's tool calls: the message that answers them, and lines for the user about what was done. */
  runTools(
    calls: ParsedTools,
    chatId: string | undefined,
    opts?: ToolRunOptions,
  ): Promise<{ prepared: PreparedPrompt; summary: string[] }>;
  /** The user applied changes from a reply. */
  applied(): Promise<void>;
}
