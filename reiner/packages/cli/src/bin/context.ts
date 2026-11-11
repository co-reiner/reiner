/**
 * @file Shared pieces of the shell commands: the commander program and global flags, status lines on
 * stderr, and opening, running and closing the browser for a one-shot run.
 * @see {@link ../../../../docs/architecture/cli-ux.md#entry-points | CLI and TUI: entry points}
 * @see {@link ../../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: harnesses and the live browser}
 */
import { type HarnessModule, REINER_VERSION } from '@co-reiner/core';
import { Command } from 'commander';
import { logoMark } from '../logo.ts';
import { NO_HARNESSES, openSession, type Session } from '../session.ts';

/** Where the project lives. REINER_CWD lets helper scripts run the CLI on behalf of another folder. */
export const startDir = process.env.REINER_CWD || process.cwd();

const startedAt = Date.now();
export const status = (message: string) =>
  process.stderr.write(`  … ${message} \x1b[90m(${((Date.now() - startedAt) / 1000).toFixed(1)}s)\x1b[0m\n`);

export const program = new Command()
  .name('reiner')
  .description(`${logoMark()} reiner: a terminal agent for AI harnesses that live in the browser`)
  .version(REINER_VERSION, '-v, --version')
  .option('--harness <id>', 'use this harness for this run instead of the project default')
  .option('--show-browser', "show the harness's browser window (the default)")
  .option('--hide-browser', 'run the browser in the background')
  .option('--keep-browser', 'one-shot commands: keep the browser window open afterwards until you close it')
  // Declared here so it is read before or after the command name (`--json models`, `models --json`).
  .option('--json', "one-shot harness commands: print the command's output as JSON instead of text");

export interface GlobalFlags {
  json?: boolean;
  harness?: string;
  showBrowser?: boolean;
  hideBrowser?: boolean;
  keepBrowser?: boolean;
}

/** Open the project session, applying the global flags on top of config. */
export async function openSessionWithFlags(): Promise<Session> {
  const flags = program.opts<GlobalFlags>();
  const s = await openSession(startDir, flags.harness ? { harness: flags.harness } : {});
  if (flags.hideBrowser) s.config.browser.headless = true;
  if (flags.showBrowser || flags.keepBrowser) s.config.browser.headless = false;
  if (flags.keepBrowser) s.config.browser.keepOpen = true;
  return s;
}

/** Wait for the browser to close, but never longer than `ms`. */
export async function stopWithin(module: HarnessModule, ms: number): Promise<void> {
  await Promise.race([module.stop({ wait: true }), new Promise((r) => setTimeout(r, ms))]);
}

/** Run a one-shot command against the active harness, then close (or keep) its browser. */
export async function oneShot(
  run: (module: HarnessModule, session: Session) => Promise<void>,
): Promise<void> {
  const session = await openSessionWithFlags();
  for (const n of session.notices) status(n);
  const module = session.module;
  if (!module) {
    if (session.available.length === 0) throw new Error(NO_HARNESSES);
    throw new Error(
      `No harness picked for this project. Run \`reiner init --harness <id>\`. Installed: ${session.available
        .map((h) => h.id)
        .join(', ')}`,
    );
  }
  try {
    await run(module, session);
    if (session.config.browser.keepOpen && !session.config.browser.headless && module.isOpen()) {
      status('Keeping the browser open. Close the browser window to finish.');
      await module.waitUntilClosed();
    }
  } finally {
    // Let the browser write cookies to disk, but do not hang: Edge can take a minute to shut down.
    await stopWithin(module, 10_000);
  }
}
