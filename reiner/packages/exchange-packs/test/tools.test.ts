/**
 * @file Tests the model's tools `share_project`, `glob` and `grep` (`share_files` is in primary.test.tsx).
 * @see {@link ../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 * @see {@link ../../../docs/architecture/project-config.md#search-include-and-exclude | Project configuration: search include and exclude}
 */
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractToolCalls, writeState } from '@co-reiner/core';
import { describe, expect, it } from 'vitest';
import { exchangeOf, nl, setup } from './support.ts';

const askProject = extractToolCalls(
  [
    '```reiner-tool',
    '{"type":"function_call","name":"share_project","arguments":{"reason":"no pack yet"}}',
    '```',
  ].join(nl),
);

describe('share_project tool', () => {
  it('packs the whole project after a yes, and the chat may ask for those files later', async () => {
    const { session, root } = await setup(1);
    await writeFile(path.join(root, 'a.txt'), 'A');
    await writeFile(path.join(root, 'b.txt'), 'B');
    const transfer = exchangeOf(session);
    const questions: string[] = [];
    const result = await transfer.runTools(askProject, 'chat-1', {
      confirm: async (q) => {
        questions.push(q);
        return true;
      },
    });
    expect(questions[0]).toContain('asks for the whole project (no pack yet)');
    expect(result.prepared.pack?.files).toEqual(expect.arrayContaining(['a.txt', 'b.txt']));
    expect(result.prepared.attachments).toEqual([result.prepared.pack?.file]);
    expect(result.prepared.prompt).toContain(
      '{"type":"function_call_output","call_id":"call_1","output":"attached',
    );
    // A full pack, not a part pack.
    expect(result.prepared.prompt).not.toContain('(part)');
    await transfer.afterSend('chat-1', result.prepared, '');
    // The chat now has the whole project: asking for a file again sends nothing while nothing changed.
    const again = await transfer.runTools(
      extractToolCalls(
        [
          '```reiner-tool',
          '{"type":"function_call","name":"share_files","arguments":{"paths":["b.txt"]}}',
          '```',
        ].join(nl),
      ),
      'chat-1',
    );
    expect(again.prepared.attachments).toEqual([]);
    expect(again.prepared.prompt).toContain('nothing attached: no file changed since');
  });

  it('with share_files in the same reply: one full pack, and both results are true about it', async () => {
    const { session, root } = await setup(1);
    await writeFile(path.join(root, 'a.txt'), 'A');
    await writeFile(path.join(root, 'b.txt'), 'B');
    // The chat has seen a.txt, so share_files alone would make a part pack.
    await writeState(path.join(session.paths.modulesDir, 'alpha'), 'transfer', {
      mode: 'diff',
      sequence: 1,
      briefed: { 'chat-1': 'x' },
      shared: { 'chat-1': ['a.txt'] },
      primary: {},
    });
    const both = extractToolCalls(
      [
        '```reiner-tool',
        '{"type":"function_call","name":"share_files","arguments":{"paths":["a.txt","nope.txt"]}}',
        '```',
        '```reiner-tool',
        '{"type":"function_call","name":"share_project","arguments":{}}',
        '```',
      ].join(nl),
    );
    const result = await exchangeOf(session).runTools(both, 'chat-1', { confirm: async () => true });
    const { prompt, pack, attachments } = result.prepared;
    expect(attachments).toEqual([pack?.file]);
    expect(pack?.digest).toBeDefined();
    expect(pack?.files).toEqual(expect.arrayContaining(['a.txt', 'b.txt']));
    const name = path.basename(pack?.file ?? '');
    expect(prompt).toContain(`"call_id":"call_2","output":"attached ${name}`);
    expect(prompt).toContain(`"call_id":"call_1","output":"nothing more attached: ${name}`);
    expect(prompt).toContain('nope.txt (not in the project, or not shareable)');
    // No part pack is named: none is attached.
    expect(prompt).not.toContain('.part.zip.docx');
    expect(prompt).not.toContain('(part)');
  });
});

describe('share_project without a yes', () => {
  it('sends nothing without a yes', async () => {
    const { session, root } = await setup(1);
    await writeFile(path.join(root, 'a.txt'), 'A');
    const transfer = exchangeOf(session);
    const declined = await transfer.runTools(askProject, 'chat-1', { confirm: async () => false });
    expect(declined.prepared.attachments).toEqual([]);
    expect(declined.prepared.prompt).toContain('"output":"the user declined');
    // No way to ask (a script, `reiner -p`): treated as declined.
    const noAsk = await transfer.runTools(askProject, 'chat-1');
    expect(noAsk.prepared.attachments).toEqual([]);
  });
});

describe('glob and grep tools', () => {
  it('answers glob and grep inline, without a pack, and never names a git-ignored file', async () => {
    const { session, root } = await setup(1);
    execFileSync('git', ['init', '-q'], { cwd: root });
    await writeFile(path.join(root, '.gitignore'), '.env\n');
    await writeFile(path.join(root, 'a.txt'), 'needle one');
    await writeFile(path.join(root, '.env'), 'needle secret');
    const transfer = exchangeOf(session);
    const calls = extractToolCalls(
      [
        '```reiner-tool',
        '{"type":"function_call","name":"glob","arguments":{"pattern":"*"}}',
        '```',
        '```reiner-tool',
        '{"type":"function_call","name":"grep","arguments":{"pattern":"needle"}}',
        '```',
      ].join(nl),
    );
    const result = await transfer.runTools(calls, 'chat-1');
    expect(result.prepared.attachments).toEqual([]);
    expect(result.prepared.prompt).toContain('"call_id":"call_1","output":"');
    expect(result.prepared.prompt).toContain('"call_id":"call_2","output":"1 line in 1 file match /needle/:');
    expect(result.prepared.prompt).toContain('a.txt:1: needle one');
    expect(result.prepared.prompt).not.toContain('.env');
    expect(result.prepared.prompt).not.toContain('secret');
  });

  it('reads include and exclude from .reiner/config.jsonc on every call', async () => {
    const { session, root } = await setup(1);
    execFileSync('git', ['init', '-q'], { cwd: root });
    await writeFile(path.join(root, '.gitignore'), `*.gen.ts${nl}`);
    await writeFile(path.join(root, 'a.ts'), 'x');
    await writeFile(path.join(root, 'b.ts'), 'x');
    await writeFile(path.join(root, 'types.gen.ts'), 'x');
    const transfer = exchangeOf(session);
    const glob = extractToolCalls(
      ['```reiner-tool', '{"type":"function_call","name":"glob","arguments":{"pattern":"*.ts"}}', '```'].join(
        nl,
      ),
    );
    const config = (settings: Record<string, unknown>) =>
      writeFile(
        session.paths.configFile,
        JSON.stringify({ harnesses: { alpha: settings }, defaultHarness: 'alpha' }),
      );
    const listed = async () => (await transfer.runTools(glob, 'chat-1')).prepared.prompt;
    expect(await listed()).toContain('2 files match *.ts');
    await config({ include: ['*.gen.ts'], exclude: ['b.ts'] });
    const after = await listed();
    expect(after).toContain('types.gen.ts');
    expect(after).not.toContain('b.ts');
    // A broken setting stops the search and tells the user, not the model, what to fix.
    await config({ exclude: 'b.ts' });
    const broken = await transfer.runTools(glob, 'chat-1');
    expect(broken.prepared.prompt).toContain("not run: the user's search settings need fixing");
    expect(broken.summary.join(' ')).toContain('lists of glob patterns');
  });
});
