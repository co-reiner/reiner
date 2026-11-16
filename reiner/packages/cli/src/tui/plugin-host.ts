/**
 * @file The plugins in a chat turn: their lines for the prompt, the tool names they answer, and passing a call
 * to the plugin that owns the tool. The CLI knows plugins only through the contract in core.
 * @see {@link ../../../../docs/architecture/plugins.md | Plugins}
 */
import type { PluginHost, ToolAnswer } from '@co-reiner/core';
import type { ChecksApi } from './checks.ts';

/** What a plugin may ask of the TUI while a turn runs. */
export function pluginHost(api: ChecksApi): PluginHost {
  return {
    harnessName: api.session.harness?.displayName ?? 'The model',
    print: api.print,
    busy: api.busy,
    confirm: api.confirm,
  };
}

/** What every plugin adds to the next prompt in this chat, in the order the plugins were handed in. */
export async function pluginLines(api: ChecksApi, chatId: string | undefined): Promise<string> {
  const host = pluginHost(api);
  let lines = '';
  for (const p of api.session.plugins) lines += await p.session.promptLine(chatId, host);
  return lines;
}

/** The prompt with the plugins' lines went to this chat. */
export function pluginLinesSent(api: ChecksApi, chatId: string | undefined): void {
  for (const p of api.session.plugins) p.session.promptSent(chatId);
}

export interface PluginTools {
  /** Every tool name a plugin answers, for reading a reply's calls. */
  names: string[];
  /** Pass a call to the plugin that owns the tool. */
  call(name: string, args: Record<string, unknown>): Promise<ToolAnswer>;
}

/** The plugins' tools for this turn; the first plugin to name a tool owns it. */
export async function pluginTools(api: ChecksApi): Promise<PluginTools> {
  const host = pluginHost(api);
  const owners = new Map<string, (typeof api.session.plugins)[number]>();
  for (const p of api.session.plugins) {
    for (const name of await p.session.toolNames(host)) if (!owners.has(name)) owners.set(name, p);
  }
  return {
    names: [...owners.keys()],
    call: async (name, args) => {
      const owner = owners.get(name);
      if (!owner) return { lines: [`${name} is not available.`], summary: `${name}: not available.` };
      return owner.session.call(name, args, host);
    },
  };
}
