/**
 * @file The `/models` command: list the models the harness offers to the account.
 * @see {@link ../../docs/commands.md#commands | Copilot's slash commands: commands}
 * @see {@link ../../docs/module.md#models | Copilot module: models}
 * @see {@link ../../docs/commands.md#argument-completion | Copilot's slash commands: argument completion}
 */
import type { HarnessCommand } from '@co-reiner/core';
import { status } from './shared.ts';
import type { ChatHarness } from './types.ts';

export const modelsCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'models',
  choices: () => [{ value: '--debug', detail: 'also write a page dump for fixing selectors' }],
  args: '[--debug]',
  description: 'List the models the harness offers to your account',
  async run(host, args) {
    const result = await self.listModels({
      debug: args.includes('--debug'),
      onStatus: status(host),
    });
    host.setSignIn(result.signIn);
    host.print({ kind: 'models', result });
  },
});
