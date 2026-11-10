/**
 * @file Tests for the project's named tasks: running one with its limits, what counts as a file a task
 * runs, tasks in the project config, and the `run_task` call.
 * @see {@link ../../../docs/architecture/tool-protocol.md#project-tasks | Tool protocol: project tasks}
 * @see {@link ../../../docs/architecture/project-config.md#tasks | Project configuration: tasks}
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  answerTaskCall,
  extractToolCalls,
  loadConfig,
  runTask,
  type TaskConfig,
  taskEnv,
  taskPassed,
  taskReport,
  taskSummary,
  touchesTaskFiles,
} from '../src/index.ts';

const dirs: string[] = [];
/** A project folder with small scripts for the tasks to run. */
function project(scripts: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reiner-tasks-'));
  dirs.push(root);
  for (const [name, code] of Object.entries(scripts)) writeFileSync(path.join(root, name), code);
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const task = (command: string, timeoutSeconds = 30): TaskConfig => ({
  command,
  afterApply: false,
  timeoutSeconds,
});

describe('runTask', () => {
  it('runs in the project root and reports a pass with its output', async () => {
    const root = project({
      'ok.mjs': "console.log('cwd ' + process.cwd().length); console.log('all good');",
    });
    const result = await runTask(root, 'test', task('node ok.mjs'));
    expect(taskPassed(result)).toBe(true);
    expect(result.output).toContain('all good');
    expect(taskSummary(result)).toMatch(/^test: passed in /);
  });

  it('reports a failure with the exit code and what was printed to both streams', async () => {
    const root = project({ 'fail.mjs': "console.log('step one'); console.error('boom'); process.exit(3);" });
    const result = await runTask(root, 'lint', task('node fail.mjs'));
    expect(taskPassed(result)).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(taskSummary(result)).toMatch(/^lint: failed \(exit code 3\) in /);
    expect(taskReport(result).join('\n')).toContain('boom');
  });

  it('stops a task that runs past its time limit', async () => {
    const root = project({ 'slow.mjs': 'setTimeout(() => {}, 60000);' });
    const result = await runTask(root, 'test', task('node slow.mjs', 1));
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(taskSummary(result)).toContain('time limit');
  });

  it('keeps only the end of a long output', async () => {
    const root = project({
      'long.mjs': "for (let i = 0; i < 2000; i++) console.log('line ' + i); console.log('THE END');",
    });
    const result = await runTask(root, 'test', task('node long.mjs'));
    expect(result.truncated).toBe(true);
    expect(result.output.endsWith('THE END')).toBe(true);
    expect(result.output).not.toContain('line 0\n');
  });

  it('gives a task no secrets from the environment', async () => {
    const root = project({ 'env.mjs': "console.log('token=' + (process.env.REINER_TEST_TOKEN ?? 'none'));" });
    process.env.REINER_TEST_TOKEN = 'do-not-leak-this-value';
    try {
      const result = await runTask(root, 'test', task('node env.mjs'));
      expect(result.output).toContain('token=none');
      const { env, secrets } = taskEnv();
      expect(env.REINER_TEST_TOKEN).toBeUndefined();
      expect(secrets).toContain('do-not-leak-this-value');
      expect(env.PATH ?? env.Path).toBeDefined();
    } finally {
      delete process.env.REINER_TEST_TOKEN;
    }
  });
});

describe('files a task runs', () => {
  it('names build manifests and scripts among the changed paths', () => {
    const changed = [
      'src/a.ts',
      'package.json',
      'apps/web/package.json',
      'scripts/build.mjs',
      'tools/deploy.ps1',
      'README.md',
    ];
    expect(touchesTaskFiles(changed)).toEqual([
      'package.json',
      'apps/web/package.json',
      'scripts/build.mjs',
      'tools/deploy.ps1',
    ]);
  });
});

describe('tasks in the config', () => {
  it('reads them from the project only, as a command or with options', async () => {
    const root = project({});
    const projectFile = path.join(root, 'config.jsonc');
    const globalFile = path.join(root, 'global.jsonc');
    writeFileSync(
      projectFile,
      JSON.stringify({
        tasks: { test: 'pnpm test', lint: { command: 'pnpm lint', afterApply: true, timeoutSeconds: 60 } },
      }),
    );
    writeFileSync(globalFile, JSON.stringify({ tasks: { evil: 'echo from the global config' } }));
    const config = await loadConfig(projectFile, globalFile);
    expect(config.tasks).toEqual({
      test: { command: 'pnpm test', afterApply: false, timeoutSeconds: 600 },
      lint: { command: 'pnpm lint', afterApply: true, timeoutSeconds: 60 },
    });
  });
});

describe('the run_task call', () => {
  const block = (call: unknown) => ['```reiner-tool', JSON.stringify(call), '```'].join('\n');

  it('carries a name, never a command', () => {
    const parsed = extractToolCalls(
      block({ name: 'run_task', arguments: { name: 'test', command: 'rm -rf .' } }),
    );
    expect(parsed.calls).toEqual([{ tool: 'run_task', name: 'test', callId: 'call_1' }]);
  });

  it('is answered as unavailable where the host offers no task running', async () => {
    const [call] = extractToolCalls(block({ name: 'run_task', arguments: { name: 'test' } })).calls;
    if (call?.tool !== 'run_task') throw new Error('not a run_task call');
    const answer = await answerTaskCall(call, {}, 'The model');
    expect(answer.lines.join(' ')).toContain('not available');
    const ran = await answerTaskCall(
      call,
      { runTask: async (name) => ({ lines: [`ran ${name}`], summary: 'ok' }) },
      'The model',
    );
    expect(ran.lines).toEqual(['ran test']);
  });
});
