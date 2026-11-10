/**
 * @file Tests for the project's checks in the TUI: after an apply, on the model's request, and the questions
 * asked before a task runs.
 * @see {@link ../../../docs/architecture/tool-protocol.md#project-tasks | Tool protocol: project tasks}
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TaskConfig } from '@co-reiner/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ChecksApi,
  checksAfterApply,
  newChecksState,
  runTaskForModel,
  taskHint,
} from '../src/tui/checks.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const task = (command: string, afterApply = false): TaskConfig => ({
  command,
  afterApply,
  timeoutSeconds: 30,
});

/** A stand-in for the TUI: a project with two scripts, scripted y/N answers, and what was asked and printed. */
function setup(tasks: Record<string, TaskConfig>, answers: boolean[]) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reiner-checks-'));
  dirs.push(root);
  writeFileSync(path.join(root, 'ok.mjs'), "console.log('fine');");
  writeFileSync(path.join(root, 'fail.mjs'), "console.error('expected 2, got 3'); process.exit(1);");
  const asked: string[] = [];
  const printed: string[] = [];
  const api = {
    session: {
      root,
      harness: { displayName: 'Alpha Harness' },
      tasks: async () => tasks,
      transcript: { append: async () => {} },
    },
    checks: newChecksState(),
    print: (entry: { kind: string; text?: string }) => printed.push(`${entry.kind}: ${entry.text ?? ''}`),
    busy: () => {},
    confirm: async (question: string) => {
      asked.push(question);
      return answers.shift() ?? false;
    },
  } as unknown as ChecksApi;
  return { api, asked, printed };
}

describe('checks after an apply', () => {
  it('runs the marked tasks, says how they went, and offers a failure to the model', async () => {
    const tasks = {
      test: task('node fail.mjs', true),
      lint: task('node ok.mjs', true),
      other: task('node ok.mjs'),
    };
    const { api, asked, printed } = setup(tasks, [true]);
    const followUp = await checksAfterApply(api, ['src/a.ts']);
    expect(printed.some((l) => l.startsWith('error: test: failed (exit code 1)'))).toBe(true);
    expect(printed.some((l) => l.startsWith('success: lint: passed'))).toBe(true);
    expect(asked).toEqual(['Send the failing output to Alpha Harness so it can fix it?']);
    expect(followUp).toContain('expected 2, got 3');
    expect(followUp).not.toContain('lint');
  });

  it('sends nothing when every check passes, or when the user says no', async () => {
    const passing = setup({ lint: task('node ok.mjs', true) }, []);
    expect(await checksAfterApply(passing.api, ['src/a.ts'])).toBeUndefined();
    expect(passing.asked).toEqual([]);
    const declined = setup({ test: task('node fail.mjs', true) }, [false]);
    expect(await checksAfterApply(declined.api, ['src/a.ts'])).toBeUndefined();
  });

  it('asks before running when the applied change touched a build manifest or a script', async () => {
    const { api, asked, printed } = setup({ test: task('node ok.mjs', true) }, [false]);
    expect(await checksAfterApply(api, ['package.json', 'src/a.ts'])).toBeUndefined();
    expect(asked[0]).toContain('Run the checks (test) now?');
    expect(asked[0]).toContain('package.json');
    expect(printed).toContain('info: Checks not run.');
  });
});

describe('a task the model asks for', () => {
  it('asks the first time, then runs without asking, and reports the result', async () => {
    const { api, asked } = setup({ test: task('node fail.mjs') }, [true]);
    const first = await runTaskForModel(api, 'test', 'to see the failure');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('asks to run the "test" check (to see the failure): node fail.mjs');
    expect(first.lines.join('\n')).toContain('expected 2, got 3');
    await runTaskForModel(api, 'test');
    expect(asked).toHaveLength(1);
  });

  it('asks again after a patch changed what a task runs', async () => {
    const { api, asked } = setup({ test: task('node ok.mjs') }, [true, true]);
    await runTaskForModel(api, 'test');
    await checksAfterApply(api, ['scripts/build.mjs']);
    await runTaskForModel(api, 'test');
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain('scripts/build.mjs');
  });

  it('runs nothing for a name that is not a task, or when the user declines', async () => {
    const { api, asked } = setup({ test: task('node ok.mjs') }, [false]);
    const unknown = await runTaskForModel(api, 'deploy');
    expect(unknown.lines[0]).toContain('There is no task named "deploy". Available: test.');
    const declined = await runTaskForModel(api, 'test');
    expect(declined.lines[0]).toContain('declined');
    expect(asked).toHaveLength(1);
  });
});

describe('telling the model which tasks exist', () => {
  it('adds one line per chat, and none when the project has no tasks', async () => {
    const { api } = setup({ test: task('node ok.mjs'), lint: task('node ok.mjs') }, []);
    const hint = await taskHint(api, 'chat-1');
    expect(hint).toContain('test, lint');
    expect(hint).toContain('{"name":"run_task","arguments":{"name":"test"}}');
    api.checks.told.add('chat-1');
    expect(await taskHint(api, 'chat-1')).toBe('');
    expect(await taskHint(setup({}, []).api, 'chat-1')).toBe('');
  });
});
