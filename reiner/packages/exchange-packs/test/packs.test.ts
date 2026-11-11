/**
 * @file Tests for instruction sections, diffs, change files and packs.
 * @see {@link ../docs/packs.md#instructions-and-sections | File exchange: instructions and sections}
 * @see {@link ../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 * @see {@link ../docs/packs.md#outbound-packs | File exchange: packs}
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyChangeSet, diffFiles, extractDiffs, readChangeFile, splitDeletions } from '@co-reiner/core';
import { unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { packProject, projectSnapshot, snapshotDigest } from '../src/index.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'reiner-transfer-'));
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

describe('diffs', () => {
  it('finds diff blocks in a reply and the files they touch', () => {
    const md = `Here you go:\n\n\`\`\`diff\n${DIFF}\`\`\`\n\nAnd some code:\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n`;
    const diffs = extractDiffs(md);
    expect(diffs).toHaveLength(1);
    expect(diffFiles(diffs[0] ?? '')).toEqual(['src/a.ts', 'src/new.ts', 'notes.md']);
  });

  it('applies a diff with git; a file it deletes goes to the recycle bin instead', async () => {
    const root = await repo();
    const { trashed, trash } = fakeTrash();
    const set = { kind: 'diff' as const, source: 'reply', diff: DIFF, files: diffFiles(DIFF) };
    const done = await applyChangeSet(root, set, { trash });
    expect(readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toContain('a = 10');
    expect(existsSync(path.join(root, 'src/new.ts'))).toBe(true);
    expect(trashed).toEqual(['notes.md']);
    expect(existsSync(path.join(root, 'notes.md'))).toBe(false);
    expect(done).toContain('notes.md');
  });

  it('splits the file deletions out of a diff', () => {
    const { rest, deleted } = splitDeletions(DIFF);
    expect(deleted).toEqual(['notes.md']);
    expect(rest).not.toContain('deleted file mode');
    expect(diffFiles(rest)).toEqual(['src/a.ts', 'src/new.ts']);
  });
});

describe('change files', () => {
  it('reads .reiner/deleted.txt in a patch, and recycles the files it lists', async () => {
    const file = path.join(tmp(), 'p.patch.004.zip.docx');
    const enc = (s: string) => new TextEncoder().encode(s);
    writeFileSync(
      file,
      zipSync({ 'src/b.ts': enc('b'), '.reiner/deleted.txt': enc('notes.md\n# a comment\n') }),
    );
    const set = await readChangeFile(file);
    if (set.kind !== 'files') throw new Error('expected files');
    expect(set.writes.map((w) => w.path)).toEqual(['src/b.ts']);
    expect(set.deletes).toEqual(['notes.md']);
    const root = await repo();
    const { trashed, trash } = fakeTrash();
    await applyChangeSet(root, set, { trash });
    expect(trashed).toEqual(['notes.md']);
  });

  it('reads a .zip.docx patch, drops Word wrapper entries and reads DELETED.txt', async () => {
    const dir = tmp();
    const file = path.join(dir, 'p.patch.003.zip.docx');
    const enc = (s: string) => new TextEncoder().encode(s);
    writeFileSync(
      file,
      zipSync({
        'src/a.ts': enc('export const a = 5;\n'),
        'DELETED.txt': enc('notes.md\n'),
        '[Content_Types].xml': enc('<x/>'),
        '_rels/.rels': enc('<x/>'),
        'package/services/metadata/core-properties/x.psmdcp': enc('<x/>'),
      }),
    );
    const set = await readChangeFile(file);
    expect(set.kind).toBe('files');
    if (set.kind !== 'files') return;
    expect(set.writes.map((w) => w.path)).toEqual(['src/a.ts']);
    expect(set.deletes).toEqual(['notes.md']);
    const root = await repo();
    await applyChangeSet(root, set, { trash: fakeTrash().trash });
    expect(readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toBe('export const a = 5;\n');
    expect(existsSync(path.join(root, 'notes.md'))).toBe(false);
  });

  it('reads a .patch file as a diff', async () => {
    const file = path.join(tmp(), 'p.patch.002.patch');
    writeFileSync(file, DIFF);
    const set = await readChangeFile(file);
    expect(set.kind).toBe('diff');
  });
});

describe('packProject', () => {
  it("packs git's files (tracked and new, not ignored) with a search index, or without it", async () => {
    const root = await repo();
    // A file not added to git yet is part of the project; an ignored one is not.
    await writeFile(path.join(root, 'untracked.txt'), 'new file');
    await writeFile(path.join(root, '.gitignore'), `secret.txt${String.fromCharCode(10)}`);
    await writeFile(path.join(root, 'secret.txt'), 'never packed');
    const out = tmp();
    const withIndex = await packProject({ root, outDir: out, fileName: 'a.zip.docx' });
    const names = Object.keys(unzipSync(new Uint8Array(readFileSync(withIndex.file))));
    expect(names.sort()).toEqual([
      '.gitignore',
      '.reiner/pack.txt',
      '.search/index.sqlite',
      '.search/manifest.json',
      'notes.md',
      'src/a.ts',
      'untracked.txt',
    ]);
    expect(withIndex.digest).toMatch(/^[0-9a-f]{16}$/);
    // The marker that tells uploads of the same name apart.
    const marker = new TextDecoder().decode(
      unzipSync(new Uint8Array(readFileSync(withIndex.file)))['.reiner/pack.txt'],
    );
    expect(marker).toBe(['kind=full', `made=${withIndex.made}`, ''].join(String.fromCharCode(10)));
    const without = await packProject({ root, outDir: out, fileName: 'b.zip.docx', index: false });
    expect(without.files.sort()).toEqual(['.gitignore', 'notes.md', 'src/a.ts', 'untracked.txt']);
  });

  it('leaves out files the global excludes file ignores, and tracked files an ignore rule matches now', async () => {
    const root = await repo();
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root });
    // A tracked file that is ignored later stays in git's index; it must still not be packed.
    await writeFile(path.join(root, 'old-secret.txt'), 'tracked, then ignored');
    git('add', 'old-secret.txt');
    // core.excludesFile is how the global ignore file works; set per repo so the test leaves ~ alone.
    const excludes = path.join(tmp(), 'gitignore_global');
    await writeFile(excludes, ['.search/', 'old-secret.txt', ''].join(String.fromCharCode(10)));
    git('config', 'core.excludesFile', excludes);
    await mkdir(path.join(root, '.search'), { recursive: true });
    await writeFile(path.join(root, '.search', 'notes.txt'), 'the user’s own, ignored');
    const pack = await packProject({ root, outDir: tmp(), fileName: 'g.zip.docx' });
    const names = Object.keys(unzipSync(new Uint8Array(readFileSync(pack.file))));
    expect(pack.files.sort()).toEqual(['notes.md', 'src/a.ts']);
    // Only Reiner's own index is under .search/ in the pack.
    expect(names.filter((n) => n.startsWith('.search/')).sort()).toEqual([
      '.search/index.sqlite',
      '.search/manifest.json',
    ]);
    expect(pack.refused).toContainEqual({ path: 'old-secret.txt', reason: 'ignored by .gitignore' });
  });

  it('changes the project digest when a file is added or saved, not otherwise', async () => {
    const root = await repo();
    const before = snapshotDigest(await projectSnapshot(root));
    expect(snapshotDigest(await projectSnapshot(root))).toBe(before);
    await writeFile(path.join(root, 'meet.ts'), 'export const meet = 1;');
    const added = snapshotDigest(await projectSnapshot(root));
    expect(added).not.toBe(before);
    await writeFile(path.join(root, 'meet.ts'), 'export const meet = 22;');
    expect(snapshotDigest(await projectSnapshot(root))).not.toBe(added);
  });

  it('packs only changed files with changedOnly', async () => {
    const root = await repo();
    await writeFile(path.join(root, 'src/a.ts'), 'export const a = 3;\n');
    const pack = await packProject({ root, outDir: tmp(), changedOnly: true, index: false });
    expect(pack.files).toEqual(['src/a.ts']);
    expect(path.basename(pack.file)).toMatch(/^reiner-transfer-\w+\.\d{8}-\d{6}\.zip\.docx$/);
  });
});
