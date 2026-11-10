/**
 * @file Copilot's live tab: opening it, checking and waiting for sign-in, re-applying the saved model, closing.
 * @see {@link ../../docs/module.md#models | Copilot module: models}
 * @see {@link ../../docs/module.md#page-lessons | Copilot module: page lessons}
 * @see {@link ../../../../docs/architecture/tech-stack.md#headed-versus-headless | Tech stack: headed versus headless}
 * @see {@link ../../../../AGENTS.md#browser-gotchas | AGENTS.md: browser gotchas}
 */
import { type OpenedProfile, openProfile, type Page } from '@co-reiner/browser';
import {
  type ChatInfo,
  type ModelInfo,
  type ModelPreference,
  matchModels,
  readState,
  type SignInState,
  type StartResult,
  type StatusListener,
  writeState,
} from '@co-reiner/core';
import { clickPath, pickerButtonModel, readPicker } from './picker.ts';
import * as S from './selectors.ts';
import {
  CHECK_TIMEOUT_MS,
  type CopilotState,
  hostOf,
  LOGIN_TIMEOUT_MS,
  now,
  saveSignIn,
  toSignIn,
  waitForState,
} from './state.ts';

async function launch(st: CopilotState, visible: boolean, onStatus?: StatusListener): Promise<OpenedProfile> {
  onStatus?.(`Starting ${visible ? 'a visible' : 'a background'} browser…`);
  const opened = await openProfile({
    profileDir: st.ctx.profileDir,
    channel: st.ctx.browser.channel,
    headless: !visible,
    keepSession: st.ctx.browser.keepSession === true,
    onWait: () => onStatus?.('Waiting for the previous browser to finish closing…'),
  });
  const onGone = () => {
    if (st.live !== opened) return;
    st.live = null;
    void opened.close();
    for (const listener of st.closeListeners) listener();
  };
  opened.context.on('close', onGone);
  opened.page.on('close', onGone);
  opened.page.on('load', () => {
    st.modelDirty = true;
  });
  st.live = opened;
  st.modelDirty = true;
  // A fresh window opens on a new chat, so the saved model applies again (openChat sets this afterwards).
  st.keepChatModel = false;
  onStatus?.(`Opening Microsoft 365 Copilot in ${opened.channel}…`);
  await opened.page.goto(st.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  return opened;
}

/** The live tab: reuse it, or open the browser if it is not running. Brings the tab back to Copilot. */
export async function tab(
  st: CopilotState,
  onStatus?: StatusListener,
  mustBeVisible = false,
): Promise<OpenedProfile> {
  if (st.live && !st.live.page.isClosed() && !(mustBeVisible && st.live.headless)) {
    const host = hostOf(st.live.page.url());
    if (!S.APP_HOSTS.test(host) && !S.LOGIN_HOSTS.test(host)) {
      onStatus?.('Bringing the tab back to Copilot…');
      await st.live.page.goto(st.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      // Back on a new chat: the chat whose model was being kept is no longer open.
      st.keepChatModel = false;
      st.modelDirty = true;
    }
    return st.live;
  }
  if (st.live) await stop(st);
  return launch(st, mustBeVisible || !st.ctx.browser.headless, onStatus);
}

export async function stop(st: CopilotState, opts: { wait?: boolean } = {}): Promise<void> {
  const opened = st.live;
  if (!opened) return;
  st.live = null;
  for (const listener of st.closeListeners) listener();
  await opened.close(opts);
}

export async function check(
  st: CopilotState,
  opened: OpenedProfile,
  onStatus?: StatusListener,
): Promise<SignInState> {
  onStatus?.('Checking sign-in…');
  return saveSignIn(st, toSignIn(await waitForState(opened.page, CHECK_TIMEOUT_MS, false), opened.channel));
}

/** What to say when the project's model cannot be selected (Copilot hides models now and then). */
export const modelMissing = (label: string) =>
  `The project's model "${label}" is not available in this chat right now. Pick another with /model, or switch to a buffer chat that has it (see the README in @co-reiner/harness-ms).`;

/**
 * Select the project's saved model again when Copilot has dropped it: after a page load, or when the
 * picker button no longer shows it (a new chat, or a change made by hand in the window, resets it
 * without a page load). Reading the button's label is cheap; the picker is only opened on a mismatch.
 */
export async function reapplyModel(
  st: CopilotState,
  page: Page,
  notes: string[],
  onStatus?: StatusListener,
): Promise<ModelInfo | undefined> {
  const pref = await readState<ModelPreference>(st.ctx.stateDir, 'model');
  if (!pref || st.keepChatModel) {
    st.modelDirty = false;
    return undefined;
  }
  if (!st.modelDirty) {
    const shown = await pickerButtonModel(page);
    if (shown === undefined || pref.label.toLowerCase().startsWith(shown.toLowerCase())) return undefined;
  }
  onStatus?.(`Selecting this project's model: ${pref.group ? `${pref.group} › ` : ''}${pref.label}…`);
  await page.waitForTimeout(1500).catch(() => {});
  let models = await readPicker(page, []);
  // Just after a load the picker may not be there yet. An empty read is not "the model is gone": look
  // once more, and if it is still empty leave the model to be applied with the next action.
  if (models.length === 0) {
    await page.waitForTimeout(2000).catch(() => {});
    models = await readPicker(page, []);
  }
  if (models.length === 0) {
    notes.push(
      `The model picker could not be read yet, so "${pref.label}" is not selected. It is tried again with your next prompt.`,
    );
    return undefined;
  }
  const target = models.find((m) => m.id === pref.id) ?? matchModels(models, pref.label)[0];
  if (!target) {
    notes.push(modelMissing(pref.label));
    st.modelDirty = false;
    return undefined;
  }
  let current = models;
  if (!target.selected) {
    await clickPath(page, target.path ?? [target.label]);
    current = await readPicker(page, []);
    if (current.find((m) => m.id === target.id)?.selected !== true) {
      notes.push(modelMissing(pref.label));
      return undefined;
    }
  }
  // Keep the cached list (used for /model suggestions) in step with what the picker now shows.
  const signIn: SignInState = { signedIn: true, checkedAt: now() };
  await writeState(st.ctx.stateDir, 'models', { signIn, models: current, source: 'picker', notes: [] });
  st.modelDirty = false;
  return { ...target, selected: true };
}

/** Live tab, signed in, saved model applied. Returns the sign-in state when not signed in. */
export async function ready(
  st: CopilotState,
  notes: string[],
  onStatus?: StatusListener,
): Promise<{ page: Page; signIn: SignInState; appliedModel?: ModelInfo }> {
  const opened = await tab(st, onStatus);
  const signIn = await check(st, opened, onStatus);
  if (!signIn.signedIn) return { page: opened.page, signIn };
  const appliedModel = await reapplyModel(st, opened.page, notes, onStatus);
  return { page: opened.page, signIn, ...(appliedModel ? { appliedModel } : {}) };
}

/** Live tab, signed in, nothing applied: for opening an existing chat, which keeps its own model. */
export async function signedInTab(st: CopilotState, onStatus?: StatusListener): Promise<Page> {
  const opened = await tab(st, onStatus);
  const signIn = await check(st, opened, onStatus);
  if (!signIn.signedIn) throw new Error(signIn.reason);
  return opened.page;
}

/** Like ready(), but throws when not signed in. */
export async function signedInPage(
  st: CopilotState,
  notes: string[],
  onStatus?: StatusListener,
): Promise<Page> {
  const { page, signIn } = await ready(st, notes, onStatus);
  if (!signIn.signedIn) throw new Error(signIn.reason);
  return page;
}

/**
 * Start: open the tab and check sign-in. With a chat to open, open it first and keep its model (see
 * `keepChatModel`); the saved model is only applied when no chat is opened, or opening one failed.
 */
export async function startResult(
  st: CopilotState,
  onStatus?: StatusListener,
  open?: (onStatus?: StatusListener) => Promise<ChatInfo>,
): Promise<StartResult> {
  const notes: string[] = [];
  if (open) {
    const signIn = await check(st, await tab(st, onStatus), onStatus);
    if (!signIn.signedIn) return { signIn, notes: [signIn.reason] };
    try {
      return { signIn, notes, chat: await open(onStatus) };
    } catch (error) {
      const chatError = error instanceof Error ? error.message : String(error);
      const { appliedModel } = await ready(st, notes, onStatus);
      return { signIn, notes, chatError, ...(appliedModel ? { appliedModel } : {}) };
    }
  }
  const { signIn, appliedModel } = await ready(st, notes, onStatus);
  if (!signIn.signedIn) notes.push(signIn.reason);
  return { signIn, notes, ...(appliedModel ? { appliedModel } : {}) };
}

export async function login(
  st: CopilotState,
  opts: { timeoutMs?: number; onStatus?: StatusListener } = {},
): Promise<StartResult> {
  // Sign-in needs a visible window. A headless browser is replaced by a visible one.
  const opened = await tab(st, opts.onStatus, true);
  const current = await waitForState(opened.page, 5000, false);
  if (current !== 'signed-in') {
    if (!S.LOGIN_HOSTS.test(hostOf(opened.page.url()))) {
      await opened.page.goto(st.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    await opened.page.bringToFront().catch(() => {});
    opts.onStatus?.('Sign in to Microsoft 365 in the browser window. Reiner waits until Copilot loads.');
    const state = await waitForState(opened.page, opts.timeoutMs ?? LOGIN_TIMEOUT_MS, true);
    if (state !== 'signed-in') {
      const signIn = await saveSignIn(st, toSignIn(state, opened.channel));
      return { signIn, notes: signIn.signedIn ? [] : [signIn.reason] };
    }
  }
  return startResult(st, opts.onStatus);
}

export function waitUntilClosed(st: CopilotState): Promise<void> {
  const opened = st.live;
  if (!opened) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const off = () => {
      st.closeListeners.delete(off);
      resolve();
    };
    st.closeListeners.add(off);
  });
}
