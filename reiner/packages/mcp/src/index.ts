/**
 * @file Public entry point of `@co-reiner/mcp`: the MCP plugin, and the client parts it is made of.
 * @see {@link ../../../docs/architecture/plugins.md | Plugins}
 * @see {@link ../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
export * from './config.ts';
export type { Connector } from './connect.ts';
export { createMcpHub, type McpHub, type McpHubOptions, type McpServerStatus, type McpTool } from './hub.ts';
export { mcpPlugin, startMcpSession } from './plugin/plugin.ts';
export type { McpSession, McpSessionOptions } from './plugin/session.ts';
export { DESCRIBE_TOOL } from './plugin/tools.ts';
export { capped, MAX_OUTPUT, toAnswer } from './result.ts';
