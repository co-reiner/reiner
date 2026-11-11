/**
 * @file The Google Search module's window: opening it on AI mode, checking the page is usable, handing a
 * robot check to the user, and closing.
 * @see {@link ../../docs/module.md#robot-checks | The Google Search module: robot checks}
 * @see {@link ../../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: the live browser}
 */
import { type OpenedProfile, openProfile, type Page } from '@co-reiner/browser';
import type { SignInState, StartResult, StatusListener } from '@co-reiner/core';
import * as S from './selectors.ts';
import {
  CHECK_TIMEOUT_MS,
  type GsState,
  LOGIN_TIMEOUT_MS,
  onRobotCheck,
  ROBOT_CHECK_REASON,
  saveSignIn,
  toSignIn,
  waitForState,
} from './state.ts';

async function launch(st: GsState, visible: boolean, onStatus?: StatusListener): Promise<OpenedProfile> {
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
    st.thread = undefined;
    void opened.close();
    for (const listener of st.closeListeners) listener();
  };
  opened.context.on('close', onGone);
  opened.page.on('close', onGone);
  st.live = opened;
  st.thread = undefined;
  onStatus?.(`Opening Google's AI mode in ${opened.channel}…`);
  await opened.page.goto(st.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  return opened;
}

const onGoogle = (page: Page): boolean => {
  try {
    const host = new URL(page.url()).host;
    return S.APP_HOSTS.test(host) || S.LOGIN_HOSTS.test(host);
  } catch {
    return false;
  }
};

/** The live tab: reuse it, or open the browser if it is not running. Brings the tab back to AI mode. */
export async function tab(
  st: GsState,
  onStatus?: StatusListener,
  mustBeVisible = false,
): Promise<OpenedProfile> {
  if (st.live && !st.live.page.isClosed() && !(mustBeVisible && st.live.headless)) {
    if (!onGoogle(st.live.page)) {
      onStatus?.("Bringing the tab back to Google's AI mode…");
      await st.live.page.goto(st.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      st.thread = undefined;
    }
    return st.live;
  }
  if (st.live) await stop(st);
  return launch(st, mustBeVisible || !st.ctx.browser.headless, onStatus);
}

export async function stop(st: GsState, opts: { wait?: boolean } = {}): Promise<void> {
  const opened = st.live;
  if (!opened) return;
  st.live = null;
  st.thread = undefined;
  for (const listener of st.closeListeners) listener();
  await opened.close(opts);
}

export async function check(
  st: GsState,
  opened: OpenedProfile,
  onStatus?: StatusListener,
): Promise<SignInState> {
  onStatus?.('Checking the page…');
  return saveSignIn(st, toSignIn(await waitForState(opened.page, CHECK_TIMEOUT_MS, false), opened.channel));
}

/** Live tab with a usable prompt box. Throws the reason when it is not (a robot check, a closed window). */
export async function readyPage(st: GsState, onStatus?: StatusListener): Promise<Page> {
  const opened = await tab(st, onStatus);
  const signIn = await check(st, opened, onStatus);
  if (!signIn.signedIn) {
    if (onRobotCheck(opened.page)) await showRobotCheck(st, onStatus);
    throw new Error(signIn.reason);
  }
  return opened.page;
}

export async function startResult(st: GsState, onStatus?: StatusListener): Promise<StartResult> {
  const opened = await tab(st, onStatus);
  const signIn = await check(st, opened, onStatus);
  if (!signIn.signedIn && onRobotCheck(opened.page)) await showRobotCheck(st, onStatus);
  return { signIn, notes: signIn.signedIn ? [] : [signIn.reason] };
}

/**
 * Put Google's robot check in front of the user: in a visible window, even when the browser was running
 * hidden (a hidden one is replaced by a visible one, which starts on a new conversation). Returns true
 * when the window is on the check. Nothing on the check page is touched.
 */
export async function showRobotCheck(st: GsState, onStatus?: StatusListener): Promise<boolean> {
  const opened = await tab(st, onStatus, true);
  if (!onRobotCheck(opened.page)) {
    onStatus?.('Looking for a robot check from Google…');
    await opened.page.goto(S.PROBE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await opened.page.waitForTimeout(2000).catch(() => {});
    st.thread = undefined;
  }
  if (!onRobotCheck(opened.page)) return false;
  await opened.page.bringToFront().catch(() => {});
  await saveSignIn(st, toSignIn('robot-check', opened.channel));
  return true;
}

/**
 * `/login`: there is no account to sign in to, so this is where a robot check gets answered. Shows the
 * window, opens an ordinary search (where Google shows a pending check), waits while the user answers it,
 * then goes back to AI mode. The user may also sign in to Google by hand in the same window.
 */
export async function login(
  st: GsState,
  opts: { timeoutMs?: number; onStatus?: StatusListener } = {},
): Promise<StartResult> {
  if (await showRobotCheck(st, opts.onStatus)) {
    opts.onStatus?.(`${ROBOT_CHECK_REASON.split('. ')[0]}. Answer it in the browser window; waiting…`);
    const page = st.live?.page;
    if (page) {
      const deadline = Date.now() + (opts.timeoutMs ?? LOGIN_TIMEOUT_MS);
      while (!page.isClosed() && onRobotCheck(page) && Date.now() < deadline) {
        await page.waitForTimeout(1000).catch(() => {});
      }
      if (page.isClosed() || onRobotCheck(page)) {
        const state = page.isClosed() ? 'closed' : 'robot-check';
        const signIn = await saveSignIn(st, toSignIn(state, st.live?.channel ?? ''));
        return { signIn, notes: signIn.signedIn ? [] : [signIn.reason] };
      }
    }
  }
  const page = st.live?.page;
  if (page && !page.isClosed()) {
    await page.goto(st.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    st.thread = undefined;
  }
  return startResult(st, opts.onStatus);
}

export function waitUntilClosed(st: GsState): Promise<void> {
  if (!st.live) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const off = () => {
      st.closeListeners.delete(off);
      resolve();
    };
    st.closeListeners.add(off);
  });
}
