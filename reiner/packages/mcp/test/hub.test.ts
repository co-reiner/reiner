/**
 * @file Tests for the MCP hub against servers in memory: listing tools under Reiner's names, calling them,
 * images, errors, and servers that fail or are off.
 * @see {@link ../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpServerSchema } from '@co-reiner/core';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { type Connector, createMcpHub, MAX_OUTPUT, type McpHub } from '../src/index.ts';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');

/** A small server like Figma's: a read-only tool, a writing one, an image, an error and long output. */
function fakeServer(seen: Record<string, unknown>[]): Server {
  const server = new Server({ name: 'fake', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get_metadata',
        description: 'Reads a node',
        inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'add_map',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: false },
      },
      { name: 'get_screenshot', inputSchema: { type: 'object', properties: {} } },
      { name: 'fails', inputSchema: { type: 'object', properties: {} } },
      { name: 'long', inputSchema: { type: 'object', properties: {} } },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    seen.push({ name: req.params.name, ...req.params.arguments });
    switch (req.params.name) {
      case 'get_screenshot':
        return {
          content: [
            { type: 'image', data: PNG, mimeType: 'image/png' },
            { type: 'text', text: 'shot' },
          ],
        };
      case 'fails':
        return { content: [{ type: 'text', text: 'Nothing is selected' }], isError: true };
      case 'long':
        return { content: [{ type: 'text', text: 'x'.repeat(MAX_OUTPUT + 5) }] };
      default:
        return { content: [{ type: 'text', text: `node ${String(req.params.arguments?.nodeId)}` }] };
    }
  });
  return server;
}

const memory =
  (seen: Record<string, unknown>[]): Connector =>
  async () => {
    const [client, server] = InMemoryTransport.createLinkedPair();
    await fakeServer(seen).connect(server);
    return client;
  };

const config = (extra: Record<string, unknown> = {}) =>
  McpServerSchema.parse({ url: 'http://127.0.0.1:3845/mcp', ...extra });

let hub: McpHub | undefined;
let dir: string | undefined;
afterEach(async () => {
  await hub?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  hub = dir = undefined;
});

describe('MCP hub', () => {
  it('lists tools as <server>__<tool>, with read-only and allowed marks', async () => {
    hub = createMcpHub(
      { figma: config({ allow: ['add_map'] }) },
      { root: '.', version: '0', connect: memory([]) },
    );
    expect(await hub.start()).toEqual([{ server: 'figma', state: 'connected', tools: 5 }]);
    expect(hub.names()).toContain('figma__get_metadata');
    expect(hub.tool('figma__get_metadata')).toMatchObject({
      readOnly: true,
      allowed: false,
      required: ['nodeId'],
    });
    expect(hub.tool('figma__add_map')).toMatchObject({ readOnly: false, allowed: true });
  });

  it('calls a tool, and drops a `reason` the tool does not take', async () => {
    const seen: Record<string, unknown>[] = [];
    hub = createMcpHub({ figma: config() }, { root: '.', version: '0', connect: memory(seen) });
    await hub.start();
    const answer = await hub.call('figma__get_metadata', { nodeId: '1:2', reason: 'look' });
    expect(answer.lines).toEqual(['node 1:2']);
    expect(seen).toEqual([{ name: 'get_metadata', nodeId: '1:2' }]);
  });

  it('saves an image to go with the answer', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'reiner-mcp-'));
    hub = createMcpHub({ figma: config() }, { root: '.', version: '0', imageDir: dir, connect: memory([]) });
    await hub.start();
    const answer = await hub.call('figma__get_screenshot', {});
    expect(answer.attachments).toHaveLength(1);
    expect((await readFile(answer.attachments?.[0] ?? '')).toString('base64')).toBe(PNG);
    expect(answer.lines[0]).toMatch(/^image attached: figma__get_screenshot-.*\.png\nshot$/);
  });

  it('says an image was left out when there is nowhere to send it', async () => {
    hub = createMcpHub({ figma: config() }, { root: '.', version: '0', connect: memory([]) });
    await hub.start();
    const answer = await hub.call('figma__get_screenshot', {});
    expect(answer.attachments).toBeUndefined();
    expect(answer.lines[0]).toContain('images cannot be sent here');
  });

  it('passes a tool error on to the model, and caps long output', async () => {
    hub = createMcpHub({ figma: config() }, { root: '.', version: '0', connect: memory([]) });
    await hub.start();
    expect((await hub.call('figma__fails', {})).lines).toEqual(['error: Nothing is selected']);
    const long = (await hub.call('figma__long', {})).lines[0] ?? '';
    expect(long).toMatch(/\[cut: 5 more characters\. Ask for a smaller part\.\]$/);
  });

  it('reports a server that fails or is off, and keeps the others', async () => {
    const failing: Connector = async (name, server, root) => {
      if (name === 'broken') throw new Error('connection refused');
      return memory([])(name, server, root);
    };
    hub = createMcpHub(
      { figma: config(), broken: config(), off: config({ enabled: false }) },
      { root: '.', version: '0', connect: failing },
    );
    expect(await hub.start()).toEqual([
      { server: 'figma', state: 'connected', tools: 5 },
      { server: 'broken', state: 'failed', tools: 0, error: 'connection refused' },
      { server: 'off', state: 'disabled', tools: 0 },
    ]);
    expect((await hub.call('broken__x', {})).lines).toEqual(['broken__x is not available.']);
  });
});
