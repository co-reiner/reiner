/**
 * @file `/help`: lists the commands and keys.
 * @see {@link ../../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 */
import type { SlashCommand } from './types.ts';

export const helpCommand: SlashCommand = {
  name: 'help',
  scope: 'global',
  description: 'Show commands and keys',
  run: (api) => api.print({ kind: 'help' }),
};
