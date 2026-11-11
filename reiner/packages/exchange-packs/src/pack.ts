/**
 * @file Packing a project's shareable files into one `.zip.docx` for upload, with an optional search index.
 * @see {@link ../docs/packs.md#outbound-packs | File exchange: packs}
 * @see {@link ../docs/packs.md#why-it-works-this-way | File exchange: why it works this way}
 * @see {@link ../../harness-ms/docs/file-exchange.md#packs-zipdocx | Copilot file exchange: packs}
 * @see {@link ../docs/packs.md#keeping-the-project-current | File exchange: keeping the project current}
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { checkShareable, gitRepo, NO_GIT } from '@co-reiner/core';
import { zipSync } from 'fflate';
import { buildIndex } from './search-index.ts';

const exec = promisify(execFile);

/**
 * Packs a project's git-tracked files into one ZIP for upload to a harness, with an optional SQLite FTS5
 * search index under `.search/`. The layout matches `Pack-GitFiles.ps1 -AddIndex` (index schema 4,
 * manifest schema 3), so custom instructions written for that script work unchanged.
 */
export interface PackOptions {
  /** Project root: the folder whose files are packed. Paths in the ZIP are relative to it. */
  root: string;
  /** Folder to write the pack into. */
  outDir: string;
  /**
   * File name. A full pack defaults to `<root folder name>.zip.docx`: always the same name, so a harness
   * that stores uploads can replace the earlier copy instead of keeping every one. Other packs default to
   * `<root folder name>.<yyyymmdd-hhmmss>.zip.docx` (callers name part packs with `partPackName`).
   */
  fileName?: string;
  /** Only files changed against HEAD (staged, unstaged and untracked-but-not-ignored). */
  changedOnly?: boolean;
  /** Add the `.search/` index. Default true. */
  index?: boolean;
  /** Pack exactly these project-relative files instead of listing the project (used by tools). */
  files?: string[];
  /**
   * Files deleted since the pack this one builds on. Written into the pack as `.reiner/deleted.txt` (one path
   * per line; `.reiner/` is never a project file) and returned as `deleted`.
   */
  deletedList?: string[];
  /** For a part pack: the `made` stamp of the full pack it builds on, written into `.reiner/pack.txt`. */
  base?: string;
}

export interface PackResult {
  file: string;
  /** Archive-relative paths of the packed files (without `.search/`). */
  files: string[];
  /** Paths that changed but no longer exist, when `changedOnly` is set. */
  deleted: string[];
  indexed: number;
  bytes: number;
  /** Files left out by the share rules (see share.ts), with the reason. */
  refused: { path: string; reason: string }[];
  /**
   * Set for a full pack (the whole project, not `files` or `changedOnly`): the project's `projectDigest`
   * when it was packed, so the host can tell when the project has changed since.
   */
  digest?: string;
  /** Set for a full pack: each file's size and modified time then, to list what changed since. */
  snapshot?: ProjectSnapshot;
  /**
   * When the pack was made (`yyyymmdd-hhmmss`, local time), also written into it as `.reiner/pack.txt`. Packs
   * keep one name, so a chat can hold several uploads of it; this tells them apart.
   */
  made: string;
}

/**
 * The name of a part pack: what changed since the chat's full pack (or files sent again). Always the same
 * name, like the full pack, since the newest part holds everything the model needs on top of the full pack.
 */
export const partPackName = (project: string) => `${project}.part.zip.docx`;

/** Name of the project for pack and patch names: the root folder name. */
export const packBaseName = (root: string) => path.basename(path.resolve(root));

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

const nulList = (text: string) => text.split('\0').filter(Boolean);

/**
 * Files git knows under `root`, relative to it with `/` separators: tracked files plus new files git does not
 * ignore (so a file not added yet still reaches the harness), or with `changedOnly` those changed since HEAD.
 */
