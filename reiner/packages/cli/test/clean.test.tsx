/**
 * @file Tests ticking options in a pick list with the keyboard, `/transfer clean`, and the sync warning after `/transfer <mode>` in the TUI.
 * @see {@link ../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 * @see {@link ../../harness-ms/docs/commands.md#transfer-clean | Copilot's slash commands: /transfer clean}
 */
import path from 'node:path';
import type { Key } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { App } from '../src/tui/App.tsx';
import { type PickQuestion, pickKey } from '../src/tui/pick.ts';
import { DOWN, nl, setup, tick, typeAndEnter, until } from './support/tui.ts';

const key = (k: Partial<Key>) => k as Key;

function question(answers: number[][]): PickQuestion {
  return {
    kind: 'pick',
    text: 'Pick',
    options: [{ label: 'one' }, { label: 'two' }, { label: 'three' }],
    cursor: 0,
    ticked: [],
    answer: (chosen) => answers.push(chosen),
  };
}

describe('pick list keys', () => {
  it('ticks all from "(Select all)" or with a, and unticks all again', () => {
    const q = question([]);
    const all = pickKey(q, ' ', key({}));
    expect(all?.ticked).toEqual([0, 1, 2]);
    expect(pickKey({ ...q, ticked: [0, 1, 2] }, 'a', key({}))?.ticked).toEqual([]);
    expect(pickKey({ ...q, ticked: [1] }, 'a', key({}))?.ticked).toEqual([0, 1, 2]);
  });

  it('moves with the arrows (wrapping) and ticks single rows', () => {
    const q = question([]);
    const down = pickKey(q, '', key({ downArrow: true }));
    expect(down?.cursor).toBe(1);
    expect(pickKey(q, '', key({ upArrow: true }))?.cursor).toBe(3);
    const ticked = pickKey({ ...q, cursor: 2 }, ' ', key({}));
    expect(ticked?.ticked).toEqual([1]);
    expect(pickKey({ ...q, cursor: 2, ticked: [1] }, ' ', key({}))?.ticked).toEqual([]);
  });

  it('answers with the ticked rows on Enter, and with none on Esc', () => {
    const answers: number[][] = [];
    pickKey({ ...question(answers), ticked: [0, 2] }, '', key({ return: true }));
    pickKey({ ...question(answers), ticked: [0, 2] }, '', key({ escape: true }));
    expect(answers).toEqual([[0, 2], []]);
  });
});

describe('/transfer clean', () => {
  it("lists only this project's packs, and (Select all) removes them all", async () => {
    const { session, a, root } = await setup(1);
    const p = path.basename(root);
    const { stdin, frames, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/transfer clean');
    await until(() => (lastFrame() ?? '').includes('(Select all)'));
    const list = lastFrame() ?? '';
    for (const n of [`${p}.zip.docx`, `${p}.part.001.zip.docx`, `${p}.zip 2.docx`]) expect(list).toContain(n);
    expect(list).toContain('an older full pack');
    expect(list).not.toContain('other-project');
    stdin.write('a');
    await tick();
    stdin.write('\r');
    await until(() => frames.join(nl).includes('Moved 4 files to the OneDrive recycle bin'));
    expect(a.uploads).toEqual(['other-project.zip.docx']);
  });

  it('removes only the ticked files, and nothing on Esc', async () => {
    const { session, a, root } = await setup(1);
    const p = path.basename(root);
    const { stdin, frames, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/transfer clean');
    await until(() => (lastFrame() ?? '').includes('(Select all)'));
    // Rows are sorted; the first file is the older stamped full pack.
    stdin.write(DOWN);
    await tick();
    stdin.write(' ');
    await tick();
    stdin.write('\r');
    await until(() => frames.join(nl).includes('Moved 1 file to the OneDrive recycle bin'));
    expect(a.calls).toContain(`remove-uploads:${p}.20261110-095636.zip.docx`);
    await typeAndEnter(stdin, '/transfer clean');
    await until(() => (lastFrame() ?? '').includes('(Select all)'));
    stdin.write('\u001B');
    await until(() => frames.join(nl).includes('Nothing removed.'));
    expect(a.calls.filter((c) => c.startsWith('remove-uploads')).length).toBe(1);
  });
});

describe('/transfer <mode>', () => {
  it('warns that the saved instructions need /instructions sync for the new mode', async () => {
    const { session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/transfer download');
    await until(() => frames.join(nl).includes('Changes now come back as'));
    // The TUI wraps long lines, so compare with the line breaks and frame padding taken out.
    const out = (frames.at(-1) ?? '').replace(/\s+/g, ' ');
    expect(out).toContain('⚠');
    expect(out).toContain('run /instructions sync to update them for the download mode');
  });
});
