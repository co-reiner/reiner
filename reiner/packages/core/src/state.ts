/**
 * @file Reading and writing a module's small JSON state files in `.reiner/modules/<id>/`.
 * @see {@link ../../../docs/architecture/project-config.md#layout | Project configuration: layout}
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Small JSON files a module keeps between runs, e.g. last sign-in check or last model list. */
export async function readState<T>(stateDir: string, name: string): Promise<T | undefined> {
  const file = path.join(stateDir, `${name}.json`);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function writeState(stateDir: string, name: string, value: unknown): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  // Written beside the file, then moved over it: a crash mid-write cannot leave half a file, which would
  // read back as "no state".
  const file = path.join(stateDir, `${name}.json`);
  const draft = `${file}.${process.pid}.tmp`;
  await writeFile(draft, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(draft, file);
}
