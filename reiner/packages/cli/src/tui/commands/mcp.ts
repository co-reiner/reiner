/**
 * @file `/mcp [reload]`: the MCP servers in the config, their state and their tools; `reload` restarts them
 * from the config as it is now.
 * @see {@link ../../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 * @see {@link ../../../../../docs/architecture/project-config.md#mcp-servers | Project configuration: MCP servers}
 */
import type { McpHub } from '@co-reiner/mcp';
import type { SlashCommand } from './types.ts';

/** One line per server, then its tools: which only read, which may change things, which run unasked. */
function report(hub: McpHub): string {
  const lines: string[] = [];
  for (const s of hub.status()) {
    const state =
      s.state === 'connected'
        ? `connected, ${s.tools} tools`
        : s.state === 'disabled'
          ? 'off'
          : `failed: ${s.error}`;
    lines.push(`${s.server}: ${state}`);
    for (const t of hub.tools().filter((x) => x.server === s.server)) {
      const marks = [
        t.readOnly ? 'reads' : 'may change things',
        ...(t.allowed && t.readOnly ? ['allowed'] : []),
      ];
      lines.push(`  ${t.name} (${marks.join(', ')})`);
    }
  }
  return lines.join('\n');
}

export const mcpCommand: SlashCommand = {
  name: 'mcp',
  scope: 'global',
  args: '[reload]',
  choices: () => [{ value: 'reload', detail: 'restart the servers from the config' }],
  description: 'Show the MCP servers and their tools (reload restarts them)',
  async run(api, args) {
    if (Object.keys(api.session.config.mcp.servers).length === 0 && args[0] !== 'reload') {
      api.print({
        kind: 'info',
        text: 'No MCP servers are set up. Add them under "mcp": { "servers": { … } } in .reiner/config.jsonc.',
      });
      return;
    }
    api.busy(args[0] === 'reload' ? 'Restarting the MCP servers…' : 'Connecting the MCP servers…');
    try {
      const hub = args[0] === 'reload' ? await api.session.mcp.reload() : await api.session.mcp.hub();
      // A chat that was told about the old tools is told again.
      if (args[0] === 'reload') api.checks.mcpTold.clear();
      api.print({ kind: 'info', text: report(hub) || 'No MCP servers are set up.' });
    } finally {
      api.busy(null);
    }
  },
};
