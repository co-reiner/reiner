/**
 * @file Tests for the shareable file list, the `glob` and `grep` tools, and the search `include`/`exclude` settings.
 * @see {@link ../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 * @see {@link ../../../docs/architecture/project-config.md#search-include-and-exclude | Project configuration: search include and exclude}
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeText,
  extractToolCalls,
  globFiles,
  globToRegExp,
  grepFiles,
  searchFilter,
  shareableFiles,
} from '../src/index.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'reiner-search-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd });
const NEEDLE = 'needle';

/**
 * A project inside a larger repo with every kind of file that must stay hidden: ignored by the top
 * `.gitignore`, by a nested one, by `.git/info/exclude`, tracked but ignored now, in `.reiner/`, outside the
 * project, and (where the OS allows it) a symlink leading outside. All of them contain the needle.
 */
async function project(): Promise<{ top: string; root: string; symlink: boolean }> {
  const top = tmp();
  const root = path.join(top, 'app');
  git(top, 'init', '-q');
  await mkdir(path.join(root, 'src', 'deep'), { recursive: true });
  await mkdir(path.join(root, 'logs'), { recursive: true });
  await mkdir(path.join(root, '.reiner'), { recursive: true });
  await writeFile(path.join(top, '.gitignore'), '.env\nsecret/\n');
  await writeFile(path.join(root, 'logs', '.gitignore'), '*.log\n');
  await writeFile(path.join(top, '.git', 'info', 'exclude'), 'local-notes.md\n');
  await writeFile(path.join(root, 'src', 'a.ts'), `export const a = '${NEEDLE}';\n`);
  await writeFile(path.join(root, 'src', 'deep', 'b.ts'), `// ${NEEDLE} in a comment\n`);
  await writeFile(path.join(root, 'new-untracked.md'), `${NEEDLE} here too\n`);
  await writeFile(path.join(root, '.env'), `TOKEN=${NEEDLE}\n`);
  await mkdir(path.join(root, 'secret'));
  await writeFile(path.join(root, 'secret', 'key.ts'), `${NEEDLE}\n`);
  await writeFile(path.join(root, 'logs', 'run.log'), `${NEEDLE}\n`);
  await writeFile(path.join(root, 'local-notes.md'), `${NEEDLE}\n`);
  await writeFile(path.join(root, 'was-tracked.ts'), `${NEEDLE}\n`);
  await writeFile(path.join(root, '.reiner', 'state.ts'), `${NEEDLE}\n`);
  await writeFile(path.join(top, 'outside.ts'), `${NEEDLE}\n`);
  git(top, 'add', '.gitignore', 'app/src', 'app/logs/.gitignore', 'app/was-tracked.ts', 'outside.ts');
  // Tracked first, ignored afterwards: git still lists it, the share rules must not.
  await writeFile(path.join(top, '.gitignore'), '.env\nsecret/\nwas-tracked.ts\n');
  let symlink = true;
  try {
    symlinkSync(path.join(top, 'outside.ts'), path.join(root, 'src', 'link.ts'));
  } catch {
    symlink = false; // Windows without developer mode cannot make symlinks.
  }
  return { top, root, symlink };
}

const VISIBLE = ['logs/.gitignore', 'new-untracked.md', 'src/a.ts', 'src/deep/b.ts'];

describe('shareableFiles', () => {
  it('lists tracked and untracked files, never anything ignored, hidden or outside', async () => {
    const { root } = await project();
    expect(await shareableFiles(root)).toEqual(VISIBLE);
  });

  it('lists nothing without git: it throws, so the tools say why', async () => {
    const root = tmp();
    await writeFile(path.join(root, '.env'), 'SECRET=1');
    await expect(shareableFiles(root)).rejects.toThrow(/git repository/);
    await expect(globFiles(root, '**/*')).rejects.toThrow(/git repository/);
  });
});

describe('globFiles', () => {
  it('never names an ignored file, even when the pattern asks for it exactly', async () => {
    const { root } = await project();
    expect((await globFiles(root, '**/*')).files).toEqual(VISIBLE);
    expect((await globFiles(root, '*.ts')).files).toEqual(['src/a.ts', 'src/deep/b.ts']);
    for (const hidden of [
      '.env',
      'secret/key.ts',
      'logs/*.log',
      'local-notes.md',
      'was-tracked.ts',
      '.reiner/*',
      '../*',
    ]) {
      expect(await globFiles(root, hidden)).toEqual({ files: [], total: 0 });
    }
  });

  it('reads globs the usual way', () => {
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/deep/b.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/deep/b.ts')).toBe(false);
    expect(globToRegExp('*.{ts,md}').test('docs/x.md')).toBe(true);
    expect(globToRegExp('file?.[ab]').test('file1.a')).toBe(true);
    expect(globToRegExp('file?.[!ab]').test('file1.a')).toBe(false);
  });

  it('folds repeated ** and refuses a tool call with too many', () => {
    const repeated = `${'**/'.repeat(40)}x.ts`;
    expect(globToRegExp(repeated).test('a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q.md')).toBe(false);
    expect(globToRegExp(repeated).test('a/b/x.ts')).toBe(true);
    const call = (pattern: string) =>
      extractToolCalls(
        [
          '```reiner-tool',
          JSON.stringify({ type: 'function_call', name: 'glob', arguments: { pattern } }),
          '```',
        ].join('\n'),
      );
    expect(call('**/a/**/b/**/c/**/d').errors).toHaveLength(1);
    expect(call('src/**/*.ts').calls).toHaveLength(1);
  });
});

