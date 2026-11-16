/**
 * @file Tests for the MCP plugin's tools as the model sees them: the prompt line, the lookup tool, turned-off
 * tools, and the y/N before a call.
 * @see {@link ../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
import type { PluginContext, PluginHost, ToolAnswer } from '@co-reiner/core';
import { describe, expect, it } from 'vitest';
import type { McpConfig } from '../src/config.ts';
import type { McpHub, McpTool } from '../src/hub.ts';
import type { McpSession } from '../src/plugin/session.ts';
import { callTool, promptLine, toolNames } from '../src/plugin/tools.ts';

const tool = (name: string, extra: Partial<McpTool> = {}): McpTool => ({
  name: `figma__${name}`,
  server: 'figma',
  tool: name,
  description: 'Reads a node.',
  args: ['nodeId', 'clientLanguages'],
  required: ['nodeId'],
  properties: {
    nodeId: { type: 'string', description: 'The node, as 1:2' },
    clientLanguages: { type: 'string', enum: ['ts', 'js'] },
  },
  readOnly: true,
  allowed: false,
  ...extra,
});

/** A hub with three Figma-like tools that records its calls. */
function fakeHub(calls: string[]): McpHub {
  const tools = [
    tool('get_metadata', { allowed: true }),
    tool('get_screenshot'),
    tool('add_map', { readOnly: false }),
  ];
  return {
    start: async () => [],
    status: () => [{ server: 'figma', state: 'connected', tools: tools.length }],
    tools: () => tools,
    names: () => tools.map((t) => t.name),
    tool: (name) => tools.find((t) => t.name === name),
    call: async (name, args): Promise<ToolAnswer> => {
      calls.push(`${name} ${JSON.stringify(args)}`);
      return { lines: ['done'], summary: `${name}: 4 characters.` };
    },
    close: async () => {},
  };
}

/** The plugin's session over the fake hub, and a host that answers y/N from `answers`. */
function setup(answers: boolean[], toolDetail: 'names' | 'arguments' = 'names', off: string[] = []) {
  const calls: string[] = [];
  const asked: string[] = [];
  const printed: string[] = [];
  const hub = fakeHub(calls);
  const config = { toolDetail, servers: { figma: { enabled: true, off } } } as unknown as McpConfig;
  const s = {
    ctx: {} as PluginContext,
    config: async () => config,
    hub: async () => hub,
    started: () => hub,
    told: new Set<string>(),
    approved: new Set<string>(),
  } as unknown as McpSession;
  const host: PluginHost = {
    harnessName: 'Copilot',
    print: (entry) => printed.push(`${entry.kind}: ${'text' in entry ? entry.text : ''}`),
    busy: () => {},
    confirm: async (question) => {
      asked.push(question);
      return answers.shift() ?? false;
    },
  };
  return { s, host, calls, asked, printed };
}

describe('MCP tools offered to the model', () => {
  it('tells a chat once which tools it may call, by name, and how to look one up', async () => {
    const { s, host } = setup([]);
    const line = await promptLine(s, 'chat1', host);
    expect(line).toContain('figma__get_metadata, figma__get_screenshot, figma__add_map.');
    expect(line).toContain('{"name":"reiner__describe_tool","arguments":{"name":"figma__get_metadata"}}');
    s.told.add('chat1');
    expect(await promptLine(s, 'chat1', host)).toBe('');
    expect(await promptLine(s, 'chat2', host)).not.toBe('');
    expect(await toolNames(s, host)).toContain('reiner__describe_tool');
  });

  it('leaves out the tools turned off with /mcp tools, and never calls them', async () => {
    const { s, host, calls } = setup([], 'names', ['get_screenshot']);
    const line = await promptLine(s, 'c', host);
    expect(line).toContain('figma__get_metadata, figma__add_map.');
    expect(await toolNames(s, host)).not.toContain('figma__get_screenshot');
    const answer = await callTool(s, 'figma__get_screenshot', {}, host);
    expect(answer.lines).toEqual(['figma__get_screenshot is not available.']);
    expect(calls).toEqual([]);
  });

  it('names the arguments too when the config asks for them', async () => {
    const { s, host } = setup([], 'arguments');
    expect(await promptLine(s, 'c', host)).toContain('figma__get_metadata(nodeId, clientLanguages?)');
  });

  it('describes a tool without asking: what it does and its arguments', async () => {
    const { s, host, asked, calls } = setup([]);
    const answer = await callTool(s, 'reiner__describe_tool', { name: 'figma__add_map' }, host);
    expect(answer.lines).toEqual([
      'figma__add_map: Reads a node.',
      'Arguments:',
      '- nodeId (required): string. The node, as 1:2',
      '- clientLanguages: string (one of "ts", "js")',
    ]);
    expect(asked).toEqual([]);
    expect(calls).toEqual([]);
    const missing = await callTool(s, 'reiner__describe_tool', { name: 'nope' }, host);
    expect(missing.lines[0]).toMatch(/^There is no tool named "nope"\. Available: figma__get_metadata/);
  });

  it('runs an allowed read-only tool without asking', async () => {
    const { s, host, calls, asked } = setup([]);
    const answer = await callTool(s, 'figma__get_metadata', { nodeId: '1:2' }, host);
    expect(asked).toEqual([]);
    expect(calls).toEqual(['figma__get_metadata {"nodeId":"1:2"}']);
    expect(answer.summary).toBe('Copilot called figma__get_metadata: 4 characters.');
  });

  it('asks once a session for a read-only tool, and every time for one that may change things', async () => {
    const { s, host, calls, asked } = setup([true, true, false]);
    await callTool(s, 'figma__get_screenshot', {}, host);
    await callTool(s, 'figma__get_screenshot', {}, host);
    expect(asked).toEqual(['Copilot asks to call get_screenshot on the MCP server figma. Allow?']);
    await callTool(s, 'figma__add_map', { nodeId: '1' }, host);
    const declined = await callTool(s, 'figma__add_map', { nodeId: '1' }, host);
    expect(asked.slice(1)).toEqual([
      'Copilot asks to call add_map on the MCP server figma with {"nodeId":"1"}. It may change things on that server. Allow?',
      'Copilot asks to call add_map on the MCP server figma with {"nodeId":"1"}. It may change things on that server. Allow?',
    ]);
    expect(declined.lines[0]).toMatch(/^the user declined/);
    expect(calls).toHaveLength(3);
  });
});
