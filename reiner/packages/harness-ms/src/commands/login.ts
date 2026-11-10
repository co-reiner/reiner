/**
 * @file The `/login` command: sign in to the harness in its browser window.
 * @see {@link ../../docs/commands.md#commands | Copilot's slash commands: commands}
 * @see {@link ../../../../docs/architecture/tech-stack.md#headed-versus-headless | Tech stack: headed versus headless}
 */
import type { HarnessCommand } from '@co-reiner/core';
import { status } from './shared.ts';
import type { ChatHarness } from './types.ts';

export const loginCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'login',
  description: 'Sign in to the harness in its browser window',
  async run(host) {
    const result = await self.login({ onStatus: status(host) });
    host.setSignIn(result.signIn);
    host.print({ kind: 'started', result, harness: self.displayName });
  },
});
