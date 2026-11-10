/**
 * @file Tests `/model` suggestions and selection, and the keys of the command suggestion list.
 * @see {@link ../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 * @see {@link ../../harness-ms/docs/commands.md#argument-completion | Copilot's slash commands: argument completion}
 */
import path from 'node:path';
import { writeState } from '@co-reiner/core';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { App } from '../src/tui/App.tsx';
import { models } from './support/fake-harness.ts';
import { DOWN, nl, setup, tick, typeAndEnter, UP, until } from './support/tui.ts';

describe('/model', () => {
  it('suggests matching model names while typing', async () => {
    const { session, root } = await setup(1);
    await writeState(path.join(root, '.reiner', 'modules', 'alpha'), 'models', models);
    const { stdin, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    stdin.write('/model sol');
    // The cached model list loads asynchronously; wait for it rather than one tick.
    await until(() => lastFrame()?.includes('GPT-5.6 Sol Quick response') ?? false);
    expect(lastFrame()).toContain('GPT-5.6 Sol Quick response');
    expect(lastFrame()).not.toContain('Auto ·');
  });

  it('selects a model and reports it', async () => {
    const { session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/model sol quick');
    expect(frames.join('\n')).toContain('Selected GPT · OpenAI › GPT-5.6 Sol Quick response');
  });

  it('asks for more detail when the name is ambiguous and no list is showing', async () => {
    const { session } = await setup(1);
    const { stdin, frames } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/model t');
    expect(frames.join('\n')).toContain('Be more specific');
  });

  it("marks the project's saved model as current, even if the cached list says otherwise", async () => {
    const { session, root } = await setup(1);
    const dir = path.join(root, '.reiner', 'modules', 'alpha');
    await writeState(dir, 'models', models); // cache still has Auto selected
    await writeState(dir, 'model', {
      id: 'GPT/GPT-5.6 Sol Quick response',
      label: 'GPT-5.6 Sol Quick response',
      chosenAt: new Date().toISOString(),
    });
    const { stdin, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    stdin.write('/model ');
    // The model list and the saved model load separately; wait for both.
    // Until the saved model has loaded, the cached flag can briefly mark Auto, so wait for the right line.
    await until(() =>
      (lastFrame() ?? '')
        .split('\n')
        .some((l) => l.includes('GPT-5.6 Sol Quick response') && l.includes('(current)')),
    );
    const lines = (lastFrame() ?? '').split('\n');
    expect(lines.find((l) => l.includes('GPT-5.6 Sol Quick response'))).toContain('(current)');
    expect(lines.find((l) => l.includes('Auto'))).not.toContain('(current)');
  });

  it('picks a model from the list with arrow keys and Enter', async () => {
    const { session, root } = await setup(1);
    await writeState(path.join(root, '.reiner', 'modules', 'alpha'), 'models', models);
    const { stdin, frames, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    stdin.write('/model ');
    await until(() => (lastFrame() ?? '').includes('❯ Auto'));
    expect(lastFrame()).toContain('❯ Auto');
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    expect(lastFrame()).toContain('❯ GPT-5.6 Sol Quick response');
    stdin.write('\r');
    await tick();
    await tick();
    expect(frames.join('\n')).toContain('Selected GPT · OpenAI › GPT-5.6 Sol Quick response');
  });
});

describe('command suggestions', () => {
  it('moves through commands with arrows, wraps around, and Enter runs the highlighted one', async () => {
    const { session } = await setup(1);
    const { stdin, frames, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    stdin.write('/mod');
    await tick();
    expect(lastFrame()).toContain('❯ /models');
    stdin.write(DOWN);
    await tick();
    expect(lastFrame()).toContain('❯ /model ');
    stdin.write(DOWN); // wraps back to the top
    await tick();
    expect(lastFrame()).toContain('❯ /models');
    stdin.write(UP); // wraps to the bottom
    await tick();
    expect(lastFrame()).toContain('❯ /model ');
    stdin.write('\r');
    await tick();
    await tick();
    expect(frames.join('\n')).toContain('No model chosen for this project yet');
  });

  it('puts the cursor at the end after Tab completion and history recall', async () => {
    const { session } = await setup(1);
    const { stdin, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    stdin.write('/mod');
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write('\t');
    await tick();
    stdin.write('sol');
    await tick();
    expect(lastFrame()).toContain('> /model sol');
  });

  it('puts the cursor at the end after recalling history', async () => {
    const { session } = await setup(1);
    const { stdin, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/help');
    stdin.write(UP);
    await tick();
    stdin.write('!');
    await tick();
    expect(lastFrame()).toContain('> /help!');
  });

  it('Tab completes the highlighted command and Esc hides the list', async () => {
    const { session } = await setup(1);
    const { stdin, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    stdin.write('/mod');
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write('\t');
    await tick();
    expect(lastFrame()).toContain('> /model');
    stdin.write('\u001B'); // Esc
    await tick();
    expect(lastFrame()).not.toContain('❯');
  });
});

describe('prompt history', () => {
  it('keeps a typed draft: Down alone leaves it, and Down after Up brings it back', async () => {
    const { session } = await setup(1);
    const { stdin, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    await typeAndEnter(stdin, '/help');
    stdin.write('my draft');
    await tick();
    stdin.write(DOWN); // no history walk in progress: nothing changes
    await tick();
    expect(lastFrame()).toContain('> my draft');
    stdin.write(UP);
    await tick();
    stdin.write('!'); // the transcript also shows "> /help", so mark the recalled prompt
    await tick();
    expect(lastFrame()).toContain('> /help!');
    expect(lastFrame()).not.toContain('my draft');
    stdin.write(DOWN); // past the newest entry: the draft is back
    await tick();
    expect(lastFrame()).toContain('> my draft');
    expect(lastFrame()).not.toContain('> /help!');
    stdin.write(DOWN);
    await tick();
    expect(lastFrame()).toContain('> my draft');
  });
});

describe('argument choices', () => {
  it('/transfer offers its modes and index settings; Enter on the bare command changes nothing', async () => {
    const { session } = await setup(1);
    const { stdin, frames, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    stdin.write('/transfer ');
    await tick();
    const list = lastFrame() ?? '';
    for (const value of ['/transfer', 'diff', 'download', 'index on', 'index off'])
      expect(list).toContain(value);
    expect(list).toContain('❯ /transfer');
    stdin.write('\r');
    await until(() => frames.join(nl).includes('File exchange'));
    expect(frames.join(nl)).not.toContain('Changes now come back as');
  });

  it('narrows the choices as you type, and Enter picks the highlighted one', async () => {
    const { session } = await setup(1);
    const { stdin, frames, lastFrame } = render(<App session={session} autoStart={false} />);
    await tick();
    stdin.write('/transfer do');
    await tick();
    expect(lastFrame()).toContain('❯ download');
    expect(lastFrame()).not.toContain('index on');
    stdin.write('\r');
    await until(() => frames.join(nl).includes('Changes now come back as'));
    expect(frames.join(nl)).toContain('Changes now come back as: patch file as a download link');
  });
});
