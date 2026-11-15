/**
 * @file Tests for MCP tools in the TUI (the prompt line, the y/N, the call) and for sending a message in
 * parts when it has more files than the harness takes.
 * @see {@link ../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 * @see {@link ../../../docs/architecture/tool-protocol.md#messages-in-parts | Tool protocol: messages in parts}
 */
import type { ChatReply, HarnessModule, PreparedPrompt, SendOptions, ToolAnswer } from '@co-reiner/core';
import type { McpHub, McpTool } from '@co-reiner/mcp';
import { describe, expect, it } from 'vitest';
import { type ChecksApi, newChecksState } from '../src/tui/checks.ts';
import { callToolForModel, mcpHint, mcpHintSent } from '../src/tui/mcp-tools.ts';
import { type SendDeps, sendRound } from '../src/tui/send.ts';

const tool = (name: string, extra: Partial<McpTool> = {}): McpTool => ({
  name: `figma__${name}`,
  server: 'figma',
  tool: name,
  description: '',
  args: ['nodeId', 'clientLanguages'],
  required: ['nodeId'],
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

function setup(answers: boolean[]) {
  const calls: string[] = [];
  const asked: string[] = [];
  const printed: string[] = [];
  const hub = fakeHub(calls);
  const api = {
    session: {
      harness: { displayName: 'Copilot' },
      config: { mcp: { servers: { figma: {} } } },
      mcp: { hub: async () => hub, started: () => hub },
      transcript: { append: async () => {} },
    },
    checks: newChecksState(),
    print: (entry: { kind: string; text?: string }) => printed.push(`${entry.kind}: ${entry.text ?? ''}`),
    busy: () => {},
    confirm: async (question: string) => {
      asked.push(question);
      return answers.shift() ?? false;
    },
  } as unknown as ChecksApi;
  return { api, calls, asked, printed };
}

describe('MCP tools in the TUI', () => {
  it('tells a chat once which tools it may call, with their arguments', async () => {
    const { api } = setup([]);
    const line = await mcpHint(api, 'chat1');
    expect(line).toContain('figma__get_metadata(nodeId, clientLanguages?)');
    expect(line).toContain('{"name":"figma__get_metadata","arguments":{}}');
    mcpHintSent(api, 'chat1');
    expect(await mcpHint(api, 'chat1')).toBe('');
    expect(await mcpHint(api, 'chat2')).not.toBe('');
  });

  it('runs an allowed read-only tool without asking', async () => {
    const { api, calls, asked } = setup([]);
    const answer = await callToolForModel(api, 'figma__get_metadata', { nodeId: '1:2' });
    expect(asked).toEqual([]);
    expect(calls).toEqual(['figma__get_metadata {"nodeId":"1:2"}']);
    expect(answer.summary).toBe('Copilot called figma__get_metadata: 4 characters.');
  });

  it('asks once a session for a read-only tool, and every time for one that may change things', async () => {
    const { api, calls, asked } = setup([true, true, false]);
    await callToolForModel(api, 'figma__get_screenshot', {});
    await callToolForModel(api, 'figma__get_screenshot', {});
    expect(asked).toEqual(['Copilot asks to call get_screenshot on the MCP server figma. Allow?']);
    await callToolForModel(api, 'figma__add_map', { nodeId: '1' });
    const declined = await callToolForModel(api, 'figma__add_map', { nodeId: '1' });
    expect(asked.slice(1)).toEqual([
      'Copilot asks to call add_map on the MCP server figma with {"nodeId":"1"}. It may change things on that server. Allow?',
      'Copilot asks to call add_map on the MCP server figma with {"nodeId":"1"}. It may change things on that server. Allow?',
    ]);
    expect(declined.lines[0]).toMatch(/^the user declined/);
    expect(calls).toHaveLength(3);
  });
});

/** A harness that takes three files a message and records what it was sent. */
function partsSetup(stopAt?: number) {
  const sent: { prompt: string; files: string[] }[] = [];
  const recorded: PreparedPrompt[] = [];
  const printed: string[] = [];
  const module = {
    id: 'fake',
    displayName: 'Copilot',
    maxAttachments: 3,
    send: async (prompt: string, opts: SendOptions = {}): Promise<ChatReply> => {
      sent.push({ prompt, files: opts.attachments ?? [] });
      return { markdown: 'waiting', stopped: sent.length === stopAt, elapsedMs: 1 };
    },
    currentChat: async () => ({ id: 'c1', title: 'chat' }),
    exchange: { afterSend: async (_id: string, prepared: PreparedPrompt) => void recorded.push(prepared) },
  } as unknown as HarnessModule;
  const d = {
    api: {
      print: (e: { kind: string; text?: string }) => printed.push(`${e.kind}: ${e.text ?? ''}`),
      session: { transcript: { append: async () => {} } },
    },
    setBusy: () => {},
    setStreaming: () => {},
    trackChat: () => {},
  } as unknown as SendDeps;
  const message = { prompt: 'answer', attachments: ['1.png', '2.png', '3.png', '4.png', '5.png'] };
  return { module, d, message, sent, recorded, printed };
}

describe('sending in parts', () => {
  it('sends more files than the harness takes in parts, and records the message once', async () => {
    const { module, d, message, sent, recorded, printed } = partsSetup();
    const { chatId } = await sendRound(d, module, message, '');
    expect(sent.map((s) => s.files)).toEqual([
      ['1.png', '2.png', '3.png'],
      ['4.png', '5.png'],
    ]);
    expect(sent[0]?.prompt).toMatch(/^This answer is too large for one message, so it comes in 2 parts\./);
    expect(sent[1]?.prompt).toBe('Part 2 of 2, the last.\n\nanswer');
    expect(printed[0]).toBe('info: 5 files are more than Copilot takes at once: sending in 2 parts.');
    expect(recorded).toEqual([message]);
    expect(chatId).toBe('c1');
  });

  it('stops after a stopped part, and does not record the message as sent', async () => {
    const { module, d, message, sent, recorded, printed } = partsSetup(1);
    const { reply } = await sendRound(d, module, message, '');
    expect(sent).toHaveLength(1);
    expect(reply.stopped).toBe(true);
    expect(recorded).toEqual([]);
    expect(printed).toContain('info: Stopped after part 1 of 2; the rest was not sent.');
  });
});
