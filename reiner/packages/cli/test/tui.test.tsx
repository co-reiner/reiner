/**
 * @file Tests the TUI shell: first run, `/harness`, command groups, and a harness with only the required methods.
 * @see {@link ../../../docs/architecture/cli-ux.md#startup | CLI and TUI: startup}
 * @see {@link ../../../docs/architecture/cli-ux.md#harness-commands | CLI and TUI: harness commands}
 * @see {@link ../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: harnesses and the live browser}
 * @see {@link ../../../docs/architecture/modules.md#harness-commands | Harness modules: harness commands}
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type HarnessEntry, type HarnessModule, loadConfig } from '@co-reiner/core';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { openSession } from '../src/session.ts';
import { App } from '../src/tui/App.tsx';
import { signIn } from './support/fake-harness.ts';
import { noGlobal, setup, tick, tmp, typeAndEnter, until } from './support/tui.ts';

describe('TUI', () => {
  it('opens the only harness straight away, without asking', async () => {
    const { a, session } = await setup(1);
    const { lastFrame, frames } = render(<App session={session} />);
    await tick();
    expect(frames.join('\n')).toContain('Alpha Harness is open and signed in');
    expect(a.calls).toContain('start');
    expect(lastFrame()).toContain('● browser open');
  });

  it('runs as the bare CLI with no harness installed: no picker, a prompt and a hint', async () => {
    const { session } = await setup(0);
    expect(session.needsHarnessChoice).toBe(false);
    expect(session.notices.join(' ')).toContain('No harnesses installed');
    const { lastFrame } = render(<App session={session} />);
    await tick();
    expect(lastFrame()).not.toContain('Which harness should this project use?');
    expect(lastFrame()).toContain('No harness');
  });

  it('suggests commands when typing a slash', async () => {
    const { session } = await setup(1);
    const { stdin, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    stdin.write('/mo');
    await tick();
    expect(lastFrame()).toContain('/models');
  });

  it('lists models from /models, grouped by submenu', async () => {
    const { session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/models');
    const output = frames.join('\n');
    expect(output).toContain('Slower, more thorough');
    expect(output).toContain('▸ GPT · OpenAI');
  });
});

describe('first run with several harnesses', () => {
  it('asks which harness to use, then writes config and opens it', async () => {
    const { a, b, root, session } = await setup(2);
    expect(session.needsHarnessChoice).toBe(true);
    const { stdin, lastFrame, frames } = render(<App session={session} />);
    await tick();
    expect(lastFrame()).toContain('Which harness should this project use?');
    stdin.write('\u001B[B'); // down arrow → Beta
    await tick();
    stdin.write('\r');
    await until(() => b.calls.includes('start'));
    expect(frames.join('\n')).toContain('Beta Harness is now this project');
    expect(b.calls).toContain('start');
    expect(a.calls).not.toContain('start');
    const config = await loadConfig(path.join(root, '.reiner', 'config.jsonc'), noGlobal);
    expect(Object.keys(config.harnesses)).toEqual(['beta']);
    expect(config.defaultHarness).toBe('beta');
  });
});

describe('/harness', () => {
  it('switches harness: closes the old browser, opens the new one, updates config', async () => {
    const { a, b, root } = await setup(2);
    // Start a project on alpha, then reopen with both installed.
    const session = await openSession(root, {
      registry: [a.entry, b.entry],
      harness: 'alpha',
      globalConfigFile: noGlobal,
    });
    const { stdin, frames } = render(<App session={session} />);
    await tick();
    await typeAndEnter(stdin, '/harness beta');
    await until(() => b.calls.includes('start'));
    expect(a.calls.filter((c) => c === 'start' || c === 'stop')).toEqual(['start', 'stop']);
    expect(b.calls).toContain('start');
    expect(frames.join('\n')).toContain('Beta Harness is now this project');
    const text = await readFile(path.join(root, '.reiner', 'config.jsonc'), 'utf8');
    const config = await loadConfig(path.join(root, '.reiner', 'config.jsonc'), noGlobal);
    expect(Object.keys(config.harnesses)).toEqual(['alpha', 'beta']);
    expect(config.defaultHarness).toBe('beta');
    expect(text).toContain('"beta"');
  });

  it('lists harnesses with no argument', async () => {
    const { session } = await setup(2);
    await session.chooseHarness('alpha');
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/harness');
    const output = frames.join('\n');
    expect(output).toContain('Alpha Harness');
    expect(output).toContain('active');
    expect(output).toContain('Beta Harness');
  });
});

describe('slash command groups', () => {
  it('lists the harness commands first and the global ones last', async () => {
    const { session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/help');
    const out = frames.join(String.fromCharCode(10));
    expect(out.indexOf('Alpha Harness commands')).toBeGreaterThan(-1);
    expect(out.indexOf('Alpha Harness commands')).toBeLessThan(out.indexOf('Global commands'));
    expect(out.indexOf('/login')).toBeLessThan(out.indexOf('/exit'));
  });
});

describe('a harness with no sign-in, chats or commands', () => {
  /** Like a search page with an AI answer: open it, ask, read the answer. Nothing else. */
  function bareHarness(): HarnessEntry {
    let open = false;
    const module: HarnessModule = {
      id: 'bare',
      displayName: 'Bare Harness',
      start: async () => {
        open = true;
        return { signIn, notes: [] };
      },
      restart: async () => ({ signIn, notes: [] }),
      send: async (prompt) => ({ markdown: `Answer to ${prompt}`, stopped: false, elapsedMs: 5 }),
      stopGenerating: async () => {},
      isOpen: () => open,
      onClosed: () => () => {},
      waitUntilClosed: async () => {},
      stop: async () => {
        open = false;
      },
    };
    return { id: 'bare', displayName: 'Bare Harness', description: 'test', create: () => module };
  }

  it('starts, chats, and offers only the global commands', async () => {
    const session = await openSession(await tmp(), { registry: [bareHarness()], globalConfigFile: noGlobal });
    const { stdin, frames } = render(<App session={session} />);
    await until(() => frames.join(String.fromCharCode(10)).includes('Bare Harness is open'));
    await typeAndEnter(stdin, '/help');
    const help = frames.join(String.fromCharCode(10));
    expect(help).not.toContain('Bare Harness commands');
    expect(help).toContain('Global commands');
    await typeAndEnter(stdin, '/login');
    await until(() => frames.join(String.fromCharCode(10)).includes('Unknown command /login'));
    await typeAndEnter(stdin, 'hello');
    await until(() => frames.join(String.fromCharCode(10)).includes('Answer to hello'));
    expect(frames.join(String.fromCharCode(10))).toContain('Answer to hello');
  });
});
