/**
 * @file `/mcp tools`: a tree of the MCP servers and their tools to tick; what is unticked is not offered to
 * the model from the next prompt on, and is saved in the project's config.
 * @see {@link ../../../../docs/architecture/project-config.md#mcp-servers | Project configuration: MCP servers}
 * @see {@link ../../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
import { type PickOption, type PluginCommandHost, setConfigValue } from '@co-reiner/core';
import type { McpServerConfig } from '../config.ts';
import type { McpHub } from '../hub.ts';
import type { McpSession } from './session.ts';

/** What a row of the tree stands for: a server, or one of its tools. */
interface Row {
  server: string;
  tool?: string;
}

interface Tree {
  options: PickOption[];
  rows: Row[];
  ticked: number[];
}

/** The tree as it stands: a server row (ticked when it is on with all its tools), then its tools. */
function buildTree(servers: Record<string, McpServerConfig>, hub: McpHub | undefined): Tree {
  const tree: Tree = { options: [], rows: [], ticked: [] };
  for (const [server, config] of Object.entries(servers)) {
    const tools = hub?.tools().filter((t) => t.server === server) ?? [];
    const failed = hub?.status().find((s) => s.server === server)?.state === 'failed';
    const at = tree.options.length;
    const detail = !config.enabled ? 'off' : failed ? 'did not start' : `${tools.length} tools`;
    tree.options.push({ label: server, detail });
    tree.rows.push({ server });
    let all = config.enabled;
    for (const t of tools) {
      const on = config.enabled && !config.off.includes(t.tool);
      if (on) tree.ticked.push(tree.options.length);
      else all = false;
      tree.options.push({ label: t.tool, detail: t.readOnly ? 'reads' : 'may change things', indent: 1 });
      tree.rows.push({ server, tool: t.tool });
    }
    if (all) tree.ticked.push(at);
  }
  tree.ticked.sort((a, b) => a - b);
  return tree;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Save what was ticked: a server with none of its tools ticked (or, when its tools are not known, its own
 * row unticked) is turned off; the unticked tools of a server that stays on are its `off` list. Returns
 * whether a server was turned on or off, which needs a restart of the servers.
 */
async function save(
  s: McpSession,
  servers: Record<string, McpServerConfig>,
  tree: Tree,
  chosen: number[],
): Promise<boolean> {
  const on = new Set(chosen);
  let restart = false;
  for (const [server, config] of Object.entries(servers)) {
    const own = tree.rows.findIndex((r) => r.server === server && !r.tool);
    const tools = tree.rows.flatMap((r, i) => (r.server === server && r.tool ? [i] : []));
    const enabled = tools.length ? tools.some((i) => on.has(i)) : on.has(own);
    const off = enabled ? tools.filter((i) => !on.has(i)).map((i) => tree.rows[i]?.tool ?? '') : config.off;
    const file = s.ctx.configFile;
    if (enabled !== config.enabled) {
      await setConfigValue(file, ['mcp', 'servers', server, 'enabled'], enabled);
      restart = true;
    }
    if (!sameList(off, config.off)) await setConfigValue(file, ['mcp', 'servers', server, 'off'], off);
  }
  return restart;
}

export async function toolsTree(s: McpSession, host: PluginCommandHost): Promise<void> {
  const { servers } = await s.config();
  if (Object.keys(servers).length === 0) {
    host.print({ kind: 'info', text: 'No MCP servers are set up.' });
    return;
  }
  const hub = await s.hub(host).finally(() => host.busy(null));
  const tree = buildTree(servers, hub);
  const chosen = await host.choose('MCP tools offered to the model', tree.options, tree.ticked);
  if (!chosen) {
    host.print({ kind: 'info', text: 'Nothing changed.' });
    return;
  }
  if (await save(s, servers, tree, chosen)) {
    host.busy('Restarting the MCP servers…');
    await s.reload().finally(() => host.busy(null));
  }
  // Each chat is told the new list on its next prompt.
  s.told.clear();
  const offered = tree.rows.filter((r, i) => r.tool && chosen.includes(i)).length;
  const all = tree.rows.filter((r) => r.tool).length;
  host.print({
    kind: 'success',
    text: `Saved: ${offered} of ${all} MCP tools are offered to the model from the next prompt.`,
  });
}
