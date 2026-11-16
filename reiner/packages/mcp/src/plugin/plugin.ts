/**
 * @file The MCP plugin: tools of the MCP servers a project configures, offered to the model, with `/mcp` and a
 * status badge. A host knows it only through the plugin contract in core.
 * @see {@link ../../../../docs/architecture/plugins.md | Plugins}
 * @see {@link ../../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
import type { PluginContext, ReinerPlugin } from '@co-reiner/core';
import { mcpCommand } from './command.ts';
import { createSessionCore, type McpSession, type McpSessionOptions } from './session.ts';
import { callTool, promptLine, toolNames } from './tools.ts';

/** The servers' state in a few words: how many tools, or that one failed. Nothing before they start. */
function status(s: McpSession): { text: string; warn?: boolean } | undefined {
  const all = s.started()?.status() ?? [];
  if (all.length === 0) return undefined;
  const failed = all.filter((x) => x.state === 'failed').length;
  if (failed) return { text: `MCP: ${failed} failed (/mcp)`, warn: true };
  return { text: `MCP: ${all.reduce((n, x) => n + x.tools, 0)} tools` };
}

/** The plugin's session for a project. */
export function startMcpSession(ctx: PluginContext, opts: McpSessionOptions = {}): McpSession {
  const s: McpSession = {
    ...createSessionCore(ctx, opts),
    toolNames: (host) => toolNames(s, host),
    promptLine: (chatId, host) => promptLine(s, chatId, host),
    promptSent: (chatId) => {
      if (chatId) s.told.add(chatId);
    },
    call: (name, args, host) => callTool(s, name, args, host),
    status: () => status(s),
  };
  return s;
}

/** MCP support as a plugin, for a host to be handed (`@co-reiner/reiner` bundles it). */
export const mcpPlugin: ReinerPlugin = {
  id: 'mcp',
  commands: [mcpCommand],
  start: (ctx) => startMcpSession(ctx),
};
