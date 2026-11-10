/**
 * @file Tests the chat commands and `/instructions` in the TUI, against a fake chat harness.
 * @see {@link ../../harness-ms/docs/commands.md#yn-questions-and-keep | Copilot's slash commands: y/N questions and (Keep)}
 * @see {@link ../../exchange-packs/docs/packs.md#where-the-sections-live | File exchange: where the sections live}
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { readState } from '@co-reiner/core';
import { sectionIds } from '@co-reiner/exchange-packs';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { App } from '../src/tui/App.tsx';
import { setup, tick, typeAndEnter, until } from './support/tui.ts';

describe('chats', () => {
  it('/chats lists recent chats with numbers and marks the open one', async () => {
    const { session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/chats');
    const output = frames.join('\n');
    expect(output).toContain(' 1. Large Chat Test (Keep)');
    expect(output).toContain('Name three primary colours (open)');
  });

  it('/new names the model it selected, and warns when the project model is not available', async () => {
    const { session } = await setup(1);
    const module = session.module;
    if (!module) throw new Error('no module');
    const note = 'The project\'s model "Think deeper" is not available in this chat right now.';
    module.newChat = async () => ({ notes: [note] });
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/new');
    await until(() => frames.join('\n').includes('New chat started'));
    const output = frames.join('\n').replace(/\s+/g, ' ');
    expect(output).toContain('⚠ The project\'s model "Think deeper" is not available');
  });

  it('/chat switches by number or name', async () => {
    const { a, session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/chats');
    await typeAndEnter(stdin, '/chat 3');
    await until(() => a.calls.includes('openChat:c-story'));
    expect(frames.join('\n')).toContain('Opened chat "Lighthouse story"');
  });

  it('/rename renames the open chat', async () => {
    const { a, session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/rename Colour notes');
    expect(a.calls).toContain('renameChat:Colour notes');
    expect(frames.join('\n')).toContain('Renamed the chat to "Colour notes"');
  });

  it('/delete asks first; "n" keeps the chat, "y" deletes it', async () => {
    const { a, session } = await setup(1);
    const { stdin, frames, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/delete');
    await until(() => (lastFrame() ?? '').includes('(y/N)'));
    expect(lastFrame()).toContain(
      'Delete "Name three primary colours" from Alpha Harness? This cannot be undone.',
    );
    stdin.write('n');
    await until(() => frames.join('\n').includes('Not deleted.'));
    expect(a.calls.some((c) => c.startsWith('deleteChat'))).toBe(false);

    await typeAndEnter(stdin, '/delete');
    await until(() => (lastFrame() ?? '').includes('(y/N)'));
    stdin.write('y');
    await until(() => a.calls.includes('deleteChat:c-colours'));
    // It was the open chat: a new one is started, so the next prompt does not go into the deleted one.
    await until(() =>
      frames.join('\n').includes('Deleted "Name three primary colours" and started a new chat'),
    );
    expect(a.calls.indexOf('newChat')).toBeGreaterThan(a.calls.indexOf('deleteChat:c-colours'));
  });

  it('/delete refuses chats marked (Keep) without asking', async () => {
    const { a, session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/delete c-large');
    expect(frames.join('\n')).toContain('is marked (Keep)');
    expect(frames.join('\n')).not.toContain('(y/N)');
    expect(a.calls.some((c) => c.startsWith('deleteChat'))).toBe(false);
  });
});

describe('/instructions', () => {
  it("saves Reiner's sections after a yes, keeps the user's text and writes a backup", async () => {
    const { a, root, session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/instructions sync');
    await until(() => frames.join(String.fromCharCode(10)).includes('(y/N)'));
    expect(frames.join(String.fromCharCode(10))).toContain('Your own 36 characters stay exactly as they are');
    stdin.write('y');
    await until(() => frames.join(String.fromCharCode(10)).includes('Saved and checked'));
    expect(a.calls).toContain('write-instructions');
    expect(a.instructions.text.startsWith('Always answer in Australian English.')).toBe(true);
    expect(sectionIds(a.instructions.text)).toEqual(['files', 'tools', 'index', 'transfer']);
    const backups = await readdir(path.join(root, '.reiner', 'modules', 'alpha', 'instructions-backups'));
    expect(backups).toHaveLength(1);
    const state = await readState<{ synced?: string }>(
      path.join(root, '.reiner', 'modules', 'alpha'),
      'transfer',
    );
    expect(state?.synced).toMatch(/^diff\|index=true\|[0-9a-f]{12}$/);

    await typeAndEnter(stdin, '/instructions remove');
    await until(() => frames.join(String.fromCharCode(10)).includes('Will remove sections'));
    stdin.write('y');
    await until(() => frames.join(String.fromCharCode(10)).includes("Removed Reiner's sections"));
    expect(a.instructions.text.trim()).toBe('Always answer in Australian English.');
  });

  it('saves nothing without a yes', async () => {
    const { a, session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/instructions sync');
    await until(() => frames.join(String.fromCharCode(10)).includes('(y/N)'));
    stdin.write('n');
    await until(() => frames.join(String.fromCharCode(10)).includes('Not saved.'));
    expect(a.calls).not.toContain('write-instructions');
    expect(a.instructions.text).toBe('Always answer in Australian English.');
  });
});
