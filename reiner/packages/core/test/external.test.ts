/**
 * @file Tests for external tool calls: reading them out of a reply by the names the host offers, the `mcp`
 * config block, and answering them with and without the host's hook.
 * @see {@link ../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
import { describe, expect, it } from 'vitest';
import { ConfigSchema, extractToolCalls, runSearchTools } from '../src/index.ts';

const call = (name: string, args: unknown, id?: string) =>
  `\`\`\`reiner-tool\n${JSON.stringify({ ...(id ? { call_id: id } : {}), name, arguments: args })}\n\`\`\``;

describe('external tool calls', () => {
  it('are read only under the names the host offers', () => {
    const md = call('figma__get_metadata', { nodeId: '1:2', tool: 'kept' }, 'c9');
    expect(extractToolCalls(md, ['figma__get_metadata'])).toEqual({
      calls: [],
      external: [{ tool: 'figma__get_metadata', arguments: { nodeId: '1:2', tool: 'kept' }, callId: 'c9' }],
      errors: [],
    });
    const unknown = extractToolCalls(md);
    expect(unknown.external).toBeUndefined();
    expect(unknown.errors[0]).toMatch(/^unknown tool "figma__get_metadata"/);
  });

  it('never take the place of a Reiner tool', () => {
    const parsed = extractToolCalls(call('grep', { pattern: 'x' }), ['grep']);
    expect(parsed.calls).toHaveLength(1);
    expect(parsed.external).toBeUndefined();
  });

  it('refuse arguments that are too long', () => {
    const parsed = extractToolCalls(call('a__b', { x: 'y'.repeat(20_001) }), ['a__b']);
    expect(parsed.errors[0]).toMatch(/arguments are too long/);
  });

  it('are answered by the host, with its attachments', async () => {
    const parsed = extractToolCalls(call('a__b', { n: 1 }), ['a__b']);
    const opts = { root: '.', who: 'Copilot', settings: async () => ({}) };
    const without = await runSearchTools(parsed, opts);
    expect(without.prepared.prompt).toContain('a__b is not available here.');
    const done = await runSearchTools(parsed, {
      ...opts,
      callExternal: async (name, args) => ({
        lines: [`${name} got ${JSON.stringify(args)}`],
        summary: 'ran',
        attachments: ['shot.png'],
      }),
    });
    expect(done.prepared.prompt).toContain('"output":"a__b got {\\"n\\":1}"');
    expect(done.prepared.attachments).toEqual(['shot.png']);
    expect(done.summary).toEqual(['ran']);
  });
});

describe('mcp config', () => {
  it('reads http and stdio servers', () => {
    const config = ConfigSchema.parse({
      mcp: {
        servers: {
          figma: { url: 'http://127.0.0.1:3845/mcp', allow: ['get_metadata'] },
          local: { command: 'node', args: ['server.js'] },
        },
      },
    });
    expect(config.mcp.servers.figma).toMatchObject({ transport: 'http', enabled: true, timeoutSeconds: 120 });
    expect(config.mcp.servers.local).toMatchObject({ transport: 'stdio', args: ['server.js'], allow: [] });
    expect(ConfigSchema.parse({}).mcp).toEqual({ servers: {} });
  });

  it('refuses a server name with underscores, and a server with both a url and a command', () => {
    expect(() => ConfigSchema.parse({ mcp: { servers: { my_figma: { url: 'http://x/mcp' } } } })).toThrow();
    expect(() =>
      ConfigSchema.parse({ mcp: { servers: { x: { url: 'http://x/mcp', command: 'node' } } } }),
    ).toThrow();
    expect(() => ConfigSchema.parse({ mcp: { servers: { x: { url: 'file:///x' } } } })).toThrow();
  });
});
