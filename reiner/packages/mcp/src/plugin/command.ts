/**
 * @file `/mcp [tools | reload | detail …]`: the MCP servers in the config, their state and their tools; `tools`
 * ticks which are offered to the model; `reload` restarts them from the config as it is now; `detail` sets
 * what the prompt line says about each tool.
 * @see {@link ../../../../docs/architecture/plugins.md | Plugins}
 * @see {@link ../../../../docs/architecture/project-config.md#mcp-servers | Project configuration: MCP servers}
 */
import { type PluginCommand, type PluginCommandHost, setConfigValue } from '@co-reiner/core';
import { type McpConfig, McpToolDetail } from '../config.ts';
import type { McpHub } from '../hub.ts';
import type { McpSession } from './session.ts';
import { toolsTree } from './tree.ts';

/** One line per server, then its tools: which only read, which may change things, which run unasked. */
function report(hub: McpHub, config: McpConfig): string {
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
        ...(config.servers[t.server]?.off.includes(t.tool) ? ['off: not offered'] : []),
      ];
      lines.push(`  ${t.name} (${marks.join(', ')})`);
    }
  }
  return lines.join('\n');
}

const detailText = (d: string) => (d === 'names' ? 'name only' : 'name and arguments');

/** `/mcp detail [names|arguments]`: show or set what the prompt line says about each tool. */
async function detail(s: McpSession, host: PluginCommandHost, value: string | undefined): Promise<void> {
  if (!value) {
    const current = (await s.config()).toolDetail;
    host.print({ kind: 'info', text: `The prompt line lists MCP tools by ${detailText(current)}.` });
    return;
  }
  const parsed = McpToolDetail.safeParse(value);
  if (!parsed.success) {
    host.print({ kind: 'error', text: 'Use /mcp detail names or /mcp detail arguments.' });
    return;
  }
  await setConfigValue(s.ctx.configFile, ['mcp', 'toolDetail'], parsed.data);
  // Each chat is told again, with the new line, on its next prompt.
  s.told.clear();
  host.print({
    kind: 'success',
    text: `Saved: the prompt line lists MCP tools by ${detailText(parsed.data)}.`,
  });
}

/** `/mcp` and `/mcp reload`: the servers and their tools, started (or restarted) first. */
async function show(s: McpSession, host: PluginCommandHost, reload: boolean): Promise<void> {
  const config = await s.config();
  if (Object.keys(config.servers).length === 0) {
    host.print({
      kind: 'info',
      text: 'No MCP servers are set up. Add them under "mcp": { "servers": { … } } in .reiner/config.jsonc.',
    });
    return;
  }
  host.busy(reload ? 'Restarting the MCP servers…' : 'Connecting the MCP servers…');
  try {
    const hub = reload ? await s.reload() : await s.hub(host);
    // A chat that was told about the old tools is told again.
    if (reload) s.told.clear();
    host.print({ kind: 'info', text: (hub && report(hub, config)) || 'No MCP servers are set up.' });
  } finally {
    host.busy(null);
  }
}

export const mcpCommand: PluginCommand = {
  name: 'mcp',
  args: '[tools | reload | detail [names|arguments]]',
  choices: () => [
    { value: 'tools', detail: 'tick the servers and tools offered to the model' },
    { value: 'reload', detail: 'restart the servers from the config' },
    { value: 'detail names', detail: 'the prompt names the tools; the model looks up the rest' },
    { value: 'detail arguments', detail: 'the prompt names the tools and their arguments' },
  ],
  description:
    'Show the MCP servers and their tools (tools picks them, reload restarts, detail sets the line)',
  async run(session, host, args) {
    // The plugin's own session: start() below makes every session this plugin is handed.
    const s = session as McpSession;
    if (args[0] === 'detail') return detail(s, host, args[1]);
    if (args[0] === 'tools') return toolsTree(s, host);
    return show(s, host, args[0] === 'reload');
  },
};