describe('decodeText', () => {
  it('reads UTF-16 in both byte orders, and tells binary from text', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]))?.text).toBe('AB');
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]))?.text).toBe('AB');
    expect(decodeText(new Uint8Array([0x41, 0x00, 0x42]))).toBeUndefined();
  });
});

describe('grepFiles', () => {
  it('finds the needle only in files that may be shared', async () => {
    const { root, symlink } = await project();
    const found = await grepFiles(root, NEEDLE);
    expect(found.matches.map((m) => m.file)).toEqual(['new-untracked.md', 'src/a.ts', 'src/deep/b.ts']);
    expect(found.total).toBe(3);
    expect(found.matches[1]).toEqual({ file: 'src/a.ts', line: 1, text: `export const a = '${NEEDLE}';` });
    // A symlink out of the project is never followed (only checked where the OS could make one).
    if (symlink) expect(found.matches.some((m) => m.file === 'src/link.ts')).toBe(false);
  });

  it('narrows by glob and case, and rejects a bad expression', async () => {
    const { root } = await project();
    expect((await grepFiles(root, 'NEEDLE', { glob: 'src/**' })).total).toBe(0);
    expect((await grepFiles(root, 'NEEDLE', { glob: 'src/**', ignoreCase: true })).files).toBe(2);
    await expect(grepFiles(root, '(')).rejects.toThrow();
  });
});

describe('glob and grep calls', () => {
  it('parse with their options', () => {
    const nl = String.fromCharCode(10);
    const md = [
      '```reiner-tool',
      '{"type":"function_call","name":"glob","arguments":{"pattern":"src/**/*.ts"}}',
      '```',
      '```reiner-tool',
      '{"type":"function_call","name":"grep","arguments":{"pattern":"needle","glob":"*.ts","ignoreCase":true}}',
      '```',
    ].join(nl);
    expect(extractToolCalls(md).calls).toEqual([
      { tool: 'glob', pattern: 'src/**/*.ts', callId: 'call_1' },
      { tool: 'grep', pattern: 'needle', glob: '*.ts', ignoreCase: true, callId: 'call_2' },
    ]);
  });
});

describe('include and exclude from the harness settings', () => {
  it('include adds back git-ignored files, but never .reiner, .git or anything outside', async () => {
    const { root } = await project();
    const files = await shareableFiles(root, {
      include: ['logs/*.log', 'was-tracked.ts', '.reiner/**', '.git/**', '../*'],
    });
    expect(files).toEqual([...VISIBLE, 'logs/run.log', 'was-tracked.ts'].sort());
    const found = await grepFiles(root, NEEDLE, { filter: { include: ['*.log'] } });
    expect(found.matches.map((m) => m.file)).toContain('logs/run.log');
    expect(found.matches.map((m) => m.file)).not.toContain('.env');
  });

  it('exclude hides files, and wins over include', async () => {
    const { root } = await project();
    expect((await globFiles(root, '**/*', { exclude: ['src/deep/'] })).files).toEqual([
      'logs/.gitignore',
      'new-untracked.md',
      'src/a.ts',
    ]);
    const both = await shareableFiles(root, { include: ['*.log'], exclude: ['logs/**'] });
    expect(both.some((f) => f.startsWith('logs/'))).toBe(false);
    const found = await grepFiles(root, NEEDLE, { filter: { exclude: ['*.md'] } });
    expect(found.matches.map((m) => m.file)).toEqual(['src/a.ts', 'src/deep/b.ts']);
  });

  it('reads the settings, and explains settings that are not lists of patterns', () => {
    expect(searchFilter({ url: 'x' })).toEqual({ include: [], exclude: [] });
    expect(searchFilter({ include: ['gen/**'], exclude: ['*.min.js'] })).toEqual({
      include: ['gen/**'],
      exclude: ['*.min.js'],
    });
    expect(() => searchFilter({ exclude: 'dist/**' })).toThrow(/lists of glob patterns/);
  });
});
