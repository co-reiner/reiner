/**
 * @file State shared by the Google Search module's parts, and telling what the page is showing: the AI
 * mode prompt box, Google's robot check, or neither yet.
 *
 * Rule for this module: only do what a person could do in the page. Navigate, look, click, type. No calls
 * to Google's APIs, no reading of network traffic, nothing that hides the automation, and never an answer
 * to a robot check: that is handed to the user.
 * @see {@link ../../docs/module.md#code-layout | The Google Search module: code layout}
 * @see {@link ../../docs/module.md#robot-checks | The Google Search module: robot checks}
 */
import type { OpenedProfile, Page } from '@co-reiner/browser';
import { type HarnessContext, type SignInState, writeState } from '@co-reiner/core';
import * as S from './selectors.ts';

export const CHECK_TIMEOUT_MS = 30_000;
export const LOGIN_TIMEOUT_MS = 8 * 60_000;
/** How long send() waits for any reply text before it looks for a pending robot check. */
export const NO_REPLY_MS = 45_000;

export type PageState = 'ready' | 'robot-check' | 'timeout' | 'closed';

/** State shared by the module's parts: one per `createGoogleSearchModule` call. */
export interface GsState {
  ctx: HarnessContext;
  url: string;
  closeListeners: Set<() => void>;
  /** The one live browser window and tab for this harness. */
  live: OpenedProfile | null;
  /** Set by stopGenerating() so send() can report the reply as cut short. */
  stopRequested: boolean;
  /**
   * The conversation open in the tab, once a prompt has gone. Google gives a signed-out thread no id of
   * its own, so the module numbers them; the id only lives as long as the window.
   */
  thread: { id: string; title: string } | undefined;
  threads: number;
}

export function createState(ctx: HarnessContext): GsState {
  return {
    ctx,
    url: typeof ctx.settings.url === 'string' ? ctx.settings.url : S.AI_MODE_URL,
    closeListeners: new Set<() => void>(),
    live: null,
    stopRequested: false,
    thread: undefined,
    threads: 0,
  };
}

export const now = () => new Date().toISOString();

export const onRobotCheck = (page: Page): boolean => page.url().includes(S.ROBOT_CHECK_PATH);

/** Poll until the prompt box is there, Google asks for a robot check, the window closes, or time runs out. */
export async function waitForState(page: Page, timeoutMs: number, interactive: boolean): Promise<PageState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) return 'closed';
    if (onRobotCheck(page)) {
      if (!interactive) return 'robot-check';
    } else if (
      await page
        .locator(S.CHAT_INPUT)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      return 'ready';
    }
    try {
      await page.waitForTimeout(500);
    } catch {
      return 'closed';
    }
  }
  return 'timeout';
}

export const ROBOT_CHECK_REASON =
  'Google is asking to confirm you are not a robot. Run /login and answer it yourself in the browser window.';

export async function saveSignIn(st: GsState, state: SignInState): Promise<SignInState> {
  await writeState(st.ctx.stateDir, 'signin', state);
  return state;
}

/**
 * The page's state as a sign-in state. AI mode needs no account, so "signed in" here means "the prompt box
 * is usable"; a pending robot check counts as signed out, since only the user can clear it.
 */
export function toSignIn(state: PageState, channel: string): SignInState {
  if (state === 'ready') return { signedIn: true, checkedAt: now(), channel };
  const reason =
    state === 'robot-check'
      ? ROBOT_CHECK_REASON
      : state === 'closed'
        ? 'The browser window was closed.'
        : "Timed out waiting for Google's AI mode to load.";
  return { signedIn: false, checkedAt: now(), reason, channel };
}
