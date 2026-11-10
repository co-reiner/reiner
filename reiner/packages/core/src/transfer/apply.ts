/**
 * @file Applying what a model sends back: a unified diff (from the reply or a `.patch` file), or a ZIP of
 * changed files with an optional `.reiner/deleted.txt`. Deleted files only ever go to the recycle bin. Every
 * path is checked to stay inside the project, and `.git/` and `.reiner/` are never touched. Callers ask the
 * user before calling `apply*`.
 * @see {@link ../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 * @see {@link ../../../../docs/architecture/file-exchange.md#share-rules | File exchange: share rules}
 * @see {@link ../../../exchange-packs/docs/packs.md#why-it-works-this-way | File exchange: why it works this way}
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkDiff, DELETE_HEADER, diffFiles, extractDeletions, splitDeletions } from './diff.ts';
import { safeTarget } from './safe-path.ts';
import { gitRepo } from './share.ts';
import { moveToTrash, type Trash } from './trash.ts';

export { readChangeFile } from './read-change.ts';
export { checkDiff, DELETE_HEADER, diffFiles, extractDeletions, safeTarget, splitDeletions };

/**
 * A change set ready to show the user and apply, or a received file that is not a patch at all (`document`:
 * a real Word, Excel or PowerPoint file, or anything else that is neither a ZIP nor a diff). A document is
 * never applied: it stays where it was saved, and the host offers to copy it into the project.
 */
export type ChangeSet =
  | { kind: 'diff'; source: string; diff: string; files: string[] }
  | { kind: 'files'; source: string; writes: { path: string; data: Uint8Array }[]; deletes: string[] }
  | { kind: 'document'; source: string; file: string; what: string };

/** Paths a change set touches, for showing the user. */
export function changedPaths(set: ChangeSet): { path: string; action: 'write' | 'delete' | 'patch' }[] {
  if (set.kind === 'document') return [];
  if (set.kind === 'diff') {
    // A file the diff deletes is shown as a deletion: it goes to the recycle bin, not through git apply.
    const deleted = new Set(splitDeletions(set.diff).deleted);
    return set.files.map((p) => ({ path: p, action: deleted.has(p) ? 'delete' : 'patch' }));
  }
  return [
    ...set.writes.map((w) => ({ path: w.path, action: 'write' as const })),
    ...set.deletes.map((d) => ({ path: d, action: 'delete' as const })),
  ];
}

const FENCE = /^(`{3,}|~{3,})[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;

/** Diff blocks in a markdown reply: fences tagged diff/patch, or untagged fences that hold a git diff. */
export function extractDiffs(markdown: string): string[] {
  const found: string[] = [];
  for (const m of markdown.matchAll(FENCE)) {
    const lang = (m[2] ?? '').toLowerCase();
    const body = m[3] ?? '';
    if (lang === 'diff' || lang === 'patch' || /^(diff --git |--- (a\/|\/dev\/null))/m.test(body)) {
      if (/^(diff --git |--- |\+\+\+ |@@ )/m.test(body)) found.push(body.endsWith('\n') ? body : `${body}\n`);
    }
  }
  return found;
}

function git(root: string, args: string[], input?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) =>
        err ? reject(new Error((stderr || err.message).trim())) : resolve({ stdout, stderr }),
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

/**
 * Check, then apply a unified diff with `git apply`. `--recount` tolerates the wrong hunk line counts
 * models often write. Files the diff deletes go to the recycle bin (`trash`), never deleted for good, and
 * only after the rest of the diff has passed `git apply --check`, so a rejected diff changes nothing.
 * `checkDiff` first refuses any diff whose names git would read differently from the ones checked here.
 */
export async function applyDiff(root: string, diff: string, trash: Trash = moveToTrash): Promise<string[]> {
  checkDiff(diff);
  for (const f of diffFiles(diff)) safeTarget(root, f);
  const { rest, deleted } = splitDeletions(diff);
  const hasRest = /^(diff --git |--- )/m.test(rest);
  // Inside a git repo, `git apply` reads paths from the repo's top and silently skips any outside the
  // current folder. So for a project in a sub-folder, run it at the top with the project's prefix.
  const repo = hasRest ? await gitRepo(root) : undefined;
  const cwd = repo ? repo.top : root;
  const args = [
    'apply',
    '--recount',
    '--whitespace=nowarn',
    ...(repo?.prefix ? [`--directory=${repo.prefix}`] : []),
  ];
  if (hasRest) await git(cwd, [...args, '--check', '-'], rest);
  if (deleted.length) await trashExisting(root, deleted, trash);
  if (hasRest) await git(cwd, [...args, '-'], rest);
  return [...(hasRest ? diffFiles(rest) : []), ...deleted];
}

/** Move the listed project files that exist to the recycle bin; missing ones are already gone. */
async function trashExisting(root: string, paths: string[], trash: Trash): Promise<void> {
  const targets = paths.map((p) => safeTarget(root, p)).filter((t) => existsSync(t));
  await trash(targets);
}

/**
 * Apply a change set: write files, and move deleted ones to the recycle bin (`trash`, the system's by
 * default). Every path is checked first, so a bad entry stops the set before anything changes.
 */
export async function applyChangeSet(
  root: string,
  set: ChangeSet,
  opts: { trash?: Trash } = {},
): Promise<string[]> {
  const trash = opts.trash ?? moveToTrash;
  if (set.kind === 'document') throw new Error(`${set.source} is ${set.what}, not a patch.`);
  if (set.kind === 'diff') return applyDiff(root, set.diff, trash);
  // Check every path first, so a bad entry stops the whole set before anything is written.
  const writes = set.writes.map((w) => ({ ...w, target: safeTarget(root, w.path) }));
  const deletes = set.deletes.map((d) => ({ path: d, target: safeTarget(root, d) }));
  for (const w of writes) {
    await mkdir(path.dirname(w.target), { recursive: true });
    await writeFile(w.target, w.data);
  }
  await trash(deletes.map((d) => d.target).filter((t) => existsSync(t)));
  return [...writes.map((w) => w.path), ...deletes.map((d) => d.path)];
}
