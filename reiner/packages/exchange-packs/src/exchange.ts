/**
 * @file Assembles the pack exchange from the pieces in `exchange/`: what a harness that takes uploads
 * hands to the host as its `ProjectExchange`, and what its own commands (`/transfer`, `/pack`, `/apply`,
 * `/instructions`) use directly.
 * @see {@link ../../../docs/architecture/file-exchange.md | File exchange}
 * @see {@link ../../../docs/architecture/modules.md#file-exchange | Harness modules: file exchange}
 */
import type {
  ChatReply,
  ParsedTools,
  ProjectExchange,
  StatusListener,
  ToolRunOptions,
} from '@co-reiner/core';
import { collect, recollect } from './exchange/collect.ts';
import { promptMethods } from './exchange/prompt.ts';
import { settingsMethods } from './exchange/settings.ts';
import type { PackHost, TransferContext } from './exchange/store.ts';
import { runTools } from './exchange/tools.ts';

/**
 * File exchange by packs, for one harness: settings (mode, index, patch numbers, sync marker), prompts
 * (packs, facts line, sections), tool calls, and collecting changes from replies. Applying is left to the
 * host, which asks the user first.
 */
export function createPackExchange(host: PackHost) {
  const ctx: TransferContext = { host };
  const settings = settingsMethods(ctx);
  const exchange = {
    ...settings,
    ...promptMethods(ctx),
    runTools: (parsed: ParsedTools, chatId: string | undefined, opts: ToolRunOptions = {}) =>
      runTools(ctx, parsed, chatId, opts),
    collect: (reply: ChatReply, onStatus?: StatusListener) => collect(ctx, reply, onStatus),
    recollect: (onStatus?: StatusListener, latest?: () => Promise<string | undefined>) =>
      recollect(ctx, onStatus, latest),
    /** After the user applied changes: the next patch gets a new number. */
    applied: () => settings.advance(),
  };
  // Checked here, so a change to the host's contract shows up in this package and not in each harness.
  return exchange satisfies ProjectExchange;
}

export type PackExchange = ReturnType<typeof createPackExchange>;
