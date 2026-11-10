/**
 * @file The Microsoft 365 Copilot harness module. The parts live in separate files by concern and share one
 * CopilotState (state.ts): the live window and tab, the close listeners and the model/stop flags.
 * Only do what a person could do in the Copilot page (see the rule in state.ts).
 * @see {@link ../../docs/module.md#code-layout | Copilot module: code layout}
 * @see {@link ../../docs/file-exchange.md#what-the-module-declares | Copilot file exchange: what the module declares}
 */
import path from 'node:path';
import {
  type ChatInfo,
  type HarnessContext,
  type ModelListResult,
  type ModelPreference,
  REINER_DIR,
  readState,
  type SignInState,
} from '@co-reiner/core';
import { createPackExchange, DIFF_MODE, downloadMode, type TransferSupport } from '@co-reiner/exchange-packs';
import { type ChatHarness, chatHarnessCommands } from '../commands/index.ts';
import { check, login, startResult, stop, tab, waitUntilClosed } from './browser.ts';
import { currentChat, deleteChat, listChats, newChat, openChat, readHistory, renameChat } from './chats.ts';
import { prepareTransfer } from './drive.ts';
import { readInstructions, writeInstructions } from './instructions.ts';
import { listModels, selectModel } from './models.ts';
import { downloadReplyFiles } from './page-files.ts';
import { send, stopGenerating } from './send.ts';
import { createState } from './state.ts';
import { onedriveMode } from './transfer.ts';
import { listUploads, removeUploads } from './uploads.ts';

export function createCopilotModule(ctx: HarnessContext): ChatHarness {
  const st = createState(ctx);
  const displayName = 'Microsoft 365 Copilot';
  // How files go to Copilot and come back is this harness's own business: packs, with three ways back.
  const transfer: TransferSupport = {
    modes: [DIFF_MODE, downloadMode((dir, opts) => downloadReplyFiles(st, dir, opts)), onedriveMode(st)],
    defaultMode: 'diff',
    index: true,
  };
  const exchange = createPackExchange({
    root: ctx.projectRoot,
    reinerDir: path.join(ctx.projectRoot, REINER_DIR),
    stateDir: ctx.stateDir,
    displayName,
    settings: async () => (await ctx.readSettings?.()) ?? ctx.settings,
    support: transfer,
  });
  const remembered = <T>(name: string) => readState<T>(ctx.stateDir, name);

  const self: ChatHarness = {
    id: 'm365-copilot',
    displayName,

    start: (opts = {}) =>
      startResult(
        st,
        opts.onStatus,
        opts.chatId
          ? (onStatus) => self.openChat(opts.chatId as string, onStatus ? { onStatus } : {})
          : undefined,
      ),
    async restart(opts = {}) {
      await stop(st);
      return startResult(st, opts.onStatus);
    },
    login: (opts = {}) => login(st, opts),
    checkSignIn: async (opts = {}) => check(st, await tab(st, opts.onStatus), opts.onStatus),

    listModels: (opts = {}) => listModels(st, opts),
    selectModel: (query, opts = {}) => selectModel(st, query, opts),

    newChat: (opts = {}) => newChat(st, opts),
    send: (prompt, opts = {}) => send(st, prompt, opts),
    stopGenerating: () => stopGenerating(st),

    customInstructions: {
      read: (opts = {}) => readInstructions(st, opts.onStatus, opts.signal),
      write: (text, opts = {}) => writeInstructions(st, text, opts),
    },

    transfer,
    exchange,
    // Read from this module's own state files, so the host never needs to know their names.
    remembered: {
      signIn: () => remembered<SignInState>('signin'),
      models: async () => (await remembered<ModelListResult>('models'))?.models ?? [],
      modelPreference: () => remembered<ModelPreference>('model'),
      chats: async () => (await remembered<ChatInfo[]>('recent-chats')) ?? [],
    },
    uploads: {
      list: (opts = {}) => listUploads(st, opts),
      remove: (names, opts = {}) => removeUploads(st, names, opts),
    },
    prepareTransfer: (mode, opts = {}) => prepareTransfer(st, mode, opts, (p, o) => self.send(p, o)),

    listChats: (opts = {}) => listChats(st, opts),
    currentChat: (opts = {}) => currentChat(st, opts),
    openChat: (id, opts = {}) => openChat(st, id, opts),
    readHistory: (opts = {}) => readHistory(st, opts),
    renameChat: (title, opts = {}) => renameChat(st, title, opts),
    deleteChat: (id, opts = {}) => deleteChat(st, id, opts),

    isOpen: () => st.live !== null && !st.live.page.isClosed(),
    onClosed(listener) {
      st.closeListeners.add(listener);
      return () => st.closeListeners.delete(listener);
    },
    waitUntilClosed: () => waitUntilClosed(st),
    stop: (opts) => stop(st, opts),
  };
  // The slash commands work on this module, so they are added once it exists.
  self.commands = chatHarnessCommands(self);
  return self;
}
