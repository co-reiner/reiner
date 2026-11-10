/**
 * @file Tests what happens to a received file that is not a patch: reported, kept, and copied into the
 * project root only after a "y", never over an existing file.
 * @see {@link ../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChangeSet, OutputEntry } from '@co-reiner/core';
import { afterEach, describe, expect, it } from 'vitest';
import { offerChanges } from '../src/tui/commands/shared.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A project with a received Word document in .reiner/incoming/, and a stand-in for the TUI. */
function setup(answer: boolean) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reiner-docs-'));
  dirs.push(root);
  const incoming = path.join(root, '.reiner', 'incoming');
  mkdirSync(incoming, { recursive: true });
  const file = path.join(incoming, 'report.docx');
  writeFileSync(file, 'word');
  const printed: OutputEntry[] = [];
  const asked: string[] = [];
  let advanced = 0;
  const api = {
    session: { root, transcript: { append: async () => {} } },
    print: (e: OutputEntry) => printed.push(e),
    busy: () => {},
    confirm: async (q: string) => {
      asked.push(q);
      return answer;
    },
    transfer: { advance: async () => void advanced++ },
  } as unknown as Parameters<typeof offerChanges>[0];
  const doc: ChangeSet = { kind: 'document', source: 'report.docx', file, what: 'a Word document' };
  return { root, file, api, doc, printed, asked, advanced: () => advanced };
}

const texts = (printed: OutputEntry[]) => printed.map((e) => ('text' in e ? e.text : '')).join('\n');

describe('received documents', () => {
  it('says what arrived and where, and copies it to the project root after a yes', async () => {
    const t = setup(true);
    await offerChanges(t.api, [t.doc], []);
    expect(texts(t.printed)).toContain('report.docx is a Word document, not a patch');
    expect(texts(t.printed)).toContain('saved as .reiner/incoming/report.docx');
    expect(t.asked).toEqual(['Save report.docx to the project root as report.docx?']);
    expect(readFileSync(path.join(t.root, 'report.docx'), 'utf8')).toBe('word');
    expect(t.advanced()).toBe(0); // not a patch: the patch number stays
  });

  it('never overwrites: a taken name gets a number', async () => {
    const t = setup(true);
    writeFileSync(path.join(t.root, 'report.docx'), 'mine');
    await offerChanges(t.api, [t.doc], []);
    expect(t.asked).toEqual(['Save report.docx to the project root as report (2).docx?']);
    expect(readFileSync(path.join(t.root, 'report.docx'), 'utf8')).toBe('mine');
    expect(existsSync(path.join(t.root, 'report (2).docx'))).toBe(true);
  });

  it('keeps it only in .reiner/incoming/ after a no', async () => {
    const t = setup(false);
    await offerChanges(t.api, [t.doc], []);
    expect(existsSync(path.join(t.root, 'report.docx'))).toBe(false);
    expect(existsSync(t.file)).toBe(true);
    expect(texts(t.printed)).toContain('Not saved. It stays in .reiner/incoming/report.docx.');
  });
});
