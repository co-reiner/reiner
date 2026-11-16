/**
 * @file Tests the CLI as a plugin host with a fake plugin: its prompt line, a call to its tool, its command and
 * its status badge; and that a run without plugins has none of them.
 * @see {@link ../../../docs/architecture/plugins.md | Plugins}
 */
import { execFileSync } from 'node:child_process';
import type { ChatReply, ReinerPlugin } from '@co-reiner/core';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { setPlugins } from '../src/plugins.ts';
import { openSession } from '../src/session.ts';
import { App } from '../src/tui/App.tsx';
import { commandsFor } from '../src/tui/commands.ts';
import { fakeHarness } from './support/fake-harness.ts';
import { noGlobal, tick, tmp, typeAndEnter, until } from './support/tui.ts';

const fence = '```';

/** A plugin with one tool (`echo__say`), a line for the prompt, a command and a badge; it records its calls. */
function echoPlugin(seen: string[]): ReinerPlugin {
  return {
    id: 'echo',
    commands: [
      {
        name: 'echo',
        description: 'Say hello',
        run: (_s, host) => host.print({ kind: 'info', text: 'echo ran' }),
      },
    ],
    start: () => ({
      toolNames: async () => ['echo__say'],
      promptLine: async () => '\n\nECHO-LINE',
      promptSent: (chatId) => void seen.push(`sent ${chatId}`),
      call: async (name, args) => {
        seen.push(`call ${name} ${JSON.stringify(args)}`);
        return { lines: ['said it'], summary: 'echo said it' };
      },
      status: () => ({ text: 'Echo: on' }),
      close: async () => {},
    }),
  };
}

afterEach(() => setPlugins([]));

async function session(plugins?: ReinerPlugin[]) {
  const a = fakeHarness('alpha', 'Alpha Harness');
  const root = await tmp();
  execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true });
  const s = await openSession(root, {
    registry: [a.entry],
    globalConfigFile: noGlobal,
    ...(plugins ? { plugins } : {}),
  });
  return { a, s };
}

describe('plugins', () => {
  it('adds the line to the prompt, passes a call to its tool, and shows its badge', async () => {
    const seen: string[] = [];
    const { s } = await session([echoPlugin(seen)]);
    const sent: string[] = [];
    if (s.module) {
      s.module.send = async (prompt): Promise<ChatReply> => {
        sent.push(prompt);
        const markdown =
          sent.length === 1
            ? `${fence}reiner-tool\n{"name":"echo__say","arguments":{"word":"hi"}}\n${fence}`
            : 'Done.';
        return { markdown, stopped: false, elapsedMs: 1 };
      };
    }
    const { stdin, frames } = render(<App session={s} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, 'say something');
    await until(() => sent.length === 2);
    expect(sent[0]).toContain('ECHO-LINE');
    expect(seen).toContain('call echo__say {"word":"hi"}');
    expect(sent[1]).toContain('said it');
    await until(() => frames.join('\n').includes('Echo: on'));
  });

  it('lists a plugin command only when the plugin is handed in', () => {
    expect(commandsFor(null).map((c) => c.name)).not.toContain('echo');
    setPlugins([echoPlugin([])]);
    expect(commandsFor(null).map((c) => c.name)).toContain('echo');
  });

  it('leaves the prompt as typed without plugins', async () => {
    const { a, s } = await session();
    const { stdin } = render(<App session={s} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, 'plain');
    await until(() => a.calls.some((c) => c.startsWith('send:')));
    expect(a.calls).toContain('send:plain');
  });
});
