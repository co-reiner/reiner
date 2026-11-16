/**
 * @file A plugin's command as a TUI slash command: it runs with that plugin's session for this project.
 * @see {@link ../../../../../docs/architecture/plugins.md | Plugins}
 */
import type { PluginCommand, PluginCommandHost, ReinerPlugin } from '@co-reiner/core';
import type { CommandApi, SlashCommand } from './types.ts';

/** What a plugin's command may ask of the TUI. */
function pluginCommandHost(api: CommandApi): PluginCommandHost {
  return {
    harnessName: api.session.harness?.displayName ?? 'The model',
    print: api.print,
    busy: api.busy,
    confirm: api.confirm,
    choose: api.choose,
  };
}

export function fromPlugin(command: PluginCommand, plugin: ReinerPlugin): SlashCommand {
  return {
    name: command.name,
    ...(command.args ? { args: command.args } : {}),
    description: command.description,
    scope: 'global',
    ...(command.choices ? { choices: () => command.choices?.() ?? [] } : {}),
    run: (api, args) => {
      const active = api.session.plugins.find((p) => p.plugin.id === plugin.id);
      if (!active) {
        api.print({ kind: 'error', text: `/${command.name} is not available in this session.` });
        return;
      }
      return command.run(active.session, pluginCommandHost(api), args);
    },
  };
}
