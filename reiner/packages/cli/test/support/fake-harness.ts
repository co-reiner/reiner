/**
 * @file A fake harness for TUI tests: a full chat harness with Copilot's command list, in memory.
 * @see {@link ../../../../docs/architecture/modules.md#contract | Harness modules: contract}
 */
import path from 'node:path';
import {
  type ChatInfo,
  type HarnessEntry,
  type HarnessModule,
  type ModelListResult,
  type ModelPreference,
  matchModels,
  readState,
  type SignInState,
  type StartResult,
} from '@co-reiner/core';
import { createPackExchange, DIFF_MODE, downloadMode } from '@co-reiner/exchange-packs';
import { type ChatHarness, chatHarnessCommands, type PackHarness } from '@co-reiner/harness-ms';
import { fakeUploads, uploadNames } from './fake-uploads.ts';

export const signIn = { signedIn: true as const, checkedAt: new Date().toISOString() };

export const models: ModelListResult = {
  signIn,
  models: [
    { id: 'auto', label: 'Auto', selected: true },
    { id: 'gpt', label: 'GPT-5 Think deeper', description: 'Slower, more thorough' },
    { id: 'GPT/GPT-5.6 Sol Quick response', label: 'GPT-5.6 Sol Quick response', group: 'GPT · OpenAI' },
  ],
  source: 'picker',
  notes: [],
};

export const LONG_REPLY = Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of a long reply.`).join(
  String.fromCharCode(10, 10),
);

/** What a fake harness remembers between calls. */
interface FakeState {
  calls: string[];
  open: boolean;
  stopRequested: boolean;
  chats: { id: string; title: string }[];
  current: string | undefined;
}

type ChatMethods = Pick<
  HarnessModule,
  'newChat' | 'listChats' | 'currentChat' | 'openChat' | 'readHistory' | 'renameChat' | 'deleteChat'
>;

/** The chat list: three chats, one marked (Keep), "colours" open. */
function chatMethods(st: FakeState): ChatMethods {
  const find = (id: string | undefined) => st.chats.find((x) => x.id === id);
  return {
    newChat: async () => {
      st.calls.push('newChat');
      return { notes: [] };
    },
    listChats: async () => st.chats.map((c) => ({ ...c, ...(c.id === st.current ? { current: true } : {}) })),
    currentChat: async () => {
      const c = find(st.current);
      return c ? { ...c, current: true } : undefined;
    },
    openChat: async (chatId) => {
      st.calls.push(`openChat:${chatId}`);
      st.current = chatId;
      // "Lighthouse story" was set up with another model than the project's saved one.
      const model = chatId === 'c-story' ? { model: 'Quick response', savedModel: 'GPT-5 Think deeper' } : {};
      return { id: chatId, title: find(chatId)?.title ?? '', current: true, ...model };
    },
    readHistory: async (opts = {}) => {
      st.calls.push(`readHistory:${st.current}`);
      const all = [
        { prompt: `First question in ${st.current}`, reply: 'First answer.' },
        { prompt: `Second question in ${st.current}`, reply: '# Heading\n\nSecond answer.' },
        { prompt: `Third question in ${st.current}`, reply: 'Third answer.' },
      ];
      return st.current ? all.slice(-(opts.turns ?? 3)) : [];
    },
    renameChat: async (title) => {
      st.calls.push(`renameChat:${title}`);
      const c = find(st.current);
      if (!c) throw new Error('no chat open');
      c.title = title;
      return { ...c, current: true };
    },
    deleteChat: async (chatId) => {
      st.calls.push(`deleteChat:${chatId}`);
      st.chats = st.chats.filter((x) => x.id !== chatId);
      if (st.current === chatId) st.current = undefined;
    },
  };
}

/** Streams "Hello" in two steps. In slow mode it keeps "writing" until stopGenerating() is called. */
function sendMethods(st: FakeState, slow: boolean): Pick<HarnessModule, 'send' | 'stopGenerating'> {
  return {
    send: async (prompt, opts = {}) => {
      st.calls.push(`send:${prompt}`);
      st.stopRequested = false;
      // Slow mode streams a long reply (taller than the terminal), like a big code answer.
      opts.onDelta?.(slow ? LONG_REPLY : 'Hel');
      await new Promise((r) => setTimeout(r, 30));
      for (let i = 0; slow && !st.stopRequested && i < 200; i++) await new Promise((r) => setTimeout(r, 20));
      const markdown = st.stopRequested ? 'Hel' : `# Hello\n\nYou said: ${prompt}`;
      opts.onDelta?.(markdown);
      return { markdown, stopped: st.stopRequested, model: 'Fake Model', elapsedMs: 1234 };
    },
    stopGenerating: async () => {
      st.calls.push('stopGenerating');
      st.stopRequested = true;
    },
  };
}

