/**
 * @file `/status [--check]`: shows the project, harness, browser and sign-in.
 * @see {@link ../../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 * @see {@link ../../../../../docs/architecture/modules.md#required-and-optional | Harness modules: required and optional}
 * @see {@link ../../../../../docs/architecture/cli-ux.md#harness-commands | CLI and TUI: harness commands}
 */
import { harness, status } from './shared.ts';
import type { SlashCommand } from './types.ts';

export const statusCommand: SlashCommand = {
  name: 'status',
  choices: () => [{ value: '--check', detail: 'open the browser and verify the sign-in' }],
  scope: 'global',
  args: '[--check]',
  description: 'Show project, harness, browser and sign-in status (--check verifies sign-in)',
  async run(api, args) {
    let signIn = await api.session.lastSignIn();
    const module = harness(api);
    if (args.includes('--check') && module.checkSignIn) {
      signIn = await module.checkSignIn({ onStatus: status(api) });
      api.setSignIn(signIn);
    } else if (args.includes('--check')) {
      api.print({ kind: 'info', text: `${module.displayName} has no sign-in to check.` });
    }
    api.print({ kind: 'status', signIn });
  },
};
