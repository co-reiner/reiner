/**
 * @file Tests for the share rules in packs and diffs (also in a project inside a larger repo) and tool-call parsing.
 * @see {@link ../../../docs/architecture/file-exchange.md#share-rules | File exchange: share rules}
 * @see {@link ../../../docs/architecture/tool-protocol.md | Tool protocol}
 * @see {@link ../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyDiff, checkShareable, extractToolCalls, toolResult } from '@co-reiner/core';
import { afterEach, describe, expect, it } from 'vitest';
import { packProject } from '../src/index.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'reiner-share-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd });

/** A repo whose project is a sub-folder (like test-projects/test01), with an ignored but tracked file. */
async function nested(): Promise<{ top: string; root: string }> {
  const top = tmp();
  const root = path.join(top, 'projects', 'app');
  git(top, 'init', '-q');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(top, '.gitignore'), '*.secret\n');
  await writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await writeFile(path.join(root, 'keys.secret'), 'token');
  await writeFile(path.join(top, 'outside.txt'), 'outside');
  git(top, 'add', '.gitignore', 'projects/app/src/a.ts', 'outside.txt');
  git(top, 'add', '-f', 'projects/app/keys.secret');
  return { top, root };
}

describe('checkShareable', () => {
  it('refuses paths outside the project, .git, .reiner, missing files, and git-ignored files', async () => {
    const { root } = await nested();
    const result = await checkShareable(root, [
      'src/a.ts',
      '../../outside.txt',
      '.reiner/config.jsonc',
      'nope.ts',
      'keys.secret',
      'C:/Windows/win.ini',
    ]);
    expect(result.allowed).toEqual(['src/a.ts']);
    const reasons = Object.fromEntries(result.refused.map((r) => [r.path, r.reason]));
    expect(reasons['../../outside.txt']).toMatch(/inside the project/);
    expect(reasons['.reiner/config.jsonc']).toMatch(/never shared/);
    expect(reasons['nope.ts']).toMatch(/no such file/);
    expect(reasons['keys.secret']).toMatch(/gitignore/);
  });

  it('shares nothing without git', async () => {
    const root = tmp();
    await writeFile(path.join(root, '.env'), 'SECRET=1');
    await writeFile(path.join(root, 'a.ts'), 'x');
    const result = await checkShareable(root, ['.env', 'a.ts']);
    expect(result.allowed).toEqual([]);
    expect(result.refused.map((r) => r.reason)).toEqual([
      'not in a git repository',
      'not in a git repository',
    ]);
  });

  it('refuses a link to an ignored file, and files reached through a linked folder', async () => {
    const { root } = await nested();
    // Junctions need no special rights on Windows; file symlinks need Developer Mode there, so that part
    // runs only where links can be made.
    symlinkSync(path.join(root, 'src'), path.join(root, 'linked'), 'junction');
    const fileLink = (() => {
      try {
        symlinkSync(path.join(root, 'keys.secret'), path.join(root, 'innocent.txt'), 'file');
        return true;
      } catch {
        return false;
      }
    })();
    const asked = ['linked/a.ts', 'src/a.ts', ...(fileLink ? ['innocent.txt'] : [])];
    const result = await checkShareable(root, asked);
    expect(result.allowed).toEqual(['src/a.ts']);
    for (const r of result.refused) expect(r.reason).toMatch(/link/);
    expect(result.refused).toHaveLength(asked.length - 1);
  });
});

describe('packProject share rules', () => {
  it('leaves out tracked files that git ignores, and lists them as refused', async () => {
    const { root } = await nested();
    const pack = await packProject({ root, outDir: tmp(), index: false });
    expect(pack.files).toEqual(['src/a.ts']);
    expect(pack.refused.map((r) => r.path)).toEqual(['keys.secret']);
  });

  it('refuses to pack a folder without git', async () => {
    const root = tmp();
    await writeFile(path.join(root, 'a.txt'), 'a');
    await expect(packProject({ root, outDir: tmp(), index: false })).rejects.toThrow(/git repository/);
  });
});

