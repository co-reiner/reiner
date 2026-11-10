/**
 * @file `/exit`: quits Reiner and closes the browser.
 * @see {@link ../../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 */
import type { SlashCommand } from './types.ts';

export const exitCommand: SlashCommand = {
  name: 'exit',
  scope: 'global',
  description: 'Quit Reiner (closes the browser)',
  run: (api) => api.exit(),
};
