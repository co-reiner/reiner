/**
 * @file `/rounds [n]`: show or set how many tool rounds in a row may follow one prompt (`toolRounds`).
 * @see {@link ../../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 * @see {@link ../../../../../docs/architecture/tool-protocol.md#result-format-built | Tool protocol: result format}
 */
import { setConfigValue } from '@co-reiner/core';
import type { SlashCommand } from './types.ts';

/** The most rounds the setting takes: a stop is still a stop. */
const MAX = 50;

export const roundsCommand: SlashCommand = {
  name: 'rounds',
  scope: 'global',
  args: '[n]',
  // No suggested numbers: Enter takes the highlighted suggestion, so "/rounds 2" would become 20.
  description: 'Show or set how many tool rounds in a row may follow one prompt',
  async run(api, args) {
    const current = api.session.config.toolRounds;
    if (!args[0]) {
      api.print({
        kind: 'info',
        text: `Up to ${current} tool rounds follow one prompt. /rounds <n> changes it.`,
      });
      return;
    }
    const n = Number(args[0]);
    if (!Number.isInteger(n) || n < 1 || n > MAX) {
      api.print({ kind: 'error', text: `Give a whole number from 1 to ${MAX}, e.g. /rounds 10.` });
      return;
    }
    await setConfigValue(api.session.paths.configFile, ['toolRounds'], n);
    api.session.config.toolRounds = n;
    api.print({
      kind: 'success',
      text: `Saved: up to ${n} tool rounds follow one prompt, from the next turn.`,
    });
  },
};
