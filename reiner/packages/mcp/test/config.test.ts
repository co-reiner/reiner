/**
 * @file Tests for the MCP plugin's `mcp` config block: servers over HTTP and stdio, defaults, and what is refused.
 * @see {@link ../../../docs/architecture/project-config.md#mcp-servers | Project configuration: MCP servers}
 */
import { describe, expect, it } from 'vitest';
import { mcpConfig } from '../src/index.ts';

describe('mcp config', () => {
  it('reads http and stdio servers, with defaults', () => {
    const config = mcpConfig({
      mcp: {
        servers: {
          figma: { url: 'http://127.0.0.1:3845/mcp', allow: ['get_metadata'] },
          local: { command: 'node', args: ['server.js'] },
        },
      },
    });
    expect(config.servers.figma).toMatchObject({
      transport: 'http',
      enabled: true,
      timeoutSeconds: 120,
      off: [],
    });
    expect(config.servers.local).toMatchObject({ transport: 'stdio', args: ['server.js'], allow: [] });
    expect(mcpConfig({})).toEqual({ toolDetail: 'names', servers: {} });
  });

  it('refuses a server name with underscores or "reiner", both a url and a command, and a file url', () => {
    expect(() => mcpConfig({ mcp: { servers: { my_figma: { url: 'http://x/mcp' } } } })).toThrow();
    expect(() => mcpConfig({ mcp: { servers: { Reiner: { url: 'http://x/mcp' } } } })).toThrow();
    expect(() => mcpConfig({ mcp: { servers: { x: { url: 'http://x/mcp', command: 'node' } } } })).toThrow();
    expect(() => mcpConfig({ mcp: { servers: { x: { url: 'file:///x' } } } })).toThrow();
  });
});
