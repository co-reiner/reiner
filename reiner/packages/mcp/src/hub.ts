/**
 * @file The MCP servers of a session: starting them, the tools they offer under Reiner's names, calling
 * one, and closing them.
 * @see {@link ../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 * @see {@link ../../../docs/architecture/project-config.md#mcp-servers | Project configuration: MCP servers}
 */
import type { ToolAnswer } from '@co-reiner/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServerConfig } from './config.ts';
import { type Connector, defaultConnector, stderrTail } from './connect.ts';
import { type RawResult, toAnswer } from './result.ts';

/** A tool a server offers, as Reiner offers it to the model. */
export interface McpTool {
  /** `<server>__<tool>`: the name the model calls. */
  name: string;
  server: string;
  /** The tool's own name on its server. */
  tool: string;
  description: string;
  /** Its argument names, and which of them are required. */
  args: string[];
  required: string[];
  /** Each argument's schema as the server gives it (type, description, allowed values), for describing. */
  properties: Record<string, unknown>;
  /** The server marks it as only reading (`readOnlyHint`). */
  readOnly: boolean;
  /** The config's `allow` list names it: it runs without a y/N. */
  allowed: boolean;
}

export interface McpServerStatus {
  server: string;
  state: 'connected' | 'failed' | 'disabled';
  tools: number;
  error?: string;
}

export interface McpHubOptions {
  /** The project root: a stdio server starts there unless its config says otherwise. */
  root: string;
  /** Reiner's version, sent to each server when connecting. */
  version: string;
  /** Where images a tool returns are saved to go with the answer. */
  imageDir?: string;
  connect?: Connector;
}

export interface McpHub {
  /** Connect every enabled server and list its tools. A server that fails is reported, not thrown. */
  start(): Promise<McpServerStatus[]>;
  status(): McpServerStatus[];
  tools(): McpTool[];
  /** The tool names the model may call, for `extractToolCalls`. */
  names(): string[];
  tool(name: string): McpTool | undefined;
  /** Call a tool by its Reiner name and return what to tell the model. Never throws. */
  call(name: string, args: Record<string, unknown>): Promise<ToolAnswer>;
  close(): Promise<void>;
}

interface Live {
  client: Client;
  config: McpServerConfig;
  tools: McpTool[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A tool as the server lists it, under Reiner's name. */
function asTool(server: string, config: McpServerConfig, t: Record<string, unknown>): McpTool {
  const schema = (t.inputSchema ?? {}) as { properties?: Record<string, unknown>; required?: unknown };
  const annotations = (t.annotations ?? {}) as { readOnlyHint?: unknown };
  const tool = String(t.name);
  return {
    name: `${server}__${tool}`,
    server,
    tool,
    description: typeof t.description === 'string' ? t.description : '',
    args: Object.keys(schema.properties ?? {}),
    required: Array.isArray(schema.required) ? schema.required.map(String) : [],
    properties: schema.properties ?? {},
    readOnly: annotations.readOnlyHint === true,
    allowed: config.allow.includes(tool),
  };
}

/** Connect one server and list its tools, page by page. */
async function startOne(name: string, config: McpServerConfig, opts: McpHubOptions): Promise<Live> {
  const transport = await (opts.connect ?? defaultConnector)(name, config, opts.root);
  const client = new Client({ name: 'reiner', version: opts.version });
  const timeout = config.timeoutSeconds * 1000;
  await client.connect(transport, { timeout });
  const listed: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : {}, { timeout });
    listed.push(...(page.tools as Record<string, unknown>[]));
    cursor = page.nextCursor;
  } while (cursor);
  return { client, config, tools: listed.map((t) => asTool(name, config, t)) };
}

export function createMcpHub(servers: Record<string, McpServerConfig>, opts: McpHubOptions): McpHub {
  const live = new Map<string, Live>();
  let statuses: McpServerStatus[] = [];
  const all = () => [...live.values()].flatMap((l) => l.tools);
  return {
    async start() {
      statuses = await Promise.all(
        Object.entries(servers).map(async ([server, config]): Promise<McpServerStatus> => {
          if (!config.enabled) return { server, state: 'disabled', tools: 0 };
          try {
            const started = await startOne(server, config, opts);
            live.set(server, started);
            return { server, state: 'connected', tools: started.tools.length };
          } catch (e) {
            const tail = stderrTail(server);
            return { server, state: 'failed', tools: 0, error: tail ? `${message(e)}: ${tail}` : message(e) };
          }
        }),
      );
      return statuses;
    },
    status: () => statuses,
    tools: all,
    names: () => all().map((t) => t.name),
    tool: (name) => all().find((t) => t.name === name),
    async call(name, args) {
      const tool = all().find((t) => t.name === name);
      const server = tool && live.get(tool.server);
      if (!tool || !server)
        return { lines: [`${name} is not available.`], summary: `${name}: not available.` };
      // Reiner's own tools take a `reason`; a model may add one here too. Pass it on only if the tool has one.
      const { reason: _reason, ...rest } = args;
      const given = tool.args.includes('reason') ? args : rest;
      try {
        const result = await server.client.callTool({ name: tool.tool, arguments: given }, undefined, {
          timeout: server.config.timeoutSeconds * 1000,
        });
        return await toAnswer(result as RawResult, {
          name,
          ...(opts.imageDir ? { imageDir: opts.imageDir } : {}),
        });
      } catch (e) {
        return { lines: [`not run: ${message(e)}`], summary: `${name}: failed: ${message(e)}` };
      }
    },
    async close() {
      await Promise.all([...live.values()].map((l) => l.client.close().catch(() => {})));
      live.clear();
    },
  };
}
