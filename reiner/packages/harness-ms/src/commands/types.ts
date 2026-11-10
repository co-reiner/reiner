/**
 * @file The `ChatHarness` type: a harness module with every optional group these commands use.
 * @see {@link ../../docs/commands.md | Copilot's slash commands}
 * @see {@link ../../../../docs/architecture/modules.md#harness-commands | Harness modules: harness commands}
 */
import type { ChatActionOptions, HarnessModule } from '@co-reiner/core';
import type { PackExchange, TransferSupport } from '@co-reiner/exchange-packs';

/** What only a harness that exchanges files by packs has; the pack commands use it. */
export interface PackHarness {
  /** The reply modes this harness offers and whether its packs may carry the search index. */
  transfer: TransferSupport;
  /** The pack exchange itself: `/transfer`, `/pack`, `/apply` and `/instructions` work on it. */
  exchange: PackExchange;
  /**
   * Get ready for a reply mode, e.g. make sure the drive folder exists by asking the model to create a
   * small document. Returns notes for the user, and the names already in that folder, so patch numbers
   * used there are skipped. Sends a prompt only when it has to.
   */
  prepareTransfer?(
    mode: string,
    opts?: ChatActionOptions,
  ): Promise<{ ready: boolean; notes: string[]; existing?: string[] }>;
  /**
   * Files the harness keeps from uploads (Copilot: a OneDrive folder), so old packs can be removed. The
   * module itself replaces an earlier upload of the same name, so a pack keeps its name.
   */
  uploads?: {
    list(opts?: ChatActionOptions): Promise<string[]>;
    remove(names: string[], opts?: ChatActionOptions): Promise<{ removed: string[]; notFound: string[] }>;
  };
}

/**
 * A chat harness with everything these commands use: sign-in, models, chat history, file exchange by packs
 * and custom instructions. Copilot is one; a harness that lacks some of this brings its own command list.
 */
export type ChatHarness = Omit<HarnessModule, 'exchange'> &
  Required<
    Pick<
      HarnessModule,
      | 'login'
      | 'checkSignIn'
      | 'listModels'
      | 'selectModel'
      | 'newChat'
      | 'listChats'
      | 'currentChat'
      | 'openChat'
      | 'readHistory'
      | 'renameChat'
      | 'deleteChat'
      | 'customInstructions'
    >
  > &
  PackHarness;
