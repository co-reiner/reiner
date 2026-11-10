/**
 * @file Finding the project root and creating its `.reiner/` folder, kept out of git.
 * @see {@link ../../../docs/architecture/project-config.md#layout | Project configuration: layout}
 * @see {@link ../../../docs/architecture/project-config.md#git-ignore | Project configuration: git ignore}
 * @see {@link ../../../docs/architecture/project-config.md#security-notes | Project configuration: security notes}
 */
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const REINER_DIR = '.reiner';

export interface ProjectPaths {
  root: string;
  reinerDir: string;
  configFile: string;
  profilesDir: string;
  modulesDir: string;
  logsDir: string;
  sessionsDir: string;
}

/**
 * The project root is the nearest folder (from `start` upwards) that already has a `.reiner/` folder.
 * If none does, `start` itself becomes the project root. The home folder's `.reiner/` holds the global
 * config, so it does not make the home folder the project of everything below it: the home folder is only
 * a project root when Reiner is started in it.
 */
export function findProjectRoot(start: string = process.cwd(), home: string = os.homedir()): string {
  const first = path.resolve(start);
  const homeDir = path.resolve(home);
  let dir = first;
  for (;;) {
    if (dir !== homeDir && existsSync(path.join(dir, REINER_DIR))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return first;
    dir = parent;
  }
}

export function projectPaths(root: string): ProjectPaths {
  const reinerDir = path.join(root, REINER_DIR);
  return {
    root,
    reinerDir,
    configFile: path.join(reinerDir, 'config.jsonc'),
    profilesDir: path.join(reinerDir, 'profiles'),
    modulesDir: path.join(reinerDir, 'modules'),
    logsDir: path.join(reinerDir, 'logs'),
    sessionsDir: path.join(reinerDir, 'sessions'),
  };
}

export interface EnsureResult {
  paths: ProjectPaths;
  created: boolean;
  /** Set when `.reiner/` was added to `.git/info/exclude`. */
  gitExcluded: boolean;
  /** Set when `.reiner/.gitignore` was written (it was missing). */
  gitignoreWritten: boolean;
}

/**
 * `.reiner/.gitignore`, for users without a global ignore for `.reiner/`: everything private or generated
 * stays out of git even if the folder itself is not ignored. `config.jsonc` stays committable.
 */
export const REINER_GITIGNORE = `# Written by Reiner. Keeps private and generated files out of git, even without a global
# ignore for .reiner/. config.jsonc is safe to commit. Reiner never overwrites this file.
profiles/
modules/
incoming/
outgoing/
sessions/
logs/
`;

/**
 * Create `.reiner/` and its sub-folders, write its `.gitignore` if missing, and keep the folder out of git
 * if the project is a git repo.
 */
export async function ensureReinerDir(root: string): Promise<EnsureResult> {
  const paths = projectPaths(root);
  const created = !existsSync(paths.reinerDir);
  for (const dir of [
    paths.reinerDir,
    paths.profilesDir,
    paths.modulesDir,
    paths.logsDir,
    paths.sessionsDir,
  ]) {
    // 0o700: profiles hold live session cookies. Ignored on Windows.
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
  const gitignoreWritten = await writeGitignore(paths.reinerDir);
  const gitExcluded = await excludeFromGit(root);
  return { paths, created, gitExcluded, gitignoreWritten };
}

/** Write `.reiner/.gitignore` when it is missing; an existing one (perhaps edited) is left alone. */
async function writeGitignore(reinerDir: string): Promise<boolean> {
  const file = path.join(reinerDir, '.gitignore');
  if (existsSync(file)) return false;
  await writeFile(file, REINER_GITIGNORE, 'utf8');
  return true;
}

/**
 * The folder that holds this checkout's `info/exclude`. `.git` is a folder in a plain clone, and a file
 * (`gitdir: <path>`) in a linked worktree or a submodule; a worktree shares the main repository's `info/`,
 * named by its `commondir` file.
 */
async function gitCommonDir(root: string): Promise<string | undefined> {
  const dotGit = path.join(root, '.git');
  const info = await stat(dotGit).catch(() => undefined);
  if (!info) return undefined;
  if (info.isDirectory()) return dotGit;
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotGit, 'utf8'))?.[1];
  if (!pointer) return undefined;
  const gitDir = path.resolve(root, pointer);
  const common = await readFile(path.join(gitDir, 'commondir'), 'utf8').catch(() => undefined);
  return common ? path.resolve(gitDir, common.trim()) : gitDir;
}

async function excludeFromGit(root: string): Promise<boolean> {
  const gitDir = await gitCommonDir(root);
  if (!gitDir) return false;
  const gitignore = path.join(root, '.gitignore');
  if (existsSync(gitignore) && /^\/?\.reiner\/?\s*$/m.test(await readFile(gitignore, 'utf8'))) return false;
  const exclude = path.join(gitDir, 'info', 'exclude');
  const current = existsSync(exclude) ? await readFile(exclude, 'utf8') : '';
  if (/^\/?\.reiner\/?\s*$/m.test(current)) return false;
  await mkdir(path.dirname(exclude), { recursive: true });
  await appendFile(exclude, `${current.endsWith('\n') || current === '' ? '' : '\n'}.reiner/\n`);
  return true;
}