function selectModel(query: string) {
  const candidates = matchModels(models.models, query);
  const model = candidates[0];
  return candidates.length === 1 && model
    ? { signIn, status: 'selected' as const, model, candidates, models: models.models, notes: [] }
    : {
        signIn,
        status: candidates.length ? ('ambiguous' as const) : ('not-found' as const),
        candidates,
        models: models.models,
        notes: [],
      };
}

/** A harness that records what the TUI asked it to do. */
export function fakeHarness(id: string, displayName: string, slow = false) {
  const st: FakeState = {
    calls: [],
    open: false,
    stopRequested: false,
    chats: [
      { id: 'c-large', title: 'Large Chat Test (Keep)' },
      { id: 'c-colours', title: 'Name three primary colours' },
      { id: 'c-story', title: 'Lighthouse story' },
    ],
    current: 'c-colours',
  };
  const listeners = new Set<() => void>();
  /** The harness's custom instructions, with some text of the user's own. */
  const instructions = { text: 'Always answer in Australian English.' };
  const started: StartResult = { signIn, notes: [] };
  /** Files in the harness's uploads, filled in for the project once the module is created. */
  const uploads: string[] = [];
  const opened = (call: string) => async () => {
    st.calls.push(call);
    st.open = true;
    return started;
  };
  const module: HarnessModule & Partial<PackHarness> = {
    id,
    displayName,
    // Like Copilot: with a chat to open, open it as part of start (no model applied first).
    start: async (opts = {}) => {
      const result = await opened('start')();
      if (!opts.chatId) return result;
      const chat = await module.openChat?.(opts.chatId);
      return chat ? { ...result, chat } : result;
    },
    restart: opened('restart'),
    login: async () => started,
    checkSignIn: async () => signIn,
    listModels: async () => models,
    selectModel: async (query) => selectModel(query),
    ...chatMethods(st),
    ...sendMethods(st, slow),
    isOpen: () => st.open,
    onClosed: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    waitUntilClosed: async () => {},
    stop: async () => {
      st.calls.push('stop');
      st.open = false;
    },
    uploads: fakeUploads(uploads, st.calls),
    customInstructions: {
      read: async () => instructions.text,
      write: async (text) => {
        st.calls.push('write-instructions');
        instructions.text = text;
      },
    },
  };
  const entry: HarnessEntry = {
    id,
    displayName,
    description: `${displayName} for tests`,
    create: (ctx) => {
      const p = path.basename(ctx.projectRoot);
      uploads.splice(0, uploads.length, ...uploadNames(p));
      // Like Copilot: the harness owns its pack exchange, with a download mode that fetches nothing here.
      module.transfer = {
        modes: [DIFF_MODE, downloadMode(async () => [])],
        defaultMode: 'diff',
        index: true,
      };
      module.exchange = createPackExchange({
        root: ctx.projectRoot,
        reinerDir: path.join(ctx.projectRoot, '.reiner'),
        stateDir: ctx.stateDir,
        displayName,
        settings: async () => (await ctx.readSettings?.()) ?? ctx.settings,
        support: module.transfer,
      });
      // What it remembers is read from its own state files, which the tests seed.
      const saved = <T>(name: string) => readState<T>(ctx.stateDir, name);
      module.remembered = {
        signIn: () => saved<SignInState>('signin'),
        models: async () => (await saved<ModelListResult>('models'))?.models ?? [],
        modelPreference: () => saved<ModelPreference>('model'),
        chats: async () => (await saved<ChatInfo[]>('recent-chats')) ?? [],
      };
      // The same slash commands Copilot brings, working on this fake.
      module.commands = chatHarnessCommands(module as ChatHarness);
      return module;
    },
  };
  return { entry, calls: st.calls, instructions, uploads };
}
