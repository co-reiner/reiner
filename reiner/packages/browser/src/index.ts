/**
 * @file Launching a Playwright persistent browser on a harness's profile folder, and closing it in the background.
 * @see {@link ../../../docs/architecture/tech-stack.md#browser-selection-order | Tech stack: browser selection order}
 * @see {@link ../../../docs/architecture/tech-stack.md#headed-versus-headless | Tech stack: headed versus headless}
 * @see {@link ../../../AGENTS.md#browser-gotchas | AGENTS.md: browser gotchas}
 * @see {@link ../../../docs/architecture/project-config.md#security-notes | Project configuration: security notes}
 */
import { mkdir } from 'node:fs/promises';
import type { BrowserChannel } from '@co-reiner/core';
import { type BrowserContext, chromium, type Page } from 'playwright-core';

export type { BrowserContext, Page } from 'playwright-core';

export interface OpenProfileOptions {
  profileDir: string;
  channel: BrowserChannel;
  headless: boolean;
  /**
   * Keep session cookies (a sign-in without "Stay signed in") between runs. Chromium keeps them only when
   * it restores the last session, so the browser starts with `--restore-last-session`, its own option; the
   * tabs it restores are closed again, leaving one.
   */
  keepSession?: boolean;
}

export interface OpenedProfile {
  context: BrowserContext;
  /** The channel that actually launched. */
  channel: Exclude<BrowserChannel, 'auto'>;
  headless: boolean;
  page: Page;
  /**
   * Close the browser. Edge and Chrome can take 10 to 70 seconds to shut down after visiting
   * Microsoft 365, so by default this starts the close and returns at once. Pass `wait: true`
   * when the profile must be fully written to disk first (for example right after sign-in).
   * The next `openProfile` on the same folder waits for a pending close.
   */
  close(opts?: { wait?: boolean }): Promise<void>;
}

const AUTO_ORDER: Exclude<BrowserChannel, 'auto'>[] = ['msedge', 'chrome', 'chromium'];

/** Closes still running in the background, by profile folder. */
const closing = new Map<string, Promise<void>>();

class ProfileInUseError extends Error {
  constructor(profileDir: string) {
    super(
      `This harness's browser is already open in another Reiner session (profile: ${profileDir}). ` +
        'Most likely a `reiner` TUI is still running for this project in another terminal. ' +
        'Quit it with /exit (or Ctrl+C), or close its browser window, then try again.',
    );
  }
}

/**
 * Launch a persistent browser context on a profile folder. Cookies and storage survive between runs,
 * so a sign-in done once in a visible window can be reused later in a headless one.
 */
export async function openProfile(
  opts: OpenProfileOptions & { onWait?: () => void },
): Promise<OpenedProfile> {
  const pending = closing.get(opts.profileDir);
  if (pending) {
    opts.onWait?.();
    await pending;
  }
  await mkdir(opts.profileDir, { recursive: true, mode: 0o700 });
  const order = opts.channel === 'auto' ? AUTO_ORDER : [opts.channel];
  const failures: string[] = [];

  for (const channel of order) {
    try {
      const context = await chromium.launchPersistentContext(opts.profileDir, {
        ...(channel === 'chromium' ? {} : { channel }),
        headless: opts.headless,
        viewport: opts.headless ? { width: 1400, height: 900 } : null,
        // No flags that hide automation from the site: Reiner drives the page openly.
        args: [
          '--no-first-run',
          '--no-default-browser-check',
          ...(opts.keepSession ? ['--restore-last-session'] : []),
        ],
      });
      // Tabs the last session left are restored with it; one tab is driven, so the others are closed.
      for (const extra of context.pages().slice(1)) await extra.close().catch(() => {});
      // A window that opened but gives no page is closed again, or it would keep the profile locked.
      const page =
        context.pages()[0] ??
        (await context.newPage().catch(async (error) => {
          await context.close().catch(() => {});
          throw error;
        }));
      // One close per window, however often it is asked for: a second call joins the first. Before, a
      // second call returned at once (Playwright ignores it) and took the entry out of `closing`, so the next
      // launch did not wait and hit the locked profile.
      let pending: Promise<void> | undefined;
      const close = async ({ wait = false } = {}) => {
        if (!pending) {
          const started: Promise<void> = context
            .close()
            .catch(() => {})
            .finally(() => {
              if (closing.get(opts.profileDir) === started) closing.delete(opts.profileDir);
            });
          pending = started;
          closing.set(opts.profileDir, started);
        }
        if (wait) await pending;
      };
      return { context, channel, headless: opts.headless, page, close };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Whole words only: "lock" must not match "block" or "clock" in some other launch error.
      if (
        /user data directory is already in use|ProcessSingleton|SingletonLock|\block(ed)?\b/i.test(message)
      ) {
        throw new ProfileInUseError(opts.profileDir);
      }
      failures.push(`${channel}: ${message.split('\n')[0]}`);
    }
  }

  throw new Error(
    `Could not start a browser. Install Microsoft Edge or Google Chrome, or set "browser.channel" in ` +
      `.reiner/config.jsonc.\n${failures.map((f) => `  - ${f}`).join('\n')}`,
  );
}
