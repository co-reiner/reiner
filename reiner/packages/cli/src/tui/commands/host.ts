/**
 * @file Builds the `CommandHost` a harness command runs against, for the TUI and for one-shot runs.
 * @see {@link ../../../../../docs/architecture/modules.md#harness-commands | Harness modules: harness commands}
 */
import path from 'node:path';
import type { CommandHost, HarnessCommand, HarnessModule } from '@co-reiner/core';
import { commandSignal } from '../command-api.ts';
import { type ChangeDeps, offerChanges } from './shared.ts';
import type { CommandApi, SlashCommand } from './types.ts';

/** What building a host needs: the TUI's command API, or the one-shot runner's stand-in. */
export type HostDeps = ChangeDeps & Pick<CommandApi, 'setSignIn' | 'setChat' | 'pick' | 'chat'>;

/** What a harness command may ask of the host, built from the command API. */
export function commandHost(api: HostDeps, module: HarnessModule): CommandHost {
  const { session } = api;
  return {
    projectRoot: session.root,
    stateDir: path.join(session.paths.modulesDir, module.id),
    print: api.print,
    busy: api.busy,
    signal: commandSignal(),
    confirm: api.confirm,
    pick: api.pick,
    setSignIn: api.setSignIn,
    setChat: api.setChat,
    lastChats: () => session.lastChats(),
    modelPreference: () => session.modelPreference(),
    log: (text) => void session.transcript.append({ role: 'event', text, harness: module.id }),
    offerChanges: async (sets, notes) => {
      // A failing check the user wants fixed becomes a chat turn, where the host has a chat.
      const followUp = await offerChanges(api, sets, notes);
      if (followUp) await api.chat?.(followUp);
    },
  };
}

/** A harness module's command as a TUI slash command. */
export function fromHarness(command: HarnessCommand, module: HarnessModule): SlashCommand {
  return {
    name: command.name,
    ...(command.args ? { args: command.args } : {}),
    description: command.description,
    scope: 'harness',
    ...(command.complete ? { complete: command.complete } : {}),
    ...(command.choices ? { choices: () => command.choices?.() ?? [] } : {}),
    run: (api, args) => command.run(commandHost(api, module), args),
  };
}
