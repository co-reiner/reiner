/**
 * @file Tests for the Google Search exchange on a temporary git project: what goes with a prompt in each
 * mode, what a reply's requests come to, and that nothing it writes names the product.
 * @see {@link ../docs/file-exchange.md | Google Search file exchange}
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type ChatReply, extractToolCalls } from '@co-reiner/core';
import { describe, expect, it } from 'vitest';
import { briefing } from '../src/exchange/brief.ts';
import { createGsExchange } from '../src/exchange/exchange.ts';

const fence = '```';
const reply = (markdown: string): ChatReply => ({ markdown, stopped: false, elapsedMs: 1 });

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reiner-gs-'));
  execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true });
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  await writeFile(path.join(root, 'src', 'b.js'), 'export const b = `two`;\n');
  await writeFile(path.join(root, '.gitignore'), '.env\n.reiner/\n');
  await writeFile(path.join(root, '.env'), 'SECRET=1\n');
  const stateDir = path.join(root, '.reiner', 'modules', 'google-search');
  const exchange = createGsExchange({
    root,
    stateDir,
    displayName: 'Google AI Mode',
    settings: async () => ({}),
  });
  return { root, exchange };
}

describe('the first prompt', () => {
  it('puts the request first, then the notes with the file list, and only once per conversation', async () => {
    const { exchange } = await setup();
    const first = await exchange.prepare('Rename a to c.', undefined);
    expect(first.prompt.startsWith('Rename a to c.')).toBe(true);
    expect(first.prompt).toContain('Its files: .gitignore, src/a.js, src/b.js.');
    expect(first.prompt).not.toContain('.env');
    await exchange.afterSend('thread-1', first, 'Rename a to c.');
    const second = await exchange.prepare('And b to d.', 'thread-1');
    expect(second.prompt).toBe('And b to d.');
  });

  it('never names the product', async () => {
    const { exchange } = await setup();
    await exchange.queue(['src/*.js']);
    const sent = await exchange.prepare('Look at these.', undefined);
    expect(`${sent.prompt}${briefing(['a.js'])}`).not.toMatch(/reiner/i);
  });
});

describe('sharing files', () => {
  it('quotes queued files in text mode, and takes them off the queue once sent', async () => {
    const { exchange } = await setup();
    const { queued, refused } = await exchange.queue(['src/*.js', '.env']);
    expect(queued).toEqual(['src/a.js', 'src/b.js']);
    expect(refused.map((r) => r.path)).toEqual(['.env']);
    const sent = await exchange.prepare('Look.', 'thread-1');
    expect(sent.attachments).toEqual([]);
    expect(sent.prompt).toContain(`File src/a.js:\n${fence}\nexport const a = 1;\n${fence}`);
    await exchange.afterSend('thread-1', sent, 'Look.');
    expect(exchange.pending()).toEqual([]);
  });

  it('gathers them into one text file in upload mode', async () => {
    const { exchange } = await setup();
    await exchange.setMode('upload');
    await exchange.queue(['src/a.js', 'src/b.js']);
    const sent = await exchange.prepare('Look.', 'thread-1');
    expect(sent.attachments.map((f) => path.basename(f))).toEqual(['project-files-1.txt']);
    expect(sent.prompt).toContain('project-files-1.txt');
    const text = await readFile(sent.attachments[0] as string, 'utf8');
    expect(text).toContain('===== src/a.js =====\nexport const a = 1;\n');
    expect(text).toContain('===== src/b.js =====');
  });
});

describe('what comes back', () => {
  it('reads whole files and a delete list as change sets', async () => {
    const { exchange } = await setup();
    const found = await exchange.collect(
      reply(
        `File: src/a.js\n${fence}js\nexport const a = 2;\n${fence}\n\n${fence}\n#To delete (only to a bin):\nsrc/b.js\n${fence}`,
      ),
    );
    expect(found.sets.map((s) => s.kind)).toEqual(['files', 'files']);
    const [whole, gone] = found.sets;
    expect(whole?.kind === 'files' && whole.writes.map((w) => w.path)).toEqual(['src/a.js']);
    expect(gone?.kind === 'files' && gone.deletes).toEqual(['src/b.js']);
  });

  it('queues the files a reply asks for, through the share rules', async () => {
    const { exchange } = await setup();
    const found = await exchange.collect(reply('Files needed:\n- src/a.js\n- .env'));
    expect(exchange.pending()).toEqual(['src/a.js']);
    expect(found.notes.join(' ')).toContain('src/a.js: queued');
    expect(found.notes.join(' ')).toContain('.env');
  });

  it('says so when the reply is only web results', async () => {
    const { exchange } = await setup();
    const found = await exchange.collect(
      reply('10 sites\n\n#### Here are top web results for exploring this topic:'),
    );
    expect(found.notes.join(' ')).toContain('web results');
  });
});

describe('tool calls', () => {
  it('answers a search and a file request in one message', async () => {
    const { exchange } = await setup();
    const calls = extractToolCalls(
      `${fence}json\n{"name":"share_files","arguments":{"paths":["src/a.js",".env"]}}\n${fence}`,
    );
    const { prepared, summary } = await exchange.runTools(calls, 'thread-1');
    expect(prepared.prompt).toContain('"call_id":"call_1"');
    expect(prepared.prompt).toContain('1 file sent with this message.');
    expect(prepared.prompt).toContain('File src/a.js:');
    expect(prepared.prompt).not.toContain('SECRET');
    expect(prepared.prompt).not.toMatch(/reiner/i);
    expect(summary.join(' ')).toContain('refused 1');
  });

  it('does not send the whole project without a yes', async () => {
    const { exchange } = await setup();
    const calls = extractToolCalls(`${fence}json\n{"name":"share_project","arguments":{}}\n${fence}`);
    const { prepared } = await exchange.runTools(calls, 'thread-1');
    expect(prepared.prompt).toContain('declined');
    expect(prepared.prompt).not.toContain('File src/a.js:');
  });
});
