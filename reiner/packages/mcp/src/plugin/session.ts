/**
 * @file The MCP plugin's state for one session: the servers (started when first needed, from the config read
 * fresh), the chats told about the tools, and the read-only tools the user agreed to.
 * @see {@link ../../../../docs/architecture/plugins.md | Plugins}
 * @see {@link ../../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
import path from 'node:path';
import type { PluginContext, PluginHost, PluginSession } from '@co-reiner/core';
import { type McpConfig, mcpConfig } from '../config.ts';
import type { Connector } from '../connect.ts';
import { createMcpHub, type McpHub } from '../hub.ts';

export interface McpSession extends PluginSession {
  ctx: PluginContext;
  /** The `mcp` block of the config, read fresh. */
  config(): Promise<McpConfig>;
  /** The servers, started the first time (undefined when none is set up); says once which ones failed. */
  hub(host?: PluginHost): Promise<McpHub | undefined>;
  /** The servers if they have been started, without starting them. */
  started(): McpHub | undefined;
  /** Close the servers and start them again from the config as it is now. */
  reload(): Promise<McpHub>;
  /** Chats that have been told which tools exist. */
  told: Set<string>;
  /** Read-only tools the user has agreed to, this session. */
  approved: Set<string>;
}

export interface McpSessionOptions {
  /** Tests pass servers in memory. */
  connect?: Connector;
}

/** The session's servers, with the parts of `PluginSession` that only need them (the rest is added in plugin.ts). */
export function createSessionCore(
  ctx: PluginContext,
  opts: McpSessionOptions = {},
): Pick<McpSession, 'ctx' | 'config' | 'hub' | 'started' | 'reload' | 'told' | 'approved' | 'close'> {
  let starting: Promise<McpHub> | undefined;
  let ready: McpHub | undefined;
  const config = async () => mcpConfig(await ctx.readConfig());
  const start = (host?: PluginHost) => {
    starting = (async () => {
      const hub = createMcpHub((await config()).servers, {
        root: ctx.projectRoot,
        version: ctx.version,
        imageDir: path.join(ctx.reinerDir, 'mcp', 'images'),
        ...(opts.connect ? { connect: opts.connect } : {}),
      });
      host?.busy('Connecting the MCP servers…');
      for (const s of (await hub.start()).filter((x) => x.state === 'failed'))
        host?.print({
          kind: 'warning',
          text: `MCP server ${s.server} did not start: ${s.error ?? 'unknown error'}`,
        });
      ready = hub;
      return hub;
    })();
    // A failed start (a broken config) is tried again next time.
    starting.catch(() => {
      starting = undefined;
    });
    return starting;
  };
  return {
    ctx,
    config,
    told: new Set(),
    approved: new Set(),
    async hub(host) {
      if (!starting && Object.keys((await config()).servers).length === 0) return undefined;
      return starting ?? start(host);
    },
    started: () => ready,
    async reload() {
      const old = await starting?.catch(() => undefined);
      ready = undefined;
      starting = undefined;
      await old?.close();
      return start();
    },
    async close() {
      const hub = await starting?.catch(() => undefined);
      await hub?.close();
    },
  };
}
