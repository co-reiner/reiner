/**
 * @file Tests for where applied changes may land (`safeTarget`) and how deletions in diffs are recycled.
 * @see {@link ../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDiff, checkDiff, extractDeletions, safeTarget, splitDeletions } from '../src/index.ts';
import { samePath } from '../src/transfer/safe-path.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'reiner-apply-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function repo(): Promise<string> {
  const root = tmp();
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root });
  git('init', '-q');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\nexport const b = 2;\n');
  await writeFile(path.join(root, 'notes.md'), '# Notes\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'init');
  return root;
}

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-export const a = 1;
+export const a = 10;
 export const b = 2;
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const c = 3;
diff --git a/notes.md b/notes.md
deleted file mode 100644
--- a/notes.md
+++ /dev/null
@@ -1 +0,0 @@
-# Notes
`;

/** Stands in for the recycle bin in tests: records the files and removes them, so nothing reaches the real one. */
function fakeTrash() {
  const trashed: string[] = [];
  const trash = async (files: string[]) => {
    for (const f of files) {
      trashed.push(path.basename(f));
      rmSync(f);
    }
  };
  return { trashed, trash };
}

describe('applying changes', () => {
  it('refuses paths outside the project and inside .git or .reiner, in any spelling', () => {
    const root = tmp();
    for (const bad of [
      '../x',
      '/etc/x',
      'C:/x',
      '.git/config',
      '.reiner/config.jsonc',
      'sub/../.git/config',
      'sub/../.reiner/config.jsonc',
      './.GIT/config',
      '.git./config',
      'GIT~1/config',
      'a.txt:stream',
      '.',
      '',
    ])
      expect(() => safeTarget(root, bad), bad).toThrow();
    expect(safeTarget(root, 'src/x.ts')).toBe(path.join(root, 'src', 'x.ts'));
    expect(safeTarget(root, './src/x.ts')).toBe(path.join(root, 'src', 'x.ts'));
  });

  it('refuses folders that are links, and a link at the target', () => {
    const root = tmp();
    const outside = tmp();
    symlinkSync(outside, path.join(root, 'out'), 'junction');
    expect(() => safeTarget(root, 'out/x.ts')).toThrow(/link/);
    expect(() => safeTarget(root, 'out/new/x.ts')).toThrow(/link/);
    try {
      symlinkSync(path.join(outside, 'f.txt'), path.join(root, 'f.txt'), 'file');
    } catch {
      return; // file symlinks need Developer Mode or admin rights on Windows
    }
    expect(() => safeTarget(root, 'f.txt')).toThrow(/link/);
  });

  it('deletes through the recycle bin in a plain unified diff too', async () => {
    const plain = ['--- notes.md', '+++ /dev/null', '@@ -1 +0,0 @@', '-hello', ''].join('\n');
    expect(splitDeletions(plain)).toEqual({ rest: '', deleted: ['notes.md'] });
    const root = await repo();
    const { trashed, trash } = fakeTrash();
    await applyDiff(root, plain, trash);
    expect(trashed).toEqual(['notes.md']);
  });

  it('changes nothing when the rest of a diff does not apply', async () => {
    const root = await repo();
    const { trashed, trash } = fakeTrash();
    const bad = DIFF.replace('-export const a = 1;', '-export const a = 999;');
    await expect(applyDiff(root, bad, trash)).rejects.toThrow();
    expect(trashed).toEqual([]);
    expect(existsSync(path.join(root, 'notes.md'))).toBe(true);
  });
});

describe('the To delete block of a reply', () => {
  const nl = String.fromCharCode(10);

  it('reads one path per line from the code block', () => {
    const reply = [
      'Changes below.',
      '',
      '```text',
      '#To delete (only to a bin):',
      'docs/notes.md',
      'src\\old.ts',
      '```',
      'Done.',
    ];
    expect(extractDeletions(reply.join(nl))).toEqual(['docs/notes.md', 'src/old.ts']);
  });

  it('reads it when the page shows the header as a heading with a list', () => {
    const reply = [
      '# To delete (only to a bin):',
      '',
      '- `docs/notes.md`',
      '- src/old.ts',
      '',
      'That is all.',
    ];
    expect(extractDeletions(reply.join(nl))).toEqual(['docs/notes.md', 'src/old.ts']);
  });

  it('finds nothing in a reply without the header', () => {
    expect(
      extractDeletions(['To delete a file, use the bin.', '', '```', 'rm notes.md', '```'].join(nl)),
    ).toEqual([]);
  });
});

describe('comparing a real path with the path asked for', () => {
  it('treats the composed and decomposed forms of a name as the same file', () => {
    // macOS stores "é" decomposed (e + a combining accent); git and most tools write it composed.
    const composed = 'docs/café.md';
    const decomposed = 'docs/café.md';
    expect(composed).not.toBe(decomposed);
    expect(samePath(composed, decomposed)).toBe(true);
    expect(samePath('docs/cafe.md', composed)).toBe(false);
  });
});

describe('checking diffs before they are applied', () => {
  it('refuses .git and .reiner at any depth', () => {
    const root = tmp();
    expect(() => safeTarget(root, 'vendor/lib/.git/hooks/pre-commit')).toThrow(/\.git/);
    expect(() => safeTarget(root, 'sub/.GIT')).toThrow(/\.GIT/);
    expect(() => safeTarget(root, 'a/.reiner/config.jsonc')).toThrow(/\.reiner/);
  });

  it('refuses a diff whose names git would read differently', async () => {
    const hunk = ['@@ -1 +1 @@', '-x', '+y', ''];
    const copy = [
      'diff --git a/.env b/docs/x.txt',
      'similarity index 100%',
      'copy from .env',
      'copy to docs/x.txt',
      '',
    ];
    const rename = ['diff --git a/src/a.ts b/src/a.ts', 'rename from .env', 'rename to notes.txt', ''];
    const quoted = ['--- "a/.reiner/config.jsonc"', '+++ "b/.reiner/config.jsonc"', ...hunk];
    const noPrefix = ['--- lib/package.json', '+++ lib/package.json', ...hunk];
    const mixed = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/notes.md', ...hunk];
    for (const lines of [copy, rename, quoted, noPrefix, mixed]) {
      expect(() => checkDiff(lines.join('\n'))).toThrow();
    }
    const root = await repo();
    await expect(applyDiff(root, copy.join('\n'))).rejects.toThrow(/renames or copies/);
    expect(existsSync(path.join(root, 'docs/x.txt'))).toBe(false);
  });

  it('accepts the usual diffs, with or without a timestamp', () => {
    expect(() => checkDiff(DIFF)).not.toThrow();
    const stamped = [
      '--- a/src/a.ts\t2026-11-10 10:00:01',
      '+++ b/src/a.ts\t2026-11-10 10:00:02',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      '',
    ];
    expect(() => checkDiff(stamped.join('\n'))).not.toThrow();
  });

  it('recycles a deleted binary or empty file, which has no --- line', async () => {
    const gone = [
      'diff --git a/notes.md b/notes.md',
      'deleted file mode 100644',
      'index e69de29..0000000',
      '',
    ].join('\n');
    expect(splitDeletions(gone)).toEqual({ rest: '', deleted: ['notes.md'] });
    const root = await repo();
    const { trashed, trash } = fakeTrash();
    await applyDiff(root, gone, trash);
    expect(trashed).toEqual(['notes.md']);
  });
});
