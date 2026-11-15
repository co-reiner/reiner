/**
 * @file The session's MCP servers: started once, when first needed, from the config read fresh; restarted
 * by `/mcp reload`; closed when the TUI quits.
 * @see {@link ../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 * @see {@link ../../../docs/architecture/project-config.md#mcp-servers | Project configuration: MCP servers}
 */
import { REINER_VERSION, type ReinerConfig } from '@co-reiner/core';
import { type Connector, createMcpHub, type McpHub } from '@co-reiner/mcp';

export interface McpSession {
  /** The servers, started on the first call (connecting can take a moment). */
  hub(): Promise<McpHub>;
  /** The servers if they have been started, without starting them. */
  started(): McpHub | undefined;
  /** Close the servers and start them again from the config as it is now. */
  reload(): Promise<McpHub>;
  close(): Promise<void>;
}

export interface McpSessionOptions {
  root: string;
  /** Where images the tools return are saved, to go with the answer. */
  imageDir: string;
  /** Tests pass servers in memory. */
  connect?: Connector;
}

export function createMcpSession(load: () => Promise<ReinerConfig>, opts: McpSessionOptions): McpSession {
  let starting: Promise<McpHub> | undefined;
  let ready: McpHub | undefined;
  const start = () => {
    starting = (async () => {
      const hub = createMcpHub((await load()).mcp.servers, {
        root: opts.root,
        version: REINER_VERSION,
        imageDir: opts.imageDir,
        ...(opts.connect ? { connect: opts.connect } : {}),
      });
      await hub.start();
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
    hub: () => starting ?? start(),
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
