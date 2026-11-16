/**
 * @file Reaching an MCP server: streamable HTTP for a `url`, a child process over stdio for a `command`.
 * @see {@link ../../../docs/architecture/project-config.md#mcp-servers | Project configuration: MCP servers}
 */

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from './config.ts';

/** A way to reach a server; tests pass one that connects to a server in memory. */
export type Connector = (name: string, server: McpServerConfig, root: string) => Promise<Transport>;

/** The most of a server process's error output kept, to explain a failed start. */
const STDERR_TAIL = 2000;

/** The end of each started process's error output, by server name. */
const stderrTails = new Map<string, string>();

/** What a server process last wrote to its error output, if it was started over stdio. */
export const stderrTail = (name: string): string => stderrTails.get(name)?.trim() ?? '';

/**
 * The transport for a configured server. A process's error output is kept (the end of it), never shown
 * as it comes: it would break the TUI.
 */
export const defaultConnector: Connector = async (name, server, root) => {
  if (server.transport === 'http') return new StreamableHTTPClientTransport(new URL(server.url));
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    ...(server.env ? { env: server.env } : {}),
    cwd: server.cwd ?? root,
    stderr: 'pipe',
  });
  stderrTails.set(name, '');
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderrTails.set(name, ((stderrTails.get(name) ?? '') + chunk.toString()).slice(-STDERR_TAIL));
  });
  return transport;
};
