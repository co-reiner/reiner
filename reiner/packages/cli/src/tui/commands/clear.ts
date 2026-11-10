/**
 * @file `/clear`: clears the screen.
 * @see {@link ../../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 */
import type { SlashCommand } from './types.ts';

export const clearCommand: SlashCommand = {
  name: 'clear',
  scope: 'global',
  description: 'Clear the screen',
  run: (api) => api.clear(),
};
