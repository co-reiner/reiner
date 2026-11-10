/**
 * @file The project's checks (its named tasks) in the TUI: running them after the user applies a change,
 * running one when the model asks, and the questions that keep the user in charge of both.
 * @see {@link ../../../../docs/architecture/tool-protocol.md#project-tasks | Tool protocol: project tasks}
 * @see {@link ../../../../docs/architecture/project-config.md#tasks | Project configuration: tasks}
 */
import {
  runTask,
  type TaskConfig,
  type TaskResult,
  type ToolAnswer,
  taskPassed,
  taskReport,
  taskSummary,
  touchesTaskFiles,
} from '@co-reiner/core';
import type { CommandApi } from './commands/types.ts';

/** What the checks remember for one TUI session. */
export interface ChecksState {
  /** Tasks the user has agreed to run when the model asks, this session. */
  approved: Set<string>;
  /** Build manifests and scripts changed by an applied patch since the user last agreed to a run. */
  suspect: Set<string>;
  /** Chats that have been told which tasks exist. */
  told: Set<string>;
}

export const newChecksState = (): ChecksState => ({
  approved: new Set(),
  suspect: new Set(),
  told: new Set(),
});

/** What the checks need of the TUI: the session, a place to print, the spinner and the y/N question. */
export type ChecksApi = Pick<CommandApi, 'session' | 'print' | 'busy' | 'confirm' | 'checks'>;

const harnessName = (api: ChecksApi) => api.session.harness?.displayName ?? 'The model';

/** The warning that goes with a question when a patch has changed what a task runs. */
function suspectNote(state: ChecksState): string {
  if (state.suspect.size === 0) return '';
  return ` An applied change touched ${[...state.suspect].join(', ')}, so a check may now run something new.`;
}

/** Run one task with the spinner on, and tell the user how it went. */
async function runAndShow(api: ChecksApi, name: string, task: TaskConfig): Promise<TaskResult> {
  api.busy(`Running ${name} (${task.command})…`);
  const result = await runTask(api.session.root, name, task);
  api.print({ kind: taskPassed(result) ? 'success' : 'error', text: taskSummary(result) });
  void api.session.transcript.append({ role: 'event', text: `task ${taskSummary(result)}` });
  return result;
}

/**
 * The model asked for a task by name (`run_task`). The command is the one in the project's config; the
 * user is asked before a task first runs this session, and again after a patch changed a build manifest
 * or a script. Returns what to tell the model.
 */
export async function runTaskForModel(api: ChecksApi, name: string, reason?: string): Promise<ToolAnswer> {
  const state = api.checks;
  const who = harnessName(api);
  const tasks = await api.session.tasks();
  const task = Object.hasOwn(tasks, name) ? tasks[name] : undefined;
  const names = Object.keys(tasks);
  if (!task) {
    const known = names.length ? `Available: ${names.join(', ')}.` : 'This project has no tasks set up.';
    return {
      lines: [`There is no task named "${name}". ${known}`],
      summary: `${who} asked to run "${name}", which is not a task of this project.`,
    };
  }
  if (!state.approved.has(name) || state.suspect.size > 0) {
    api.busy(null);
    const why = reason ? ` (${reason})` : '';
    const yes = await api.confirm(
      `${who} asks to run the "${name}" check${why}: ${task.command}. Run it in ${api.session.root}?${suspectNote(state)}`,
    );
    if (!yes) {
      return {
        lines: ['the user declined to run it. Continue without it, or ask the user.'],
        summary: `${who} asked to run "${name}". Not run.`,
      };
    }
    state.approved.add(name);
    state.suspect.clear();
  }
  const result = await runAndShow(api, name, task);
  return { lines: taskReport(result), summary: `${who} asked to run "${name}": ${taskSummary(result)}.` };
}

/**
 * After the user applied changes: run the tasks marked `afterApply`. When a check fails, the user is asked
 * whether to send its output to the model; the text to send is returned, and nothing is sent here. A patch
 * that touched a build manifest or a script is asked about first, since a check would run what it changed.
 */
export async function checksAfterApply(api: ChecksApi, changed: string[]): Promise<string | undefined> {
  const state = api.checks;
  for (const p of touchesTaskFiles(changed)) state.suspect.add(p);
  const tasks = await api.session.tasks();
  const names = Object.keys(tasks).filter((n) => tasks[n]?.afterApply);
  if (names.length === 0) return undefined;
  if (state.suspect.size > 0) {
    api.busy(null);
    const yes = await api.confirm(`Run the checks (${names.join(', ')}) now?${suspectNote(state)}`);
    if (!yes) {
      api.print({ kind: 'info', text: 'Checks not run.' });
      return undefined;
    }
    state.suspect.clear();
  }
  const failed: TaskResult[] = [];
  for (const name of names) {
    const task = tasks[name];
    if (!task) continue;
    const result = await runAndShow(api, name, task);
    if (!taskPassed(result)) failed.push(result);
  }
  api.busy(null);
  if (failed.length === 0) return undefined;
  const yes = await api.confirm(`Send the failing output to ${harnessName(api)} so it can fix it?`);
  if (!yes) return undefined;
  return [
    'I applied your changes and ran my checks. These failed:',
    ...failed.flatMap((r) => ['', ...taskReport(r)]),
  ].join('\n');
}

/**
 * A line that tells the model which tasks it may ask for, added to a prompt once per chat. It travels in
 * the prompt, not in the saved instructions, so adding or renaming a task needs no `/instructions sync`.
 */
export async function taskHint(api: ChecksApi, chatId: string | undefined): Promise<string> {
  if (chatId && api.checks.told.has(chatId)) return '';
  const names = Object.keys(await api.session.tasks());
  const first = names[0];
  if (!first) return '';
  return `\n\nChecks of my project you can ask me to run: ${names.join(', ')}. Request one with the tool call {"name":"run_task","arguments":{"name":"${first}"}}; I run it and send back the result.`;
}

/** Remember that this chat has been told about the tasks. */
export function hintSent(api: ChecksApi, chatId: string | undefined): void {
  if (chatId) api.checks.told.add(chatId);
}
