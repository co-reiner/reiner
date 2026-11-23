/**
 * @file Tests for the `messages` mode: nothing is uploaded; the project goes as its file list, the files the
 * model asks for go quoted in messages, up to a limit, and the sections describe quoted files.
 * @see {@link ../docs/packs.md#the-messages-mode | File exchange: the messages mode}
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractToolCalls } from '@co-reiner/core';
import { describe, expect, it } from 'vitest';
import { buildSections, MESSAGES_MODE, sectionIds, setSections } from '../src/index.ts';
import { exchangeOf, nl, setup } from './support.ts';

const call = (name: string, args: Record<string, unknown>) =>
  extractToolCalls(['```reiner-tool', JSON.stringify({ name, arguments: args }), '```'].join(nl));

describe('the messages mode', () => {
  it('lists the project in the next prompt after /pack, never its content, and uploads nothing', async () => {
    const { session, root } = await setup(1, undefined, { textLimit: 10_000 });
    await writeFile(path.join(root, 'a.txt'), 'alpha\n');
    await writeFile(path.join(root, 'b.txt'), 'beta\n');
    const transfer = exchangeOf(session);
    expect(await transfer.sendsText()).toBe(true);
    const project = await transfer.listProject();
    expect(project.count).toBe(2);
    const prepared = await transfer.prepare('Look at it', undefined);
    expect(prepared.attachments).toEqual([]);
    expect(prepared.prompt).toMatch(/^\[Precise\] project=\S+ next-patch=001/);
    expect(prepared.prompt).toContain(
      'The files of my project (2): a.txt, b.txt. Ask for the files you need with share_files.',
    );
    // A small project that would fit is still not quoted.
    expect(prepared.prompt).not.toContain('File a.txt:');
    expect(prepared.prompt).not.toContain('alpha');
    expect(prepared.prompt).toContain('## Project files');
    expect(prepared.prompt).not.toContain('.zip.docx');
    expect(prepared.prompt.endsWith('Look at it')).toBe(true);
    // Sent: the list goes once, and no file counts as seen by the chat.
    await transfer.afterSend('chat-1', prepared, 'Look at it');
    expect((await transfer.state()).shared['chat-1']).toBeUndefined();
    const next = await transfer.prepare('And now?', 'chat-1');
    expect(next.prompt).not.toContain('The files of my project');
  });

  it('lists by the share rules alone: the search settings neither hide nor add a file', async () => {
    const { session, root } = await setup(1, undefined, { textLimit: 10_000 });
    await writeFile(path.join(root, '.gitignore'), 'gen/\n');
    await mkdir(path.join(root, 'gen'));
    await writeFile(path.join(root, 'gen', 'out.txt'), 'generated\n');
    await writeFile(path.join(root, 'a.min.js'), 'x\n');
    await writeFile(
      session.paths.configFile,
      JSON.stringify({ harnesses: { alpha: { include: ['gen/**'], exclude: ['*.min.js'] } } }),
    );
    const project = await exchangeOf(session).listProject();
    expect(project.intro).toContain('a.min.js');
    expect(project.intro).not.toContain('gen/out.txt');
  });

  it('share_files quotes any shareable file, and names what is left for a later call', async () => {
    const { session, root } = await setup(1, undefined, { textLimit: 120 });
    await writeFile(path.join(root, 'a.txt'), 'short\n');
    await writeFile(path.join(root, 'b.txt'), 'y'.repeat(150));
    const result = await exchangeOf(session).runTools(
      call('share_files', { paths: ['a.txt', 'b.txt'] }),
      'c',
    );
    expect(result.prepared.attachments).toEqual([]);
    expect(result.prepared.quoted).toEqual(['a.txt']);
    expect(result.prepared.prompt).toContain(`File a.txt:${nl}\`\`\`${nl}short`);
    expect(result.prepared.prompt).toContain('Not sent, too long for this message: b.txt');
    expect(result.prepared.prompt.endsWith('Continue the task.')).toBe(true);
  });

  it('share_project sends the file list only after a yes, and nothing without one', async () => {
    const { session, root } = await setup(1, undefined, { textLimit: 10_000 });
    await writeFile(path.join(root, 'a.txt'), 'alpha\n');
    const transfer = exchangeOf(session);
    const yes = await transfer.runTools(call('share_project', {}), 'c', { confirm: async () => true });
    expect(yes.prepared.attachments).toEqual([]);
    expect(yes.prepared.prompt).toContain(
      'The files of my project (1): a.txt. Ask for the files you need with share_files.',
    );
    expect(yes.prepared.prompt).not.toContain('File a.txt:');
    expect(yes.prepared.quoted).toBeUndefined();
    const no = await transfer.runTools(call('share_project', {}), 'c', { confirm: async () => false });
    expect(no.prepared.prompt).toContain('the user declined; nothing sent');
  });
});

describe('the messages mode sections', () => {
  it('describe quoted files, with no archives and no index, and are found again for a sync', () => {
    const sections = buildSections({ mode: MESSAGES_MODE, index: true });
    expect(sections.map((s) => s.id)).toEqual(['files', 'tools', 'transfer']);
    const text = sections.map((s) => s.text).join(nl);
    expect(text).toContain('## Project files');
    expect(text).not.toMatch(/zip|\.docx|search index/i);
    const saved = setSections('My own text.', sections);
    expect(sectionIds(saved)).toEqual(['files', 'tools', 'transfer']);
    expect(setSections(saved, []).trim()).toBe('My own text.');
  });
});
