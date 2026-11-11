/**
 * @file What one round of tool calls shares while it runs: the chat, its settings, and the answer being built.
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 */
import { type FileFilter, type ToolCall, type ToolRunOptions, toolResult } from '@co-reiner/core';
import type { PackResult } from '../pack.ts';
import type { TransferContext, TransferState } from './store.ts';

export type { ToolRunOptions };

/** One round of tool calls: what the answer message and the TUI summary collect as each call runs. */
export interface ToolRun {
  ctx: TransferContext;
  s: TransferState;
  opts: ToolRunOptions;
  chatId: string | undefined;
  /** Files this chat has seen. */
  ledger: Set<string>;
  who: string;
  /** The `call_id` of the call being run: its answer carries it. */
  callId: string;
  /** The answer message: one `function_call_output` item per call, in the order they ran. */
  lines: string[];
  summary: string[];
  /** The pack that goes with the answer (the last one made); a full pack has a `digest`. */
  pack?: PackResult;
  /** For a part pack: what the chat has once it is in, recorded after the send. */
  view?: string;
  filter: FileFilter;
  filterError?: string;
}

export type Call<T extends ToolCall['tool']> = Extract<ToolCall, { tool: T }>;

/** Add the answer to the call being run: one `function_call_output` item, with these lines as its output. */
export const answer = (run: ToolRun, lines: string[]): void => {
  run.lines.push(toolResult(run.callId, lines.join(String.fromCharCode(10))));
};

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export const refusedLine = (refused: { path: string; reason: string }[]) =>
  refused.length ? [`Refused: ${refused.map((r) => `${r.path} (${r.reason})`).join('; ')}.`] : [];
