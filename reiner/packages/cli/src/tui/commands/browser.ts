/**
 * @file `/browser show|hide`: shows the harness's window or runs it in the background, restarting the browser.
 * @see {@link ../../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 * @see {@link ../../../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: harnesses and the live browser}
 * @see {@link ../../../../../docs/architecture/cli-ux.md#harness-commands | CLI and TUI: harness commands}
 */
import { harness, status } from './shared.ts';
import type { SlashCommand } from './types.ts';

export const browserCommand: SlashCommand = {
  name: 'browser',
  choices: () => [
    { value: 'show', detail: 'a visible window' },
    { value: 'hide', detail: 'run in the background' },
  ],
  scope: 'global',
  args: 'show | hide',
  description: "Show the harness's browser window, or run it in the background (reopens the browser)",
  async run(api, args) {
    const browser = api.session.config.browser;
    const want = args[0];
    if (want !== 'show' && want !== 'hide') {
      api.print({
        kind: 'info',
        text: `Browser is ${browser.headless ? 'hidden (in the background)' : 'visible'}. Use /browser show or /browser hide.`,
      });
      return;
    }
    const headless = want === 'hide';
    if (browser.headless === headless && api.session.module?.isOpen()) {
      api.print({ kind: 'info', text: `Browser is already ${headless ? 'hidden' : 'visible'}.` });
      return;
    }
    browser.headless = headless;
    api.print({
      kind: 'info',
      text: `Reopening the browser ${headless ? 'in the background' : 'as a visible window'}. Set "browser.headless" in .reiner/config.jsonc to make it stick.`,
    });
    const result = await harness(api).restart({ onStatus: status(api) });
    api.setSignIn(result.signIn);
    api.print({ kind: 'started', result, harness: harness(api).displayName });
  },
};
