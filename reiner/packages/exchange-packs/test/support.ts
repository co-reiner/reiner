/**
 * @file Test helper: a pack exchange on a temporary git project, with the host a harness would give it.
 * @see {@link ../../../docs/architecture/modules.md#file-exchange | Harness modules: file exchange}
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureReinerDir } from '@co-reiner/core';
import {
  createPackExchange,
  DIFF_MODE,
  type DownloadLinks,
  downloadMode,
  type PackExchange,
} from '../src/index.ts';

export const nl = String.fromCharCode(10);

/** What the tests reach besides the exchange: where its state and the project's config file are. */
export interface TestSession {
  paths: { modulesDir: string; configFile: string };
  exchange: PackExchange;
}

/**
 * A project in a new temporary folder (a git repository: nothing is shared from a folder without one) with
 * a pack exchange for a harness called "alpha". Its settings are read fresh from the project's config
 * file, as a real host reads them, so a test can change them by writing that file. `download` stands in for
 * the harness's page: what its `download` mode fetches.
 */
export async function setup(
  _harnesses = 1,
  download: DownloadLinks = async () => [],
): Promise<{ root: string; session: TestSession }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reiner-packs-'));
  execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true });
  const { paths } = await ensureReinerDir(root);
  const settings = async (): Promise<Record<string, unknown>> => {
    const text = await readFile(paths.configFile, 'utf8').catch(() => '');
    const config = text ? (JSON.parse(text) as { harnesses?: Record<string, Record<string, unknown>> }) : {};
    return config.harnesses?.alpha ?? {};
  };
  const exchange = createPackExchange({
    root,
    reinerDir: paths.reinerDir,
    stateDir: path.join(paths.modulesDir, 'alpha'),
    displayName: 'Alpha Harness',
    settings,
    support: { modes: [DIFF_MODE, downloadMode(download)], defaultMode: 'diff', index: true },
  });
  return {
    root,
    session: { paths: { modulesDir: paths.modulesDir, configFile: paths.configFile }, exchange },
  };
}

/** The exchange of a test project. */
export const exchangeOf = (session: TestSession): PackExchange => session.exchange;
