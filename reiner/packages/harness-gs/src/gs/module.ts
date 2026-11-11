/**
 * @file The Google Search harness module: AI mode of Google Search, driven through its page. The parts
 * share one GsState (state.ts). Only do what a person could do in the page (see the rule in state.ts).
 * @see {@link ../../docs/module.md#code-layout | The Google Search module: code layout}
 * @see {@link ../../docs/file-exchange.md | Google Search file exchange}
 */
import { type HarnessContext, readState, type SignInState } from '@co-reiner/core';
import { type GsHarness, gsCommands } from '../commands.ts';
import { createGsExchange } from '../exchange/exchange.ts';
import { check, login, startResult, stop, tab, waitUntilClosed } from './browser.ts';
import { newChat, send, stopGenerating } from './send.ts';
import { createState } from './state.ts';

export const DISPLAY_NAME = 'Google AI Mode';

export function createGoogleSearchModule(ctx: HarnessContext): GsHarness {
  const st = createState(ctx);
  const exchange = createGsExchange({
    root: ctx.projectRoot,
    stateDir: ctx.stateDir,
    displayName: DISPLAY_NAME,
    settings: async () => (await ctx.readSettings?.()) ?? ctx.settings,
  });

  const self: GsHarness = {
    id: 'google-search',
    displayName: DISPLAY_NAME,

    start: (opts = {}) => startResult(st, opts.onStatus),
    async restart(opts = {}) {
      await stop(st);
      return startResult(st, opts.onStatus);
    },
    login: (opts = {}) => login(st, opts),
    checkSignIn: async (opts = {}) => check(st, await tab(st, opts.onStatus), opts.onStatus),

    async newChat(opts = {}) {
      await newChat(st, opts.onStatus);
      exchange.reset();
      return undefined;
    },
    send: (prompt, opts = {}) => send(st, prompt, opts),
    stopGenerating: () => stopGenerating(st),
    // A conversation has no id of Google's without an account: the module's own number stands in, so the
    // host can tell one conversation from the next. It cannot be reopened later.
    currentChat: async () => st.thread,

    exchange,
    remembered: { signIn: () => readState<SignInState>(ctx.stateDir, 'signin') },

    isOpen: () => st.live !== null && !st.live.page.isClosed(),
    onClosed(listener) {
      st.closeListeners.add(listener);
      return () => st.closeListeners.delete(listener);
    },
    waitUntilClosed: () => waitUntilClosed(st),
    stop: (opts) => stop(st, opts),
  };
  self.commands = gsCommands(self);
  return self;
}
