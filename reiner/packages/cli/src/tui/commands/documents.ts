/**
 * @file Received files that are not patches (a real Word document, say): kept where they were saved, reported,
 * and copied into the project only after a "y".
 * @see {@link ../../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSet } from '@co-reiner/core';
import type { ChangeDeps } from './shared.ts';

type Document = Extract<ChangeSet, { kind: 'document' }>;

/** A name in `dir` that is not taken yet: `report.docx`, else `report (2).docx`, `report (3).docx`, … */
export function freeName(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; existsSync(path.join(dir, candidate)); i++) candidate = `${stem} (${i})${ext}`;
  return candidate;
}

/** Say what arrived and where it is, then offer to copy it to the project root (never over a file). */
export async function offerDocument(api: ChangeDeps, doc: Document): Promise<void> {
  const root = api.session.root;
  const where = path.relative(root, doc.file).split(path.sep).join('/');
  api.print({
    kind: 'warning',
    text: `${doc.source} is ${doc.what}, not a patch: nothing to apply. It is saved as ${where}. If you asked for changes, ask the model again for the ZIP of changed files.`,
  });
  api.busy(null);
  const target = freeName(root, doc.source);
  if (!(await api.confirm(`Save ${doc.source} to the project root as ${target}?`))) {
    api.print({ kind: 'info', text: `Not saved. It stays in ${where}.` });
    return;
  }
  await copyFile(doc.file, path.join(root, target));
  api.print({ kind: 'success', text: `Saved ${target} in the project root.` });
  void api.session.transcript.append({ role: 'event', text: `saved received file ${target}` });
}
