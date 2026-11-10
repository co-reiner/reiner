/**
 * @file Tests chat in the TUI: sending, streaming, Esc to stop, the transcript and reopening the last chat.
 * @see {@link ../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 * @see {@link ../../../docs/architecture/cli-ux.md#startup | CLI and TUI: startup}
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeState } from '@co-reiner/core';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/tui/App.tsx';
import { setup, tick, typeAndEnter, until } from './support/tui.ts';

describe('chat', () => {
  it('sends a prompt, shows the reply as rendered markdown, and saves a transcript', async () => {
    const { a, session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, 'say hi');
    await until(() => frames.join('\n').includes('You said: say hi'));
    const output = frames.join('\n');
    expect(a.calls).toContain('send:say hi');
    expect(output).toContain('● Alpha Harness · Fake Model · 1.2s');
    expect(output).toContain('Hello');
    expect(output).not.toContain('# Hello'); // rendered, not raw markdown
    const transcript = () => readFile(session.transcript.file, 'utf8').catch(() => '');
    await until(async () => (await transcript()).trim().split(/\r?\n/).length >= 2);
    const lines = (await transcript())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.role)).toEqual(['user', 'assistant']);
    expect(lines[1].text).toContain('You said: say hi');
  });

  it('says what a turn cancelled before sending left behind, and prints no reply', async () => {
    const { session } = await setup(1);
    const module = session.module;
    if (!module) throw new Error('no module');
    const left = 'pack.zip.docx had already been uploaded: it stays in the uploads, unused.';
    module.send = async () => ({ markdown: '', stopped: true, notSent: true, notes: [left], elapsedMs: 5 });
    const { stdin, frames, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, 'look at this');
    await until(() => frames.join('\n').includes('Cancelled before the prompt reached Alpha Harness'));
    const output = frames.join('\n').replace(/\s+/g, ' ');
    expect(output).toContain(left);
    // No reply entry is left on screen: nothing came back.
    expect(lastFrame() ?? '').not.toContain('● Alpha Harness ·');
  });

  it('Esc stops a reply that is being written', async () => {
    const { a, session } = await setup(1, true);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, 'write a lot');
    expect(frames.join('\n')).toContain('writing…');
    // Wait until the prompt has gone to the harness: Esc before that cancels the turn instead.
    await until(() => a.calls.includes('send:write a lot'));
    stdin.write('\u001B');
    await until(() => frames.join('\n').includes('· stopped'));
    expect(a.calls).toContain('stopGenerating');
    expect(frames.join('\n')).toContain('· stopped');
  });

  it('/new starts a new chat', async () => {
    const { a, session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/new');
    expect(a.calls).toContain('newChat');
    expect(frames.join('\n')).toContain('New chat started in Alpha Harness');
  });
});

describe('streaming a long reply', () => {
  it('keeps the live area shorter than the window and shows only the newest lines', async () => {
    const { session } = await setup(1, true);
    const { stdin, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, 'write a lot');
    await until(() => (lastFrame() ?? '').includes('lines above'));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Line 80 of a long reply.');
    expect(frame).not.toContain('Line 1 of a long reply.');
    // Only the live part (from the reply header down) has to fit the window; earlier output is already
    // printed. The test terminal reports no size, so the 24-row fallback applies.
    const live = frame.slice(frame.lastIndexOf('● Alpha Harness · writing'));
    expect(live.split(/\r?\n/).length).toBeLessThan(24);
    stdin.write(String.fromCharCode(27)); // Esc stops the reply, so the test ends
  });
});

describe('chat history', () => {
  it('reopens the last chat on start and shows its latest turns', async () => {
    const { a, session } = await setup(1);
    await session.rememberOpenChat({ id: 'c-story', title: 'Lighthouse story' });
    const { frames } = render(<App session={session} />);
    await until(() => frames.join('\n').includes('end of history'));
    expect(a.calls).toContain('openChat:c-story');
    const output = frames.join('\n');
    expect(output).toContain('Last 3 turns of "Lighthouse story"');
    expect(output).toContain('> Third question in c-story');
    expect(output).toContain('Second answer.');
    // The chat keeps its own model; Reiner only says it differs from the project's.
    expect(output.replace(/\s+/g, ' ')).toContain(
      "This chat uses Quick response; the project's model is GPT-5 Think deeper.",
    );
  });

  it('starts on a new chat when there is no last chat', async () => {
    const { a, session } = await setup(1);
    const { frames } = render(<App session={session} />);
    await until(() => frames.join('\n').includes('is open and signed in'));
    expect(a.calls.some((c) => c.startsWith('openChat'))).toBe(false);
  });

  it('remembers the chat opened with /chat for the next start', async () => {
    const { session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/chat c-story');
    await until(() => frames.join('\n').includes('end of history'));
    await until(async () => (await session.lastOpenChat())?.id === 'c-story');
    expect((await session.lastOpenChat())?.id).toBe('c-story');
    expect(frames.join('\n').replace(/\s+/g, ' ')).toContain("Reiner keeps the chat's model");
  });

  it('/history shows the requested number of turns', async () => {
    const { session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/history 2');
    await until(() => frames.join('\n').includes('end of history'));
    const output = frames.join('\n');
    expect(output).toContain('Last 2 turns');
    expect(output).not.toContain('First question');
  });
});

describe('sign-in badge', () => {
  it('follows the sign-in the harness saved during a command, not only the one from start', async () => {
    const { root, session } = await setup(1);
    const stateDir = path.join(root, '.reiner', 'modules', 'alpha');
    const checkedAt = new Date().toISOString();
    await writeState(stateDir, 'signin', { signedIn: false, checkedAt, reason: 'Timed out.' });
    const { stdin, lastFrame } = render(<App session={session} autoStart={false} />);
    await until(() => (lastFrame() ?? '').includes('● not signed in'));
    // The user signed in after start; the next harness call checks again and saves it.
    await writeState(stateDir, 'signin', { signedIn: true, checkedAt });
    await typeAndEnter(stdin, '/chats');
    await until(() => (lastFrame() ?? '').includes('● signed in'));
    expect(lastFrame()).not.toContain('not signed in');
  });
});

describe('console', () => {
  it('prints no React warning when a reply is added to the transcript', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { session } = await setup(1);
      const { stdin, frames } = render(<App session={session} autoStart={false} />);
      await tick();
      await typeAndEnter(stdin, 'hello');
      await until(() => frames.join(String.fromCharCode(10)).includes('You said: hello'));
      expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});
