/**
 * @file Tests keeping a chat's copy of the project current before each prompt (part packs with deleted
 * files, full packs after idle time), and `share_files`.
 * @see {@link ../docs/packs.md#keeping-the-project-current | File exchange: keeping the project current}
 * @see {@link ../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 */
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractToolCalls, readChangeFile, readState, writeState } from '@co-reiner/core';
import { describe, expect, it } from 'vitest';
import { exchangeOf, nl, setup } from './support.ts';

const shareFiles = (paths: string[]) =>
  extractToolCalls(
    [
      '```reiner-tool',
      JSON.stringify({ type: 'function_call', name: 'share_files', arguments: { paths } }),
      '```',
    ].join(nl),
  );

/** A project whose chat "chat-1" just got a full pack with a.txt and b.txt. */
async function withFullPack() {
  const { session, root } = await setup(1);
  await writeFile(path.join(root, 'a.txt'), 'A');
  await writeFile(path.join(root, 'b.txt'), 'B');
  const transfer = exchangeOf(session);
  await transfer.pack();
  const sent = await transfer.prepare('look at a.txt', undefined);
  await transfer.afterSend('chat-1', sent, 'look at a.txt');
  const stateDir = path.join(session.paths.modulesDir, 'alpha');
  return { session, root, transfer, stateDir, full: path.basename(sent.pack?.file ?? '') };
}

/** Pretend the chat's last prompt was `minutes` ago. */
async function idleFor(stateDir: string, minutes: number) {
  const s = (await readState<Record<string, unknown>>(stateDir, 'transfer')) ?? {};
  const lastSent = { 'chat-1': new Date(Date.now() - minutes * 60_000).toISOString() };
  await writeState(stateDir, 'transfer', { ...s, lastSent });
}

