/**
 * @file What the model sees of the MCP tools: the line that tells a chat which ones it may call, looking one up
 * (`reiner__describe_tool`), the y/N before a call, and the call itself.
 * @see {@link ../../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 * @see {@link ../../../../docs/architecture/project-config.md#mcp-servers | Project configuration: MCP servers}
 */
import type { PluginHost, ToolAnswer } from '@co-reiner/core';
import type { McpConfig } from '../config.ts';
import type { McpHub, McpTool } from '../hub.ts';
import type { McpSession } from './session.ts';

/** The longest tool list sent with argument names; past it the line names the tools only. */
const HINT_BUDGET = 1500;

/** Reiner's own tool for looking up an MCP tool's arguments and description. */
export const DESCRIBE_TOOL = 'reiner__describe_tool';

/** The longest description passed on: it is the server's text, and untrusted. */
const DESCRIPTION_LIMIT = 2000;

/** A tool as the model sees it in the line: its name and arguments, optional ones marked `?`. */
const signature = (t: McpTool) =>
  `${t.name}(${t.args.map((a) => (t.required.includes(a) ? a : `${a}?`)).join(', ')})`;

/** The tools offered to the model: the servers' tools, less those the config turns off (`/mcp tools`). */
export function offeredTools(config: McpConfig, hub: McpHub | undefined): McpTool[] {
  return (hub?.tools() ?? []).filter((t) => !config.servers[t.server]?.off.includes(t.tool));
}

/**
 * A line that tells the model which MCP tools it may call, added to a prompt once per chat. Names (and
 * argument names, when the config asks): the servers' descriptions are long, and untrusted text.
 */
export async function promptLine(
  s: McpSession,
  chatId: string | undefined,
  host: PluginHost,
): Promise<string> {
  if (chatId && s.told.has(chatId)) return '';
  const config = await s.config();
  const tools = offeredTools(config, await s.hub(host));
  const first = tools[0];
  if (!first) return '';
  const names = tools.map((t) => t.name).join(', ');
  const full = tools.map(signature).join(', ');
  const withArgs = config.toolDetail === 'arguments' && full.length <= HINT_BUDGET;
  const list = withArgs ? `${full} (optional arguments end in ?)` : names;
  return `\n\nMore tools you can call the same way: ${list}. To see what a tool does and its arguments, call {"name":"${DESCRIBE_TOOL}","arguments":{"name":"${first.name}"}}.`;
}

/** The tool names a reply's calls may use: the offered tools, and the lookup tool when there are any. */
export async function toolNames(s: McpSession, host: PluginHost): Promise<string[]> {
  const names = offeredTools(await s.config(), await s.hub(host)).map((t) => t.name);
  return names.length ? [...names, DESCRIBE_TOOL] : [];
}

/** One argument as the model reads it: name, whether required, type, allowed values, description. */
function argumentLine(tool: McpTool, name: string): string {
  const p = (tool.properties[name] ?? {}) as { type?: unknown; description?: unknown; enum?: unknown };
  const type = typeof p.type === 'string' ? `: ${p.type}` : '';
  const values = Array.isArray(p.enum) ? ` (one of ${p.enum.map((v) => JSON.stringify(v)).join(', ')})` : '';
  const about = typeof p.description === 'string' ? `. ${p.description.slice(0, 300)}` : '';
  return `- ${name}${tool.required.includes(name) ? ' (required)' : ''}${type}${values}${about}`;
}

/** Answer `reiner__describe_tool`: what a tool does and its arguments, as its server describes them. */
function describeTool(tools: McpTool[], args: Record<string, unknown>, who: string): ToolAnswer {
  const name = typeof args.name === 'string' ? args.name : '';
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return {
      lines: [`There is no tool named "${name}". Available: ${tools.map((t) => t.name).join(', ')}.`],
      summary: `${who} looked up "${name}", which is not a tool here.`,
    };
  }
  const about = tool.description.slice(0, DESCRIPTION_LIMIT) || '(no description)';
  const lines = [`${tool.name}: ${about}`, tool.args.length ? 'Arguments:' : 'No arguments.'];
  lines.push(...tool.args.map((a) => argumentLine(tool, a)));
  return { lines, summary: `${who} looked up ${tool.name}.` };
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
const mustAsk = (s: McpSession, tool: McpTool) =>
  !tool.readOnly || !(tool.allowed || s.approved.has(tool.name));

const notAvailable = (name: string, who: string): ToolAnswer => ({
  lines: [`${name} is not available.`],
  summary: `${who} asked for ${name}, which is not available.`,
});

/** The model called an MCP tool: ask when needed, call it, and return what to tell the model. */
export async function callTool(
  s: McpSession,
  name: string,
  args: Record<string, unknown>,
  host: PluginHost,
): Promise<ToolAnswer> {
  const who = host.harnessName;
  const hub = await s.hub(host);
  if (!hub) return notAvailable(name, who);
  const offered = offeredTools(await s.config(), hub);
  // Looking a tool up only reads what the server listed: nothing to ask about.
  if (name === DESCRIBE_TOOL) return describeTool(offered, args, who);
  const tool = offered.find((t) => t.name === name);
  // Unknown, or turned off with /mcp tools: never called.
  if (!tool) return notAvailable(name, who);
  if (mustAsk(s, tool)) {
    host.busy(null);
    const writes = tool.readOnly ? '' : ' It may change things on that server.';
    const yes = await host.confirm(
      `${who} asks to call ${tool.tool} on the MCP server ${tool.server}${shown(args)}.${writes} Allow?`,
    );
    if (!yes) {
      return {
        lines: ['the user declined to run it. Continue without it, or ask the user.'],
        summary: `${who} asked to call ${name}. Not run.`,
      };
    }
    if (tool.readOnly) s.approved.add(tool.name);
  }
  host.busy(`Calling ${tool.tool} on ${tool.server}…`);
  const answer = await hub.call(name, args);
  return { ...answer, summary: `${who} called ${answer.summary}` };
}
