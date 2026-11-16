/**
 * @file Tests for external tool calls: reading them out of a reply by the names the host offers, the `mcp`
 * config block, and answering them with and without the host's hook.
 * @see {@link ../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigSchema,
  extractToolCalls,
  hasToolCalls,
  loadConfig,
  runSearchTools,
  setConfigValue,
} from '../src/index.ts';

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

  it('count as calls to answer, also in a block whose tag the page relabelled', () => {
    const md =
      '```typescript\n{"name":"reiner__describe_tool","arguments":{"name":"figma__get_screenshot"}}\n```';
    const parsed = extractToolCalls(md, ['reiner__describe_tool']);
    expect(parsed.external?.[0]?.tool).toBe('reiner__describe_tool');
    expect(hasToolCalls(parsed)).toBe(true);
    expect(hasToolCalls(extractToolCalls('just an answer', ['reiner__describe_tool']))).toBe(false);
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

describe('plugin config', () => {
  it('keeps keys core does not know, for the plugins that read them', () => {
    const config = ConfigSchema.parse({ mcp: { servers: { figma: { url: 'http://x/mcp' } } } });
    expect(config.mcp).toEqual({ servers: { figma: { url: 'http://x/mcp' } } });
  });

  it('saves a value into a config file, keeping its comments', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'reiner-config-'));
    const file = path.join(dir, 'config.jsonc');
    await writeFile(file, '{\n  // mine\n  "mcp": { "servers": {} }\n}\n');
    await setConfigValue(file, ['mcp', 'toolDetail'], 'arguments');
    const text = await readFile(file, 'utf8');
    expect(text).toContain('// mine');
    const config = await loadConfig(file, path.join(dir, 'none.jsonc'));
    expect(config.mcp).toEqual({ servers: {}, toolDetail: 'arguments' });
    await rm(dir, { recursive: true, force: true });
  });
});
