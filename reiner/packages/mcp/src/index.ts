/**
 * @file Public entry point of `@co-reiner/mcp`: the MCP servers of a session and their tools.
 * @see {@link ../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
export type { Connector } from './connect.ts';
export { createMcpHub, type McpHub, type McpHubOptions, type McpServerStatus, type McpTool } from './hub.ts';
export { capped, MAX_OUTPUT, toAnswer } from './result.ts';
