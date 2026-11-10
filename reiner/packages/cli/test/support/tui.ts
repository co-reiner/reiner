/**
 * @file Test helpers: a temporary project with fake harnesses, key codes, typing and polling.
 * @see {@link ../../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 * @see {@link ../../../../docs/architecture/cli-ux.md#startup | CLI and TUI: startup}
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openSession } from '../../src/session.ts';
import { fakeHarness } from './fake-harness.ts';

export const UP = '\u001B[A';
export const DOWN = '\u001B[B';
export const nl = String.fromCharCode(10);
export const tmp = () => mkdtemp(path.join(os.tmpdir(), 'reiner-tui-'));
export const noGlobal = path.join(os.tmpdir(), 'reiner-no-global', 'config.jsonc');
export const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/** Poll until `check` passes (up to 8 s), so slower file I/O on Windows does not make tests flaky. */
export async function until(check: () => boolean | Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end && !(await check())) await tick(25);
}

/**
 * A project in a new temporary folder (a git repository: Reiner shares nothing from a folder without one)
 * with one or two fake harnesses installed.
 */
export async function setup(harnessCount = 1, slow = false) {
  const a = fakeHarness('alpha', 'Alpha Harness', slow);
  const b = fakeHarness('beta', 'Beta Harness');
  const registry = [a.entry, b.entry].slice(0, harnessCount);
  const root = await tmp();
  execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true });
  const session = await openSession(root, { registry, globalConfigFile: noGlobal });
  return { a, b, root, session };
}

export async function typeAndEnter(stdin: { write(s: string): void }, text: string) {
  stdin.write(text);
  await tick();
  stdin.write('\r');
  await tick();
  await tick();
}
