/**
 * @file Tests for finding the project folder, loading config and adding harnesses.
 * @see {@link ../../../docs/architecture/project-config.md | Project configuration and the .reiner/ folder}
 * @see {@link ../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: harnesses and the live browser}
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activeHarness,
  addHarnessToConfig,
  ensureReinerDir,
  findProjectRoot,
  harnessIds,
  loadConfig,
  REINER_GITIGNORE,
} from '../src/index.ts';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'reiner-test-'));

describe('project folder', () => {
  it('uses the start folder when no .reiner exists above it', async () => {
    const dir = await tmp();
    expect(findProjectRoot(dir)).toBe(path.resolve(dir));
  });

  it('finds the nearest ancestor with .reiner', async () => {
    const root = await tmp();
    const nested = path.join(root, 'a', 'b');
    await mkdir(path.join(root, '.reiner'), { recursive: true });
    await mkdir(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(path.resolve(root));
  });

  it('does not take the home folder as the project because of its global .reiner', async () => {
    const home = await tmp();
    const nested = path.join(home, 'code', 'new');
    await mkdir(path.join(home, '.reiner'), { recursive: true });
    await mkdir(nested, { recursive: true });
    expect(findProjectRoot(nested, home)).toBe(path.resolve(nested));
    expect(findProjectRoot(home, home)).toBe(path.resolve(home));
  });

  it('excludes .reiner through the .git file of a linked worktree', async () => {
    const main = await tmp();
    const root = await tmp();
    const gitDir = path.join(main, '.git', 'worktrees', 'w');
    await mkdir(gitDir, { recursive: true });
    await writeFile(path.join(gitDir, 'commondir'), '../..\n');
    await writeFile(path.join(root, '.git'), `gitdir: ${gitDir}\n`);
    await ensureReinerDir(root);
    expect(await readFile(path.join(main, '.git', 'info', 'exclude'), 'utf8')).toContain('.reiner/');
  });

  it('creates .reiner and excludes it from git once', async () => {
    const root = await tmp();
    await mkdir(path.join(root, '.git', 'info'), { recursive: true });
    const first = await ensureReinerDir(root);
    const second = await ensureReinerDir(root);
    expect(first.created).toBe(true);
    expect(first.gitExcluded).toBe(true);
    expect(second.gitExcluded).toBe(false);
    expect(existsSync(first.paths.profilesDir)).toBe(true);
    const exclude = await readFile(path.join(root, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.match(/\.reiner\//g)?.length).toBe(1);
  });

  it('writes .reiner/.gitignore once and never overwrites it', async () => {
    const root = await tmp();
    const first = await ensureReinerDir(root);
    const file = path.join(root, '.reiner', '.gitignore');
    expect(first.gitignoreWritten).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(REINER_GITIGNORE);
    const edited = ['profiles/', '# mine', ''].join(String.fromCharCode(10));
    await writeFile(file, edited);
    expect((await ensureReinerDir(root)).gitignoreWritten).toBe(false);
    expect(await readFile(file, 'utf8')).toBe(edited);
  });

  it('keeps private and transferred files out of git without any other ignore', async () => {
    const root = await tmp();
    execFileSync('git', ['init', '-q'], { cwd: root });
    // No global ignore and no exclude: only .reiner/.gitignore is left to do the work.
    execFileSync('git', ['config', 'core.excludesFile', ''], { cwd: root });
    await ensureReinerDir(root);
    await writeFile(path.join(root, '.git', 'info', 'exclude'), '');
    const files = [
      'profiles/p/Cookies',
      'incoming/a.patch',
      'outgoing/a.zip.docx',
      'logs/reiner.log',
      'config.jsonc',
    ];
    for (const f of files) {
      await mkdir(path.dirname(path.join(root, '.reiner', f)), { recursive: true });
      await writeFile(path.join(root, '.reiner', f), 'x');
    }
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(untracked.split(/\r?\n/).filter(Boolean).sort()).toEqual([
      '.reiner/.gitignore',
      '.reiner/config.jsonc',
    ]);
  });
});

const noGlobal = () => path.join(os.tmpdir(), 'reiner-no-global', 'config.jsonc');

describe('config', () => {
  it('writes a project config for a harness and loads it', async () => {
    const root = await tmp();
    const file = path.join(root, 'config.jsonc');
    await addHarnessToConfig(file, 'm365-copilot', { url: 'https://example.test/chat' });
    const config = await loadConfig(file, noGlobal());
    expect(config.harnesses).toEqual({ 'm365-copilot': { url: 'https://example.test/chat' } });
    expect(activeHarness(config)).toBe('m365-copilot');
    expect(config.browser).toEqual({ channel: 'auto', headless: false, keepOpen: false, keepSession: false });
  });

  it('adds a second harness, makes it the default and keeps comments', async () => {
    const root = await tmp();
    const file = path.join(root, 'config.jsonc');
    await addHarnessToConfig(file, 'm365-copilot');
    await addHarnessToConfig(file, 'gemini', { url: 'https://gemini.test' });
    const config = await loadConfig(file, noGlobal());
    expect(harnessIds(config)).toEqual(['m365-copilot', 'gemini']);
    expect(config.harnesses.gemini).toEqual({ url: 'https://gemini.test' });
    expect(config.defaultHarness).toBe('gemini');
    expect(await readFile(file, 'utf8')).toContain('// Reiner project config');
    // Adding one that is already there keeps its settings.
    await addHarnessToConfig(file, 'gemini', { url: 'https://other.test' });
    expect((await loadConfig(file, noGlobal())).harnesses.gemini).toEqual({ url: 'https://gemini.test' });
  });

  it('rejects an invalid browser channel', async () => {
    const root = await tmp();
    const file = path.join(root, 'config.jsonc');
    await writeFile(file, '{ "browser": { "channel": "firefox" } }');
    await expect(loadConfig(file, noGlobal())).rejects.toThrow();
  });
});
