/**
 * @file What may leave the machine. Every file Reiner uploads, in a pack or through a tool, passes here:
 * 1. Folder rule: it is a regular file inside the project, not under `.git/` or `.reiner/`, and reached
 *    without any symbolic link or junction (a link could point at an ignored or protected file).
 * 2. Git rule: nothing matched by `.gitignore` (or other git excludes), even if it is tracked.
 * Outside a git repository nothing is shared at all (fail closed): without git there are no ignore rules to
 * keep secrets such as `.env` out. An unexpected git error is thrown, never read as "no git".
 * @see {@link ../../../../docs/architecture/file-exchange.md#share-rules | File exchange: share rules}
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 */
import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { globToRegExp } from '../tools/glob.ts';
import { samePath } from './safe-path.ts';

export interface ShareCheck {
  allowed: string[];
  refused: { path: string; reason: string }[];
}

function git(cwd: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      // LC_ALL=C: git's messages in English, so "not a git repository" is recognised in any locale.
      { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** Why nothing is shared from a folder that is not in a git repository. */
export const NO_GIT =
  "Reiner shares files only from a git repository, so git's ignore rules keep private files (such as .env) out. Run git init in the project first.";

/**
 * The repo's top folder and this project's path inside it (`""` at the top), or undefined when the folder
 * is not in a git repository. Any other failure (git missing, a broken repo) is thrown, so callers fail
 * closed instead of treating it as "no git".
 */
export async function gitRepo(root: string): Promise<{ top: string; prefix: string } | undefined> {
  let out: string;
  try {
    // One git run: the top folder on the first line, the prefix (possibly empty) on the second.
    out = await git(root, ['rev-parse', '--show-toplevel', '--show-prefix']);
  } catch (error) {
    if (/not a git repository/i.test(String((error as Error).message))) return undefined;
    if ((error as { code?: string }).code === 'ENOENT')
      throw new Error('git is not installed or not on the PATH; Reiner needs it to decide what to share.');
    throw error;
  }
  const [top = '', prefix = ''] = out.split(/\r?\n/).map((l) => l.trim());
  if (!top) throw new Error(`git did not report the repository folder for ${root}.`);
  return { top: path.resolve(top), prefix };
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

/** Paths (relative to `root`) that git ignores, checked against the ignore rules even if tracked. */
async function ignoredByGit(root: string, files: string[]): Promise<Set<string>> {
  if (files.length === 0) return new Set();
  try {
    const out = await git(root, ['check-ignore', '--no-index', '-z', '--stdin'], `${files.join('\0')}\0`);
    return new Set(out.split('\0').filter(Boolean).map(norm));
  } catch (error) {
    // Exit code 1 means "nothing ignored".
    if ((error as { code?: number }).code === 1) return new Set();
    throw error;
  }
}

/**
 * Check paths against the share rules. `skipIgnore` leaves out the git rule only, for files the user's own
 * `include` patterns add back; the caller has already checked that the project is in git.
 */
export async function checkShareable(
  root: string,
  paths: string[],
  opts: { skipIgnore?: boolean } = {},
): Promise<ShareCheck> {
  const base = await realpath(path.resolve(root));
  const allowed: string[] = [];
  const refused: { path: string; reason: string }[] = [];
  /** The folder rule for one path: the normalised path when it passes, else the refusal. */
  const folderRule = async (raw: string): Promise<{ path: string; reason: string } | string> => {
    const rel = norm(raw.trim());
    if (!rel || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split('/').includes('..'))
      return { path: raw, reason: 'not a path inside the project' };
    // At any depth: a nested repository's `.git/` holds the same kind of secrets as the top one.
    const kept = rel.split('/').find((s) => ['.git', '.reiner'].includes(s.toLowerCase()));
    if (kept) return { path: rel, reason: `${kept.toLowerCase()}/ is never shared` };
    const full = path.join(base, ...rel.split('/'));
    const info = await lstat(full).catch(() => undefined);
    if (!info) return { path: rel, reason: 'no such file' };
    // Refuse every link, of the file or of a folder on the way: the rules below are checked against `rel`,
    // so the path must lead to the file itself.
    if (info.isSymbolicLink()) return { path: rel, reason: 'a symbolic link' };
    const real = await realpath(full).catch(() => undefined);
    if (!real || !samePath(path.relative(base, real), path.join(...rel.split('/'))))
      return { path: rel, reason: 'reached through a link' };
    if (!info.isFile()) return { path: rel, reason: 'not a file' };
    return rel;
  };
  // In batches: a large repo has thousands of files, and one at a time is slow on Windows.
  const candidates: string[] = [];
  for (let i = 0; i < paths.length; i += 64) {
    for (const r of await Promise.all(paths.slice(i, i + 64).map(folderRule))) {
      if (typeof r === 'string') candidates.push(r);
      else refused.push(r);
    }
  }
  if (opts.skipIgnore) return { allowed: candidates, refused };
  if (!(await gitRepo(root))) {
    refused.push(...candidates.map((rel) => ({ path: rel, reason: 'not in a git repository' })));
    return { allowed, refused };
  }
  const ignored = await ignoredByGit(root, candidates);
  for (const rel of candidates) {
    if (ignored.has(rel)) refused.push({ path: rel, reason: 'ignored by .gitignore' });
    else allowed.push(rel);
  }
  return { allowed, refused };
}

/**
 * Every file in the project that may be shared, relative to `root` with `/` separators: the list that
 * search tools (glob, grep) work from, so a git-ignored file is never even named to the harness.
 * - In a git repo: tracked files and untracked files that git does not ignore (`.gitignore` at every level,
 *   `.git/info/exclude`, the global excludes file), then the same checks as `checkShareable`, which also drop
 *   tracked files that an ignore rule matches now.
 * - Without git: an error (`NO_GIT`); nothing is listed.
 * Built fresh on each call, so an edited `.gitignore` counts at once.
 *
 * `filter` holds the user's own patterns (search tools only):
 * - `include` adds back files git ignores, tracked or not. The folder rule still applies, so nothing outside
 *   the project, in `.git/` or `.reiner/`, or reached through a link.
 * - `exclude` hides files, and wins over `include`.
 */
export interface FileFilter {
  include?: string[];
  exclude?: string[];
}

export async function shareableFiles(root: string, filter: FileFilter = {}): Promise<string[]> {
  if (!(await gitRepo(root))) throw new Error(NO_GIT);
  const listed = (
    await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'])
  )
    .split('\0')
    .filter(Boolean);
  const { allowed } = await checkShareable(root, [...new Set(listed)]);
  let files = allowed;
  const include = (filter.include ?? []).map(globToRegExp);
  if (include.length) {
    const have = new Set(allowed);
    // Untracked files git ignores, and tracked ones an ignore rule matches now (left out above).
    const ignored = (
      await git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', '.'])
    )
      .split('\0')
      .filter(Boolean);
    const wanted = [...new Set([...ignored, ...listed])].filter(
      (f) => !have.has(f) && include.some((re) => re.test(f)),
    );
    const extra = await checkShareable(root, wanted, { skipIgnore: true });
    files = [...allowed, ...extra.allowed];
  }
  const exclude = (filter.exclude ?? []).map(globToRegExp);
  if (exclude.length) files = files.filter((f) => !exclude.some((re) => re.test(f)));
  return [...new Set(files)].sort();
}
