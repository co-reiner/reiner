/**
 * @file MCP tools in the TUI: the line that tells a chat which ones it may call, the y/N before a call, and
 * the call itself.
 * @see {@link ../../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 * @see {@link ../../../../docs/architecture/project-config.md#mcp-servers | Project configuration: MCP servers}
 */
import type { ToolAnswer } from '@co-reiner/core';
import type { McpHub, McpTool } from '@co-reiner/mcp';
import type { ChecksApi } from './checks.ts';

/** The longest tool list sent with argument names; past it the line names the tools only. */
const HINT_BUDGET = 1500;

const harnessName = (api: ChecksApi) => api.session.harness?.displayName ?? 'The model';

/** A tool as the model sees it in the line: its name and arguments, optional ones marked `?`. */
const signature = (t: McpTool) =>
  `${t.name}(${t.args.map((a) => (t.required.includes(a) ? a : `${a}?`)).join(', ')})`;

/**
 * Start the servers (the first time), and say once which ones failed. Returns the hub, or undefined when no
 * server is configured.
 */
export async function mcpTools(api: ChecksApi): Promise<McpHub | undefined> {
  const first = !api.session.mcp.started();
  if (first && Object.keys(api.session.config.mcp.servers).length === 0) return undefined;
  if (first) api.busy('Connecting the MCP servers…');
  const hub = await api.session.mcp.hub();
  if (first) {
    for (const s of hub.status().filter((x) => x.state === 'failed'))
      api.print({
        kind: 'warning',
        text: `MCP server ${s.server} did not start: ${s.error ?? 'unknown error'}`,
      });
  }
  return hub.names().length ? hub : undefined;
}

/**
 * A line that tells the model which MCP tools it may call, added to a prompt once per chat, as the task
 * line is. Names and argument names only: the servers' descriptions are long, and untrusted text.
 */
export async function mcpHint(api: ChecksApi, chatId: string | undefined): Promise<string> {
  if (chatId && api.checks.mcpTold.has(chatId)) return '';
  const hub = await mcpTools(api);
  const tools = hub?.tools() ?? [];
  const first = tools[0];
  if (!first) return '';
  const full = tools.map(signature).join(', ');
  const list = full.length <= HINT_BUDGET ? full : tools.map((t) => t.name).join(', ');
  return `\n\nMore tools you can call the same way (optional arguments end in ?): ${list}. For example {"name":"${first.name}","arguments":{}}.`;
}

/** Remember that this chat has been told about the MCP tools. */
export function mcpHintSent(api: ChecksApi, chatId: string | undefined): void {
  if (chatId) api.checks.mcpTold.add(chatId);
}

/** The arguments as shown in a question: short. */
const shown = (args: Record<string, unknown>) => {
  const json = JSON.stringify(args);
  return json === '{}' ? '' : ` with ${json.length > 200 ? `${json.slice(0, 200)}…` : json}`;
};

/**
 * Should the user be asked first? A tool the server does not mark read-only, every time. A read-only one
 * the first time this session, unless the config's `allow` names it.
 */
const mustAsk = (api: ChecksApi, tool: McpTool) =>
  !tool.readOnly || !(tool.allowed || api.checks.mcpApproved.has(tool.name));

/** The model called an MCP tool: ask when needed, call it, and return what to tell the model. */
export async function callToolForModel(
  api: ChecksApi,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolAnswer> {
  const who = harnessName(api);
  const hub = await api.session.mcp.hub();
  const tool = hub.tool(name);
  if (!tool) return hub.call(name, args);
  if (mustAsk(api, tool)) {
    api.busy(null);
    const writes = tool.readOnly ? '' : ' It may change things on that server.';
    const yes = await api.confirm(
      `${who} asks to call ${tool.tool} on the MCP server ${tool.server}${shown(args)}.${writes} Allow?`,
    );
    if (!yes) {
      return {
        lines: ['the user declined to run it. Continue without it, or ask the user.'],
        summary: `${who} asked to call ${name}. Not run.`,
      };
    }
    if (tool.readOnly) api.checks.mcpApproved.add(tool.name);
  }
  api.busy(`Calling ${tool.tool} on ${tool.server}…`);
  const answer = await hub.call(name, args);
  return { ...answer, summary: `${who} called ${answer.summary}` };
}
