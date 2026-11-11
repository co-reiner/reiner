/**
 * @file Tests for the instruction sections: plain text, a heading to a line of dashes, the user's text kept.
 * @see {@link ../docs/packs.md#instructions-and-sections | File exchange: instructions and sections}
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildSections,
  DIFF_MODE,
  downloadMode,
  promptFacts,
  renderSections,
  sectionIds,
  setSections,
  type TransferMode,
} from '../src/index.ts';

/** A mode of a harness's own, as Copilot's `onedrive` is: its text is all this package needs to know. */
const FILE_MODE: TransferMode = {
  id: 'file',
  label: 'patch saved as a file',
  description: 'The model saves a patch as a file.',
  instructions: ['Create NAME.patch.NUMBER.zip.docx as a file for me and name it in your reply.'],
};

describe('instruction sections', () => {
  it('ends each section with a line of dashes and leaves the index out when off', () => {
    const on = renderSections(buildSections({ mode: DIFF_MODE, index: true }));
    const off = renderSections(buildSections({ mode: DIFF_MODE, index: false }));
    expect(sectionIds(on)).toEqual(['files', 'tools', 'index', 'transfer']);
    expect(sectionIds(off)).toEqual(['files', 'tools', 'transfer']);
    expect(on).toContain('## Pack search index');
    // Four sections, four closing lines, and no line of dashes inside any of them.
    expect(on.split('\n').filter((l) => l === '---')).toHaveLength(4);
    expect(on.split('\n').filter((l) => l.includes('---') && l !== '---')).toEqual([]);
  });
});

describe('the wording of the sections', () => {
  it('is, word for word, the text Copilot accepted', () => {
    // Copilot refuses instructions that read like an attempt to take over the model, and what trips it is
    // not obvious. This wording was saved successfully on 2026-11-12: change it only with a live check.
    const accepted = readFileSync(new URL('./fixtures/accepted-instructions.txt', import.meta.url), 'utf8');
    const made = renderSections(buildSections({ mode: downloadMode(async () => []), index: true }));
    // The fixture may be checked out with Windows line endings.
    expect(made).toBe(accepted.split(String.fromCharCode(13)).join(''));
  });

  it('replaces sections saved under the earlier headings', () => {
    const old = [
      'mine',
      '',
      '## Reiner tools',
      'old text',
      '---',
      '',
      '## Reiner reply format',
      'older',
      '---',
      '',
    ].join(String.fromCharCode(10));
    expect(sectionIds(old)).toEqual(['tools', 'transfer']);
    const next = setSections(old, buildSections({ mode: DIFF_MODE, index: false }));
    expect(next).not.toContain('## Reiner');
    expect(next).not.toContain('old text');
    expect(sectionIds(next)).toEqual(['files', 'tools', 'transfer']);
    expect(setSections(next, []).trim()).toBe('mine');
  });

  it('describes the context line and asks for a To delete block, without naming a deleted-files list', () => {
    const text = renderSections(buildSections({ mode: DIFF_MODE, index: true }));
    expect(text).toContain('[Precise] project=NAME');
    expect(text).toContain('#To delete (only to a bin):');
    // The wording a harness refused: no deleted-files list is named anywhere.
    expect(text).not.toContain('deleted.txt');
    expect(text).not.toContain('[Reiner]');
    expect(promptFacts({ project: 'demo', sequence: '004' })).toBe('[Precise] project=demo next-patch=004');
  });
});

describe('what a section may hold, and replacing sections', () => {
  it('is plain text: no tags, no comment markers, no code fences', () => {
    const text = renderSections(buildSections({ mode: DIFF_MODE, index: true }));
    for (const mark of ['<', '>', '<!--', '```']) expect(text).not.toContain(mark);
  });

  it('refuses a section that holds a line of dashes, which would end it early', () => {
    const broken = { ...FILE_MODE, instructions: ['First.', '---', 'Second.'] };
    expect(() => renderSections(buildSections({ mode: broken, index: false }))).toThrow(/dashes/);
  });

  it('replaces sections saved in the earlier comment-marker form', () => {
    const old = [
      'mine',
      '',
      '<!-- reiner:begin tools -->',
      '## Reiner tools',
      'old text',
      '<!-- reiner:end tools -->',
      '',
    ].join('\n');
    expect(sectionIds(old)).toEqual(['tools']);
    const next = setSections(old, buildSections({ mode: DIFF_MODE, index: false }));
    expect(next).not.toContain('reiner:begin');
    expect(next).not.toContain('old text');
    expect(next.startsWith('mine')).toBe(true);
    expect(sectionIds(next)).toEqual(['files', 'tools', 'transfer']);
    expect(setSections(next, []).trim()).toBe('mine');
  });

  it("leaves the user's own blank lines alone", () => {
    const user = 'mine\n\n\n\ncode\n';
    const added = setSections(user, buildSections({ mode: DIFF_MODE, index: false }));
    expect(added.startsWith(user)).toBe(true);
    const tail = '\n\n\nmore of mine\n';
    expect(setSections(`${added}${tail}`, []).includes('mine\n\n\n\ncode')).toBe(true);
  });

  it("replaces only Reiner sections and keeps the user's text around them", () => {
    const user = '## My rules\n\nUse Australian English.\n';
    const first = setSections(user, buildSections({ mode: DIFF_MODE, index: true }));
    expect(first.startsWith(user)).toBe(true);
    const second = setSections(
      `${first}\n## More of mine\nKeep it short.\n`,
      buildSections({ mode: FILE_MODE, index: false }),
    );
    expect(second.startsWith(user)).toBe(true);
    expect(second).toContain('## More of mine\nKeep it short.');
    expect(sectionIds(second)).toEqual(['files', 'tools', 'transfer']);
    expect(second).toContain('NAME.patch.NUMBER.zip.docx as a file');
    expect(second).not.toContain('labelled `diff`');
    const removed = setSections(second, []);
    expect(sectionIds(removed)).toEqual([]);
    expect(removed).toContain('Use Australian English.');
    expect(removed).toContain('Keep it short.');
  });
});

describe('download mode', () => {
  const ctx = { project: 'app', incomingDir: 'in' };
  const reply = (downloads?: string[]) => ({
    markdown: '',
    stopped: false,
    elapsedMs: 0,
    ...(downloads ? { downloads } : {}),
  });

  it('downloads the files a reply listed, asks for nothing when it listed none', async () => {
    const asked: (string[] | undefined)[] = [];
    const mode = downloadMode(async (_dir, opts) => {
      asked.push(opts.names);
      return [];
    });
    await mode.collect?.(reply(['app.patch.001.patch']), ctx);
    await mode.collect?.(reply([]), ctx);
    expect(asked).toEqual([['app.patch.001.patch']]);
  });

  it('takes whatever the page offers for a reply read back from the history (no list)', async () => {
    const asked: (string[] | undefined)[] = [];
    const mode = downloadMode(async (_dir, opts) => {
      asked.push(opts.names);
      return ['in/app.patch.001.zip 3.docx'];
    });
    expect((await mode.collect?.(reply(), ctx))?.files).toEqual(['in/app.patch.001.zip 3.docx']);
    expect(asked).toEqual([undefined]);
  });
});
