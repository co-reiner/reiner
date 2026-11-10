/**
 * @file State shared by the Copilot module's parts, its settings, and waiting for the app or the sign-in page.
 *
 * Rule for this module: only do what a person could do in the Copilot page. Navigate, look, click, type.
 * No direct calls to Microsoft APIs, no reading of network traffic, no reuse of tokens or cookies.
 * We puppet the harness, we do not reverse-engineer it: see the motto in the repo's AGENTS.md.
 * @see {@link ../../docs/module.md#code-layout | Copilot module: code layout}
 * @see {@link ../../docs/module.md#settings | Copilot module: settings}
 */
import type { OpenedProfile, Page } from '@co-reiner/browser';
import { type HarnessContext, type SignInState, writeState } from '@co-reiner/core';
import * as S from './selectors.ts';

export const CHECK_TIMEOUT_MS = 45_000;
export const LOGIN_TIMEOUT_MS = 5 * 60_000;
/**
 * After Copilot's stop button came and went with no reply text and no reply slot, how long the page must
 * stay idle (no stop button) before send() gives up.
 */
export const EMPTY_IDLE_MS = 20_000;
/**
 * How long send() waits for Copilot to start the turn at all: no stop button, no reply text and no reply
 * slot in this time means the page never took the prompt.
 */
export const NEVER_STARTED_MS = 30_000;
/**
 * After the user asks to stop a prompt that has gone but has no reply yet: how long send() keeps looking
 * for Copilot's stop button, to press it, before it gives up and says Copilot may still answer.
 */
export const STOP_WAIT_MS = 10_000;
/**
 * With an empty reply slot after the prompt (a thinking model is still working, and may hide its stop
 * button while it thinks), how long the page may stay idle before send() gives up.
 */
export const THINKING_IDLE_MS = 3 * 60_000;

export type PageState = 'signed-in' | 'needs-login' | 'timeout' | 'closed';

export type Locator = ReturnType<Page['locator']>;

/** State shared by the Copilot module's parts: one per `createCopilotModule` call. */
export interface CopilotState {
  ctx: HarnessContext;
  url: string;
  closeListeners: Set<() => void>;
  /** The one live browser window and tab for this harness. */
  live: OpenedProfile | null;
  /** Copilot resets the model to Auto on every page load; true until the saved model is re-applied. */
  modelDirty: boolean;
  /**
   * True after an existing chat was opened: it keeps the model it shows, and the saved model is not
   * re-applied until a new chat starts. Copilot can hide models for a while, so forcing the saved one
   * into an existing chat could fail or change a chat the user set up on purpose.
   */
  keepChatModel: boolean;
  /** Set by stopGenerating() so send() can report the reply as cut short. */
  stopRequested: boolean;
}

export function createState(ctx: HarnessContext): CopilotState {
  return {
    ctx,
    url: typeof ctx.settings.url === 'string' ? ctx.settings.url : S.COPILOT_URL,
    closeListeners: new Set<() => void>(),
    live: null,
    modelDirty: true,
    keepChatModel: false,
    stopRequested: false,
  };
}

export const now = () => new Date().toISOString();

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

async function anyVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    if (
      await page
        .locator(selector)
        .first()
        .isVisible()
        .catch(() => false)
    )
      return true;
  }
  return false;
}

/** Poll until the Copilot app is ready, the sign-in page asks for input, the window closes, or time runs out. */
export async function waitForState(page: Page, timeoutMs: number, interactive: boolean): Promise<PageState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) return 'closed';
    const host = hostOf(page.url());
    if (S.APP_HOSTS.test(host) && (await anyVisible(page, S.CHAT_INPUT))) return 'signed-in';
    if (!interactive && S.LOGIN_HOSTS.test(host) && (await anyVisible(page, S.LOGIN_PROMPTS))) {
      return 'needs-login';
    }
    try {
      await page.waitForTimeout(500);
    } catch {
      return 'closed';
    }
  }
  return 'timeout';
}

export async function saveSignIn(st: CopilotState, state: SignInState): Promise<SignInState> {
  await writeState(st.ctx.stateDir, 'signin', state);
  return state;
}

export function toSignIn(state: PageState, channel: string): SignInState {
  if (state === 'signed-in') return { signedIn: true, checkedAt: now(), channel };
  const reason =
    state === 'needs-login'
      ? 'Microsoft sign-in is needed. Run /login (or `reiner login`).'
      : state === 'closed'
        ? 'The browser window was closed.'
        : 'Timed out waiting for Copilot to load.';
  return { signedIn: false, checkedAt: now(), reason, channel };
}