describe('applyDiff in a project inside a larger repo', () => {
  it('applies paths relative to the project, not the repo top', async () => {
    const { root } = await nested();
    const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-export const a = 1;
+export const a = 2;
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1 @@
+export const b = 1;
`;
    await applyDiff(root, diff);
    expect(readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toBe('export const a = 2;\n');
    expect(existsSync(path.join(root, 'src/b.ts'))).toBe(true);
  });
});

describe('extractToolCalls', () => {
  it('reads share_files calls and reports blocks it cannot use', () => {
    const md = [
      '```reiner-tool',
      '{"type":"function_call","name":"share_files","arguments":{"paths":["src/a.ts"],"reason":"sandbox reset"}}',
      '```',
      '```reiner-tool',
      '{"type":"function_call","name":"delete_everything","arguments":{}}',
      '```',
      '```reiner-tool',
      'not json',
      '```',
      '```reiner-tool',
      '{"type":"function_call","name":"share_files","arguments":{}}',
      '```',
    ].join('\n');
    const parsed = extractToolCalls(md);
    expect(parsed.calls).toEqual([
      { tool: 'share_files', paths: ['src/a.ts'], reason: 'sandbox reset', callId: 'call_1' },
    ]);
    expect(parsed.errors).toHaveLength(3);
    expect(parsed.errors[0]).toMatch(/unknown tool/);
  });

  it('accepts a reply that is only one JSON tool block, whatever its language label', () => {
    const only = [
      '```react',
      '{"type":"function_call","name":"share_files","arguments":{"paths":["src/a.ts"]}}',
      '```',
    ].join(String.fromCharCode(10));
    expect(extractToolCalls(only).calls).toHaveLength(1);
    const example = [
      'Here is an example:',
      '',
      '```json',
      '{"type":"function_call","name":"share_files","arguments":{"paths":["src/a.ts"]}}',
      '```',
    ].join(String.fromCharCode(10));
    expect(extractToolCalls(example).calls).toHaveLength(0);
  });

  it('reads the function-call shape, with arguments as an object or a JSON string', () => {
    const nl = String.fromCharCode(10);
    const block = (call: unknown) => ['```reiner-tool', JSON.stringify(call), '```'].join(nl);
    const asObject = {
      type: 'function_call',
      call_id: 'call_7',
      name: 'grep',
      arguments: { pattern: 'x', glob: '*.ts' },
    };
    expect(extractToolCalls(block(asObject)).calls).toEqual([
      { tool: 'grep', pattern: 'x', glob: '*.ts', callId: 'call_7' },
    ]);
    const asString = { type: 'function_call', name: 'share_files', arguments: JSON.stringify({ all: true }) };
    expect(extractToolCalls(block(asString)).calls).toEqual([
      { tool: 'share_files', all: true, callId: 'call_1' },
    ]);
    const broken = { type: 'function_call', name: 'glob', arguments: '{not json' };
    expect(extractToolCalls(block(broken)).errors[0]).toMatch(/arguments/);
    // Relabelled by the page: a reply that is only this one block still counts.
    const relabelled = ['```json', JSON.stringify(asObject), '```'].join(nl);
    expect(extractToolCalls(relabelled).calls).toHaveLength(1);
  });
});

describe('tool call shape and answers', () => {
  it('reads no other shape: the earlier {"tool": ...} form is reported back', () => {
    const nl = String.fromCharCode(10);
    const old = extractToolCalls(['```reiner-tool', '{"tool":"glob","pattern":"*.ts"}', '```'].join(nl));
    expect(old.calls).toEqual([]);
    expect(old.errors[0]).toMatch(/function call/);
  });

  it('answers a call with a function_call_output item', () => {
    expect(JSON.parse(toolResult('call_7', `two${String.fromCharCode(10)}lines`))).toEqual({
      type: 'function_call_output',
      call_id: 'call_7',
      output: `two${String.fromCharCode(10)}lines`,
    });
  });

  it('reads share_project calls and lists every tool for an unknown one', () => {
    const nl = String.fromCharCode(10);
    const ok = extractToolCalls(
      [
        '```reiner-tool',
        '{"type":"function_call","name":"share_project","arguments":{"reason":"x"}}',
        '```',
      ].join(nl),
    );
    expect(ok.calls).toEqual([{ tool: 'share_project', reason: 'x', callId: 'call_1' }]);
    const bad = extractToolCalls(
      ['```reiner-tool', '{"type":"function_call","name":"toString","arguments":{}}', '```'].join(nl),
    );
    expect(bad.errors[0]).toContain('available: share_files, share_project, glob, grep');
  });
});
