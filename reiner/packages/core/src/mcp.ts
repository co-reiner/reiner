/**
 * @file The `mcp` block of the config: the MCP servers whose tools the model may call.
 * @see {@link ../../../docs/architecture/project-config.md#mcp-servers | Project configuration: MCP servers}
 * @see {@link ../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
import { z } from 'zod';

/**
 * A server's name. It is the first part of its tools' names as the model sees them (`figma__get_metadata`),
 * so it has no underscores: the first `__` always ends it.
 */
export const MCP_SERVER_NAME = /^[a-z0-9][a-z0-9-]{0,23}$/i;

/** What every server has, however Reiner reaches it. */
const common = {
  /** Off: the server is not started and its tools are not offered. */
  enabled: z.boolean().default(true),
  /** Tools of this server (their own names, `get_metadata`) that run without a y/N. */
  allow: z.array(z.string().min(1)).default([]),
  /** How long one call may take. */
  timeoutSeconds: z.number().positive().max(600).default(120),
};

/** A server Reiner reaches over HTTP (MCP's streamable HTTP transport), such as Figma's desktop server. */
const HttpServer = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  ...common,
});

/** A server Reiner starts as a process and talks to over its stdin and stdout. */
const StdioServer = z.strictObject({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  /** Added to a small default environment (PATH, HOME and the like), not to all of Reiner's. */
  env: z.record(z.string(), z.string()).optional(),
  /** Where the process starts: the project root when left out. */
  cwd: z.string().optional(),
  ...common,
});

export const McpServerSchema = z
  .union([HttpServer, StdioServer])
  .transform((s) =>
    'url' in s ? { transport: 'http' as const, ...s } : { transport: 'stdio' as const, ...s },
  );

export type McpServerConfig = z.infer<typeof McpServerSchema>;

export const McpSchema = z.object({
  servers: z
    .record(
      z.string().regex(MCP_SERVER_NAME, 'a server name is letters, digits and "-", at most 24'),
      McpServerSchema,
    )
    .default({}),
});

export type McpConfig = z.infer<typeof McpSchema>;