describe('keeping the project current', () => {
  it('sends a cumulative part pack of what changed since the full pack, with deleted files', async () => {
    const { root, transfer, full } = await withFullPack();
    expect(full).toMatch(/\.zip\.docx$/);
    expect((await transfer.prepare('and now?', 'chat-1')).attachments).toEqual([]);
    await writeFile(path.join(root, 'meet.ts'), 'export const meet = 1;');
    const first = await transfer.prepare('what is in meet.ts?', 'chat-1');
    expect(path.basename(first.pack?.file ?? '')).toMatch(/\.part\.zip\.docx$/);
    expect(first.pack?.files).toEqual(['meet.ts']);
    expect(first.notes?.[0]).toContain('sending a part pack (1 changed)');
    expect(first.prompt).toContain(`It holds every file changed since ${full}`);
    await transfer.afterSend('chat-1', first, 'what is in meet.ts?');
    expect((await transfer.prepare('again', 'chat-1')).attachments).toEqual([]);
    // Cumulative: the next part still holds meet.ts, and lists b.txt as deleted.
    await rm(path.join(root, 'b.txt'));
    const second = await transfer.prepare('b.txt is gone', 'chat-1');
    expect(second.pack?.files).toEqual(['meet.ts']);
    expect(second.pack?.deleted).toEqual(['b.txt']);
    // Read back the way a patch from the model is read: the deleted list round-trips.
    const back = await readChangeFile(second.pack?.file ?? '');
    expect(back.kind === 'files' && back.writes.map((w) => w.path)).toEqual(['meet.ts']);
    expect(back.kind === 'files' && back.deletes).toEqual(['b.txt']);
    expect(second.prompt).toContain('these files are gone, remove them: b.txt');
  });

  it('sends a full pack when the chat was idle longer than staleMinutes', async () => {
    const { session, transfer, stateDir } = await withFullPack();
    await idleFor(stateDir, 11);
    const stale = await transfer.prepare('back again', 'chat-1');
    expect(stale.pack?.digest).toBeDefined();
    expect(stale.notes?.[0]).toContain('The chat was idle for 11 min');
    await transfer.afterSend('chat-1', stale, 'back again');
    // The setting is per harness: 1 minute makes 2 minutes stale; the default 10 does not.
    await idleFor(stateDir, 2);
    expect((await transfer.prepare('soon after', 'chat-1')).attachments).toEqual([]);
    const config = { harnesses: { alpha: { staleMinutes: 1 } }, defaultHarness: 'alpha' };
    await writeFile(session.paths.configFile, JSON.stringify(config));
    expect((await transfer.prepare('soon after', 'chat-1')).pack?.digest).toBeDefined();
  });

  it('keeps a /pack pack waiting until a send has carried it, so a failed send can be retried', async () => {
    const { session, root } = await setup(1);
    await writeFile(path.join(root, 'a.txt'), 'A');
    const transfer = exchangeOf(session);
    const pack = await transfer.pack();
    // The send after this prepare fails: afterSend is never called.
    const failed = await transfer.prepare('first try', undefined);
    expect(failed.attachments).toEqual([pack.file]);
    expect(transfer.pending()).toBe(pack);
    const retry = await transfer.prepare('second try', undefined);
    expect(retry.attachments).toEqual([pack.file]);
    await transfer.afterSend('chat-1', retry, 'second try');
    expect(transfer.pending()).toBeUndefined();
    expect((await transfer.prepare('and now?', 'chat-1')).attachments).toEqual([]);
  });

  it('leaves chats that never had the project alone', async () => {
    const { root, transfer } = await withFullPack();
    await writeFile(path.join(root, 'c.txt'), 'C');
    const other = await transfer.prepare('hello', 'chat-2');
    expect(other.attachments).toEqual([]);
    expect(other.prompt).toBe('hello');
  });

  it('sends chats recorded before full packs were tracked a full pack', async () => {
    const { session, root } = await setup(1);
    await writeFile(path.join(root, 'a.txt'), 'A');
    await writeState(path.join(session.paths.modulesDir, 'alpha'), 'transfer', {
      mode: 'diff',
      sequence: 1,
      briefed: { 'chat-old': 'x' },
      shared: { 'chat-old': ['a.txt'] },
    });
    const sent = await exchangeOf(session).prepare('hi', 'chat-old');
    expect(sent.pack?.files).toEqual(['a.txt']);
    expect(sent.pack?.digest).toBeDefined();
  });
});

describe('files a reply asks to delete', () => {
  it('offers the To delete block as a change set of deletions, after the other changes', async () => {
    const { session } = await setup(1);
    const transfer = exchangeOf(session);
    const reply = [
      'Done. One file is no longer needed.',
      '',
      '```',
      '#To delete (only to a bin):',
      'docs/notes.md',
      'src/old.ts',
      '```',
    ].join(nl);
    const found = await transfer.collect({ markdown: reply, stopped: false, elapsedMs: 1 });
    expect(found.sets).toEqual([
      { kind: 'files', source: 'reply (to delete)', writes: [], deletes: ['docs/notes.md', 'src/old.ts'] },
    ]);
  });
});

describe('briefing a chat', () => {
  const askProject = extractToolCalls(
    ['```reiner-tool', '{"type":"function_call","name":"share_project","arguments":{}}', '```'].join(nl),
  );

  it('does not count a tool answer as briefing the chat', async () => {
    const { session, root } = await setup(1);
    await writeFile(path.join(root, 'a.txt'), 'A');
    const transfer = exchangeOf(session);
    // A chat that never had a pack or the sections writes something that reads as a tool call.
    const answer = await transfer.runTools(shareFiles(['a.txt']), 'chat-x');
    expect(answer.prepared.attachments).toEqual([]);
    await transfer.afterSend('chat-x', answer.prepared, '');
    expect((await transfer.state()).briefed['chat-x']).toBeUndefined();
    // It still has nothing of the project, so its prompts go as typed.
    expect((await transfer.prepare('hello', 'chat-x')).prompt).toBe('hello');
  });

  it('sends the sections with the next prompt of a chat that got its pack from a tool answer', async () => {
    const { session, root } = await setup(1);
    await writeFile(path.join(root, 'a.txt'), 'A');
    const transfer = exchangeOf(session);
    const answer = await transfer.runTools(askProject, 'chat-y', { confirm: async () => true });
    expect(answer.prepared.pack?.digest).toBeDefined();
    await transfer.afterSend('chat-y', answer.prepared, '');
    // The tool answer carried no sections, so the first real prompt does, once.
    const next = await transfer.prepare('now look', 'chat-y');
    expect(next.prompt).toContain('## Project tools');
    await transfer.afterSend('chat-y', next, 'now look');
    expect((await transfer.prepare('again', 'chat-y')).prompt).not.toContain('## Project tools');
  });
});

