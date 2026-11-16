/**
 * @file Tests for `/mcp tools`: the tree of servers and tools, and saving what is offered to the model.
 * @see {@link ../../../docs/architecture/project-config.md#mcp-servers | Project configuration: MCP servers}
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PickOption, PluginCommandHost, PluginContext } from '@co-reiner/core';
import { afterEach, describe, expect, it } from 'vitest';
import { mcpConfig } from '../src/config.ts';
import type { McpHub, McpTool } from '../src/hub.ts';
import type { McpSession } from '../src/plugin/session.ts';
import { toolsTree } from '../src/plugin/tree.ts';

const tool = (server: string, name: string): McpTool => ({
  name: `${server}__${name}`,
  server,
  tool: name,
  description: '',
  args: [],
  required: [],
  properties: {},
  readOnly: true,
  allowed: false,
});

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A project with figma (two tools) and docs (one tool), answering the tree with `answer`. */
async function setup(answer: number[] | undefined) {
  dir = await mkdtemp(path.join(os.tmpdir(), 'reiner-mcp-tree-'));
  const configFile = path.join(dir, 'config.jsonc');
  const servers = { figma: { url: 'http://x/figma' }, docs: { url: 'http://x/docs' } };
  await writeFile(configFile, JSON.stringify({ mcp: { servers } }, null, 2));
  const read = async () => mcpConfig(JSON.parse(await readFile(configFile, 'utf8')));
  const tools = [tool('figma', 'get_metadata'), tool('figma', 'get_screenshot'), tool('docs', 'search')];
  const hub = {
    tools: () => tools,
    status: () => [
      { server: 'figma', state: 'connected', tools: 2 },
      { server: 'docs', state: 'connected', tools: 1 },
    ],
  } as unknown as McpHub;
  const reloads: string[] = [];
  const s = {
    ctx: { configFile } as PluginContext,
    config: read,
    hub: async () => hub,
    reload: async () => void reloads.push('reload'),
    told: new Set(['chat1']),
    approved: new Set<string>(),
  } as unknown as McpSession;
  const printed: string[] = [];
  const offered: { options: PickOption[]; ticked: number[] }[] = [];
  const host: PluginCommandHost = {
    harnessName: 'Copilot',
    busy: () => {},
    confirm: async () => false,
    print: (e) => printed.push('text' in e ? e.text : ''),
    choose: async (_q, options, ticked) => {
      offered.push({ options, ticked });
      return answer;
    },
  };
  return { s, host, read, reloads, printed, offered, configFile };
}

describe('/mcp tools', () => {
  it('shows every server and tool ticked at first', async () => {
    const { s, host, offered } = await setup(undefined);
    await toolsTree(s, host);
    expect(offered[0]?.options.map((o) => `${o.indent ? '  ' : ''}${o.label}`)).toEqual([
      'figma',
      '  get_metadata',
      '  get_screenshot',
      'docs',
      '  search',
    ]);
    expect(offered[0]?.ticked).toEqual([0, 1, 2, 3, 4]);
  });

  it('saves an unticked tool as off, and an unticked server as turned off', async () => {
    const { s, host, read, reloads, printed } = await setup([0, 1]);
    await toolsTree(s, host);
    const saved = (await read()).servers;
    expect(saved.figma).toMatchObject({ enabled: true, off: ['get_screenshot'] });
    expect(saved.docs).toMatchObject({ enabled: false, off: [] });
    expect(reloads).toEqual(['reload']);
    expect(s.told.size).toBe(0);
    expect(printed.at(-1)).toBe('Saved: 1 of 3 MCP tools are offered to the model from the next prompt.');
  });

  it('changes nothing on Esc', async () => {
    const { s, host, read, reloads, printed } = await setup(undefined);
    await toolsTree(s, host);
    expect((await read()).servers.figma).toMatchObject({ enabled: true, off: [] });
    expect(reloads).toEqual([]);
    expect(printed).toEqual(['Nothing changed.']);
  });
});