async function trackedFiles(root: string, changedOnly = false): Promise<string[]> {
  // ls-files run in root lists paths relative to it, also when root is a folder inside a larger repo.
  if (!changedOnly)
    return nulList(
      await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.']),
    );
  const untracked = nulList(await git(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', '.']));
  // A repo without commits has no HEAD: then everything staged counts as changed.
  const changed = await git(root, ['diff', '--name-only', '-z', '--relative', 'HEAD', '--', '.'])
    .then(nulList)
    .catch(async () => nulList(await git(root, ['ls-files', '-z', '--cached', '--', '.'])));
  return [...new Set([...changed, ...untracked])].sort();
}

/** The files a pack starts from: git's files. Outside a git repository nothing is packed (`NO_GIT`). */
async function projectFiles(root: string, changedOnly = false): Promise<string[]> {
  if (!(await gitRepo(root))) throw new Error(NO_GIT);
  return trackedFiles(root, changedOnly);
}

export type ProjectSnapshot = Record<string, string>;

export async function projectSnapshot(root: string): Promise<ProjectSnapshot> {
  const base = path.resolve(root);
  const snapshot: ProjectSnapshot = {};
  for (const file of [...new Set(await projectFiles(base))].sort()) {
    const info = await stat(path.join(base, ...file.split('/'))).catch(() => undefined);
    if (info) snapshot[file] = `${info.size}:${info.mtimeMs}`;
  }
  return snapshot;
}

export function snapshotDigest(snapshot: ProjectSnapshot): string {
  const hash = createHash('sha256');
  for (const [file, mark] of Object.entries(snapshot).sort(([a], [b]) => (a < b ? -1 : 1)))
    hash.update(`${file}\0${mark}\n`);
  return hash.digest('hex').slice(0, 16);
}

/** What changed between two snapshots: files added or modified, and files gone. */
export function snapshotChanges(
  before: ProjectSnapshot,
  now: ProjectSnapshot,
): { changed: string[]; deleted: string[] } {
  const changed = Object.keys(now).filter((f) => before[f] !== now[f]);
  const deleted = Object.keys(before).filter((f) => !(f in now));
  return { changed: changed.sort(), deleted: deleted.sort() };
}

export async function packProject(opts: PackOptions): Promise<PackResult> {
  const root = path.resolve(opts.root);
  // Local time, so the stamp matches the clock the user sees.
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  const whole = !opts.files && !opts.changedOnly;
  const fileName =
    opts.fileName ?? (whole ? `${packBaseName(root)}.zip.docx` : `${packBaseName(root)}.${stamp}.zip.docx`);
  // Taken before reading, so a file saved while packing counts as a change next time.
  const snapshot = whole ? await projectSnapshot(root) : undefined;
  const digest = snapshot ? snapshotDigest(snapshot) : undefined;
  // Once each: git lists a file in a merge conflict once per stage, and a caller's list may repeat one.
  const listed = [...new Set(opts.files ?? (await projectFiles(root, opts.changedOnly)))];
  const deleted: string[] = [...(opts.deletedList ?? [])];
  const present: string[] = [];
  for (const file of listed) {
    const info = await stat(path.join(root, ...file.split('/'))).catch(() => undefined);
    // A tracked file that is gone was deleted since HEAD; an explicitly asked-for one is refused below.
    if (!info && !opts.files) deleted.push(file);
    else present.push(file);
  }
  const check = await checkShareable(root, present);
  const entries: { file: string; data: Uint8Array }[] = [];
  for (const file of check.allowed) {
    entries.push({ file, data: new Uint8Array(await readFile(path.join(root, ...file.split('/')))) });
  }
  const zipEntries: Record<string, Uint8Array> = {};
  for (const e of entries) zipEntries[e.file] = e.data;
  const nl = String.fromCharCode(10);
  const marker = [
    `kind=${whole ? 'full' : 'part'}`,
    `made=${stamp}`,
    ...(opts.base ? [`base=${opts.base}`] : []),
  ];
  zipEntries['.reiner/pack.txt'] = new TextEncoder().encode(`${marker.join(nl)}${nl}`);
  if (opts.deletedList?.length)
    zipEntries['.reiner/deleted.txt'] = new TextEncoder().encode(
      `${opts.deletedList.join(String.fromCharCode(10))}${String.fromCharCode(10)}`,
    );
  let indexed = 0;
  if (opts.index !== false) {
    const index = await buildIndex(entries, fileName);
    zipEntries['.search/index.sqlite'] = index.db;
    zipEntries['.search/manifest.json'] = index.manifest;
    indexed = index.indexed;
  }
  const zipped = zipSync(zipEntries, { level: 6 });
  await mkdir(opts.outDir, { recursive: true });
  const file = path.join(opts.outDir, fileName);
  await writeFile(file, zipped);
  return {
    file,
    files: entries.map((e) => e.file),
    deleted,
    indexed,
    bytes: zipped.length,
    refused: check.refused,
    made: stamp,
    ...(digest ? { digest } : {}),
    ...(snapshot ? { snapshot } : {}),
  };
}
