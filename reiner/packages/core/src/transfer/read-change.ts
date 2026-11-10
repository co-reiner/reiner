/**
 * @file Reading a file the harness sent back: a unified diff, a ZIP of changed files (also saved by the
 * harness as `<name>.zip.docx`), or something that is not a patch at all, such as a real Word document.
 * @see {@link ../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { ChangeSet } from './apply.ts';
import { diffFiles } from './diff.ts';

/**
 * Entries Word adds when a harness saves a ZIP as a document. Dropped only from `*.zip.docx` (also a
 * renamed duplicate such as `x.zip 2.docx`): in a plain `.zip` they may be real project folders.
 */
const WORD_WRAPPER = /^(\[Content_Types\]\.xml|_rels\/|package\/|docProps\/)/i;
const SAVED_AS_DOCX = /\.zip( \d+)?\.docx$/i;
/** Reiner's own entries, never project files, in any ZIP: the pack index and `.reiner/` (except the list below). */
const REINER_OWN = /^(\.search\/|\.reiner\/)/;
/** The deleted-files list: `.reiner/deleted.txt` (what Reiner sends and asks for), or older names. */
const DELETE_LIST = /^(\.reiner\/deleted\.txt|(DELETED|DELETE|deleted|deletions)\.txt)$/;
/**
 * Office files are ZIPs too. Their main part tells a real document from a patch pack, whatever the
 * extension says: a `.docx` with `word/document.xml` is a Word document, not changed project files.
 */
const OFFICE_PARTS: [string, string][] = [
  ['word/document.xml', 'a Word document'],
  ['xl/workbook.xml', 'an Excel workbook'],
  ['ppt/presentation.xml', 'a PowerPoint presentation'],
];
const OFFICE_NAME = /\.(docx|docm|xlsx|xlsm|pptx|pptm)$/i;

const lines = (data: Uint8Array) =>
  new TextDecoder()
    .decode(data)
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\\/g, '/'))
    .filter((l) => l && !l.startsWith('#'));

/**
 * Read a received file: `.patch`/`.diff` text, a ZIP (also `.zip.docx`) of changed files, or a `document`
 * when it is not a patch (an Office file, or neither a ZIP nor a diff).
 */
export async function readChangeFile(file: string): Promise<ChangeSet> {
  const data = new Uint8Array(await readFile(file));
  const source = path.basename(file);
  const isZip = data[0] === 0x50 && data[1] === 0x4b;
  if (!isZip) {
    const diff = new TextDecoder().decode(data);
    if (!/^(diff --git |--- )/m.test(diff))
      return { kind: 'document', source, file, what: 'another kind of file' };
    return { kind: 'diff', source, diff, files: diffFiles(diff) };
  }
  const entries = unzipSync(data);
  if (OFFICE_NAME.test(source)) {
    const office = OFFICE_PARTS.find(([part]) => part in entries);
    if (office) return { kind: 'document', source, file, what: office[1] };
  }
  const wrapped = SAVED_AS_DOCX.test(source);
  const writes: { path: string; data: Uint8Array }[] = [];
  const deletes: string[] = [];
  for (const [name, content] of Object.entries(entries)) {
    const rel = name.replace(/\\/g, '/');
    if (rel.endsWith('/') || (wrapped && WORD_WRAPPER.test(rel))) continue;
    if (DELETE_LIST.test(rel)) {
      deletes.push(...lines(content));
      continue;
    }
    // Anything else under .reiner/ (e.g. a copied .reiner/pack.txt) or .search/ is Reiner's own.
    if (REINER_OWN.test(rel)) continue;
    // A delete script in the older convention: take the quoted paths after Remove-Item.
    if (/\.ps1$/i.test(rel) && /delete|remove/i.test(rel)) {
      for (const m of new TextDecoder().decode(content).matchAll(/Remove-Item\b[^'"\n]*['"]([^'"]+)['"]/gi))
        if (m[1]) deletes.push(m[1].replace(/\\/g, '/'));
      continue;
    }
    // A diff inside the ZIP is applied as a diff.
    if (/\.(patch|diff)$/i.test(rel) && Object.keys(entries).length <= 4) {
      const diff = new TextDecoder().decode(content);
      if (/^(diff --git |--- )/m.test(diff))
        return { kind: 'diff', source: `${source}:${rel}`, diff, files: diffFiles(diff) };
    }
    writes.push({ path: rel, data: content });
  }
  return { kind: 'files', source, writes, deletes };
}
