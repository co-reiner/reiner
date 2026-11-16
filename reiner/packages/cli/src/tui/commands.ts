/**
 * @file The TUI's slash command list: the harness's commands first, then the global ones, whose names
 * stay reserved, then the plugins' commands.
 * @see {@link ../../../../docs/architecture/cli-ux.md#harness-commands | CLI and TUI: harness commands}
 * @see {@link ../../../../docs/architecture/modules.md#harness-commands | Harness modules: harness commands}
 */
import type { HarnessModule } from '@co-reiner/core';
import { installedPlugins } from '../plugins.ts';
import { browserCommand } from './commands/browser.ts';
import { clearCommand } from './commands/clear.ts';
import { continueCommand } from './commands/continue.ts';
import { exitCommand } from './commands/exit.ts';
import { harnessCommand } from './commands/harness.ts';
import { helpCommand } from './commands/help.ts';
import { fromHarness } from './commands/host.ts';
import { fromPlugin } from './commands/plugin.ts';
import { roundsCommand } from './commands/rounds.ts';
import { statusCommand } from './commands/status.ts';
import type { SlashCommand } from './commands/types.ts';

export { offerChanges } from './commands/shared.ts';
export type { CommandApi, SlashCommand } from './commands/types.ts';

/**
 * Reiner's own commands, one file each under `commands/`, in /help order. Everything that depends on the
 * harness (sign-in, models, chats, file exchange) comes from the active harness module's `commands`.
 */
export const GLOBAL_COMMANDS: SlashCommand[] = [
  helpCommand,
  harnessCommand,
  statusCommand,
  browserCommand,
  continueCommand,
  roundsCommand,
  clearCommand,
  exitCommand,
];

const isGlobal = (name: string) => GLOBAL_COMMANDS.some((g) => g.name === name);

/**
 * Commands for the active harness: the harness's own first, then the global ones, then the plugins'. Neither
 * a harness nor a plugin command hides a global one, and a plugin command never hides a harness one.
 */
export function commandsFor(module: HarnessModule | null | undefined): SlashCommand[] {
  const own = module
    ? (module.commands ?? []).filter((c) => !isGlobal(c.name)).map((c) => fromHarness(c, module))
    : [];
  const taken = new Set([...own, ...GLOBAL_COMMANDS].map((c) => c.name));
  const plugins = installedPlugins().flatMap((p) =>
    (p.commands ?? []).filter((c) => !taken.has(c.name)).map((c) => fromPlugin(c, p)),
  );
  return [...own, ...GLOBAL_COMMANDS, ...plugins];
}

export function matchCommands(input: string, module?: HarnessModule | null): SlashCommand[] {
  if (!input.startsWith('/')) return [];
  const typed = input.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';
  // An exact name comes first, so "/model" + Tab completes to /model, not /models. The sort is stable,
  // so the harness-then-global order holds for the rest.
  return commandsFor(module)
    .filter((c) => c.name.startsWith(typed))
    .sort((a, b) => Number(b.name === typed) - Number(a.name === typed));
}

export function parseCommand(
  input: string,
  module?: HarnessModule | null,
): { command?: SlashCommand; name: string; args: string[] } {
  const [name = '', ...args] = input.slice(1).trim().split(/\s+/);
  return { command: commandsFor(module).find((c) => c.name === name.toLowerCase()), name, args };
}