describe('share_files', () => {
  it('in a chat with the project: a part pack of what changed, else nothing', async () => {
    const { root, transfer } = await withFullPack();
    const same = await transfer.runTools(shareFiles(['a.txt', '../x']), 'chat-1');
    expect(same.prepared.attachments).toEqual([]);
    expect(same.prepared.prompt).toContain('nothing attached: no file changed since');
    expect(same.prepared.prompt).toContain('../x (not in the project, or not shareable)');
    await writeFile(path.join(root, 'c.txt'), 'C');
    const changed = await transfer.runTools(shareFiles(['c.txt']), 'chat-1');
    expect(changed.prepared.pack?.files).toEqual(['c.txt']);
    expect(changed.prepared.prompt).toContain('It holds every file changed since');
    expect(changed.prepared.prompt).toContain('(part)');
  });

  it('in a chat without the project: a part pack of files it has seen, the rest refused', async () => {
    const { session, root } = await setup(1);
    await writeFile(path.join(root, 'a.txt'), 'A');
    await writeFile(path.join(root, 'b.txt'), 'B');
    // A chat that was sent a.txt once, but never the whole project.
    await writeState(path.join(session.paths.modulesDir, 'alpha'), 'transfer', {
      mode: 'diff',
      sequence: 1,
      briefed: { 'chat-p': 'x' },
      shared: { 'chat-p': ['a.txt'] },
      primary: {},
    });
    const transfer = exchangeOf(session);
    const result = await transfer.runTools(shareFiles(['a.txt', 'b.txt']), 'chat-p');
    expect(path.basename(result.prepared.pack?.file ?? '')).toMatch(/\.part\.zip\.docx$/);
    expect(result.prepared.pack?.files).toEqual(['a.txt']);
    expect(result.prepared.prompt).toContain('b.txt (not shared in this chat before)');
    // Never the whole project without a y/N: nothing is refreshed before the next prompt.
    expect((await transfer.prepare('next', 'chat-p')).attachments).toEqual([]);
  });

  it('asked twice in one reply: one part pack that holds the files of both calls', async () => {
    const { session, root } = await setup(1);
    await writeFile(path.join(root, 'a.txt'), 'A');
    await writeFile(path.join(root, 'b.txt'), 'B');
    await writeState(path.join(session.paths.modulesDir, 'alpha'), 'transfer', {
      mode: 'diff',
      sequence: 1,
      briefed: { 'chat-p': 'x' },
      shared: { 'chat-p': ['a.txt', 'b.txt'] },
      primary: {},
    });
    const twice = { calls: [...shareFiles(['a.txt']).calls, ...shareFiles(['b.txt']).calls], errors: [] };
    const result = await exchangeOf(session).runTools(twice, 'chat-p');
    expect(result.prepared.attachments).toHaveLength(1);
    // The first result says a.txt is attached; the pack that goes still holds it.
    expect([...(result.prepared.pack?.files ?? [])].sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('in a chat that has seen nothing: everything refused', async () => {
    const { transfer } = await withFullPack();
    const other = await transfer.runTools(shareFiles(['a.txt']), 'chat-2');
    expect(other.prepared.attachments).toEqual([]);
    expect(other.prepared.prompt).toContain('a.txt (not shared in this chat before)');
  });
});
