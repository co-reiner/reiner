/**
 * @file Running one of the project's named tasks (its tests, its linter): the commands the user wrote in
 * the project's config, never one a model chose. Each run is pinned to the project folder, gets no secrets
 * from the environment, is stopped after a time limit, and returns a capped tail of its output.
 * @see {@link ../../../../docs/architecture/tool-protocol.md#project-tasks | Tool protocol: project tasks}
 * @see {@link ../../../../docs/architecture/project-config.md#tasks | Project configuration: tasks}
 */
import { execFile, spawn } from 'node:child_process';

/** One task as the project's config gives it. */
export interface TaskConfig {
  /** The command line, run in a shell in the project root. */
  command: string;
  /** Run it after the user applies a change from the model. */
  afterApply: boolean;
  /** Stop it after this long. */
  timeoutSeconds: number;
}

export interface TaskResult {
  name: string;
  command: string;
  /** The exit code; null when the task was stopped. */
  exitCode: number | null;
  timedOut: boolean;
  /** The user cancelled it. */
  cancelled: boolean;
  durationMs: number;
  /** The end of what the task printed, without colour codes and without secrets from the environment. */
  output: string;
  /** Earlier output was left out. */
  truncated: boolean;
}

/** How much of a task's output is kept: the end, where a failure is reported. */
export const TASK_OUTPUT_LIMIT = 4000;
/** How much is held while the task runs, before the tail is cut. */
const BUFFER_LIMIT = 256 * 1024;

/** Environment variables with these words in their name are not passed to a task. */
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH/i;

/**
 * The environment a task gets: everything except variables that look like secrets. A task's output is
 * sent to the harness, so a test that prints its environment must not have a token to print. The values
 * left out are returned too, to take them out of the output should they appear by another route.
 */
export function taskEnv(env: NodeJS.ProcessEnv = process.env): { env: NodeJS.ProcessEnv; secrets: string[] } {
  const kept: NodeJS.ProcessEnv = {};
  const secrets: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SECRET_NAME.test(name)) {
      if (value.length >= 8) secrets.push(value);
    } else kept[name] = value;
  }
  return { env: kept, secrets };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: colour codes start with ESC
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** The tail of a task's output, cleaned for sending: no colour codes, no known secrets. */
function tidy(raw: string, secrets: string[]): { output: string; truncated: boolean } {
  let text = raw.replace(ANSI, '').replace(/\r\n?/g, '\n').trim();
  for (const secret of secrets) text = text.split(secret).join('***');
  if (text.length <= TASK_OUTPUT_LIMIT) return { output: text, truncated: false };
  const tail = text.slice(-TASK_OUTPUT_LIMIT);
  // Start at a line break, so the first line shown is a whole one.
  const cut = tail.indexOf('\n');
  return { output: cut === -1 ? tail : tail.slice(cut + 1), truncated: true };
}

/** Stop a task and everything it started (a test runner starts workers). */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  try {
    // The task runs in its own process group (see `detached` below), so the whole group goes.
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

export interface RunTaskOptions {
  /** Aborted when the user cancels: the task is stopped. */
  signal?: AbortSignal;
}

/**
 * Run a task in the project root and wait for it. Never rejects for a failing task: the exit code says how
 * it went. One task at a time is the caller's business.
 */
export function runTask(
  root: string,
  name: string,
  task: TaskConfig,
  opts: RunTaskOptions = {},
): Promise<TaskResult> {
  const { env, secrets } = taskEnv();
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(task.command, {
      cwd: root,
      env,
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let raw = '';
    let timedOut = false;
    let cancelled = false;
    const take = (chunk: Buffer) => {
      raw = (raw + chunk.toString('utf8')).slice(-BUFFER_LIMIT);
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    const stop = () => {
      if (child.pid !== undefined) killTree(child.pid);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, task.timeoutSeconds * 1000);
    const onAbort = () => {
      cancelled = true;
      stop();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (exitCode: number | null, extra = '') => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      const stopped = timedOut || cancelled;
      resolve({
        name,
        command: task.command,
        exitCode: stopped ? null : exitCode,
        timedOut,
        cancelled,
        durationMs: Date.now() - started,
        ...tidy(raw + extra, secrets),
      });
    };
    child.on('error', (error) => finish(1, `\n${error.message}`));
    child.on('close', (code) => finish(code));
  });
}

/** True when the task ran to the end and reported success. */
export const taskPassed = (r: TaskResult): boolean => r.exitCode === 0;

/** One line on how a task went, e.g. `test: failed (exit code 1) in 12.3 s`. */
export function taskSummary(r: TaskResult): string {
  const time = `${(r.durationMs / 1000).toFixed(1)} s`;
  if (r.cancelled) return `${r.name}: cancelled after ${time}`;
  if (r.timedOut) return `${r.name}: stopped after ${time} (time limit)`;
  return taskPassed(r)
    ? `${r.name}: passed in ${time}`
    : `${r.name}: failed (exit code ${r.exitCode}) in ${time}`;
}

/** A task's result as text for the model: the summary, then the end of its output. */
export function taskReport(r: TaskResult): string[] {
  if (!r.output) return [taskSummary(r)];
  return [taskSummary(r), r.truncated ? 'End of its output:' : 'Its output:', r.output];
}

const TASK_FILE_NAMES = new Set([
  'package.json',
  'makefile',
  'justfile',
  'taskfile.yml',
  'taskfile.yaml',
  'pyproject.toml',
  'tox.ini',
  'cargo.toml',
]);
const TASK_FILE_ENDINGS = /\.(ps1|sh|cmd|bat|csproj|sln|targets|props)$/i;

/**
 * Of the paths a change touched, the ones a task is likely to run directly: build manifests and scripts.
 * A change to one of them means a task may now do something the user has not seen, so the next run asks
 * first. (Any change can alter what a test does; these are the files that alter which command runs.)
 */
export function touchesTaskFiles(paths: string[]): string[] {
  return paths.filter((p) => {
    const parts = p.replace(/\\/g, '/').split('/');
    const name = (parts[parts.length - 1] ?? '').toLowerCase();
    return (
      TASK_FILE_NAMES.has(name) || TASK_FILE_ENDINGS.test(name) || parts.slice(0, -1).includes('scripts')
    );
  });
}
