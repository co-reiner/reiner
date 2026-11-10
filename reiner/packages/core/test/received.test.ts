/**
 * @file Tests reading received files: `.zip.docx` patches lose Word's wrapper, plain `.zip` patches keep every
 * entry, and real Office documents (or anything that is not a patch) come back as `document`.
 * @see {@link ../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { applyChangeSet, changedPaths, readChangeFile } from '../src/index.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'reiner-received-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const enc = (s: string) => new TextEncoder().encode(s);
const save = (name: string, entries: Record<string, Uint8Array>) => {
  const file = path.join(tmp(), name);
  writeFileSync(file, zipSync(entries));
  return file;
};
const wrapper = {
  '[Content_Types].xml': enc('<x/>'),
  '_rels/.rels': enc('<x/>'),
  'docProps/core.xml': enc('<x/>'),
};

describe('received files', () => {
  it('drops Word wrapper entries only from a .zip.docx patch (also a renamed duplicate)', async () => {
    for (const name of ['p.patch.001.zip.docx', 'p.patch.001.zip 2.docx']) {
      const set = await readChangeFile(save(name, { 'src/a.ts': enc('a'), ...wrapper }));
      expect(set.kind === 'files' && set.writes.map((w) => w.path)).toEqual(['src/a.ts']);
    }
  });

  it('keeps every entry of a plain .zip patch, even ones named like Word parts', async () => {
    const set = await readChangeFile(save('p.patch.002.zip', { 'src/a.ts': enc('a'), ...wrapper }));
    expect(set.kind === 'files' && set.writes.map((w) => w.path).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'src/a.ts'].sort(),
    );
  });

  it('reads a real Word, Excel or PowerPoint file as a document, never as changes', async () => {
    const cases: [string, string, string][] = [
      ['report.docx', 'word/document.xml', 'a Word document'],
      ['p.patch.003.zip.docx', 'word/document.xml', 'a Word document'],
      ['figures.xlsx', 'xl/workbook.xml', 'an Excel workbook'],
      ['deck.pptx', 'ppt/presentation.xml', 'a PowerPoint presentation'],
    ];
    for (const [name, part, what] of cases) {
      const file = save(name, { [part]: enc('<x/>'), 'word/styles.xml': enc('<x/>'), ...wrapper });
      const set = await readChangeFile(file);
      expect(set).toEqual({ kind: 'document', source: name, file, what });
      expect(changedPaths(set)).toEqual([]);
      await expect(applyChangeSet(tmp(), set)).rejects.toThrow(/not a patch/);
    }
  });

  it("applies a project's own word/ folder from a plain .zip", async () => {
    const set = await readChangeFile(save('p.patch.004.zip', { 'word/document.xml': enc('mine') }));
    expect(set.kind === 'files' && set.writes.map((w) => w.path)).toEqual(['word/document.xml']);
  });

  it('reads a file that is neither a ZIP nor a diff as a document', async () => {
    const file = path.join(tmp(), 'notes.pdf');
    writeFileSync(file, '%PDF-1.7');
    expect(await readChangeFile(file)).toEqual({
      kind: 'document',
      source: 'notes.pdf',
      file,
      what: 'another kind of file',
    });
  });
});
