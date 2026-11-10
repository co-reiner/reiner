/**
 * @file Answering the tools any harness can have: the search tools (`glob`, `grep`) and `run_task`, and
 * the answer message for a harness with no file exchange of its own. The tools that send files belong to
 * an exchange.
 * @see {@link ../../../../docs/architecture/tool-protocol.md#who-answers-a-call | Tool protocol: who answers a call}
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 */
import type { PreparedPrompt, ToolRunOptions } from '../exchange.ts';
import type { FileFilter } from '../transfer/share.ts';
import { INVALID_CALL_ID, type ParsedTools, type ToolAnswer, type ToolCall, toolResult } from './protocol.ts';
import { GLOB_LIMIT, GREP_LIMIT, globFiles, grepFiles, searchFilter } from './search.ts';

export type SearchCall = Extract<ToolCall, { tool: 'glob' | 'grep' }>;
export type TaskCall = Extract<ToolCall, { tool: 'run_task' }>;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

async function answerGlob(
  root: string,
  call: Extract<SearchCall, { tool: 'glob' }>,
  filter: FileFilter,
  who: string,
): Promise<ToolAnswer> {
  const found = await globFiles(root, call.pattern, filter);
  const shown = found.total > found.files.length ? ` (first ${GLOB_LIMIT} shown; narrow the pattern)` : '';
  const head = found.total
    ? `${plural(found.total, 'file')} match ${call.pattern}${shown}:`
    : `no files match ${call.pattern}.`;
  return {
    lines: [head, ...found.files],
    summary: `${who} listed ${call.pattern}: ${plural(found.total, 'file')}.`,
  };
}

async function answerGrep(
  root: string,
  call: Extract<SearchCall, { tool: 'grep' }>,
  filter: FileFilter,
  who: string,
): Promise<ToolAnswer> {
  const where = call.glob ? ` in ${call.glob}` : '';
  try {
    const found = await grepFiles(root, call.pattern, {
      ...(call.glob ? { glob: call.glob } : {}),
      ...(call.ignoreCase ? { ignoreCase: true } : {}),
      filter,
    });
    const shown =
      found.total > found.matches.length
        ? ` (first ${GREP_LIMIT} shown; narrow the pattern or add a glob)`
        : '';
    const counts = `${plural(found.total, 'line')} in ${plural(found.files, 'file')}`;
    const head = found.total
      ? `${counts} match /${call.pattern}/${where}${shown}:`
      : `no lines match /${call.pattern}/${where}.`;
    return {
      lines: [
        head,
        ...found.matches.map((m) => `${m.file}:${m.line}: ${m.text}`),
        ...(found.stopped ? [`Search ${found.stopped}.`] : []),
      ],
      summary: `${who} searched for /${call.pattern}/${where}: ${counts}.`,
    };
  } catch (e) {
    // A bad regular expression: the model gets the error back and can try again.
    const message = e instanceof Error ? e.message : String(e);
    return { lines: [message], summary: `${who} searched for /${call.pattern}/: ${message}` };
  }
}

/**
 * Answer a `glob` or `grep` call from the files the share rules allow (search.ts): a git-ignored file or
 * one outside the project is never named or read, so no question is asked. `who` names the model's
 * harness in the line for the user.
 */
export function answerSearchCall(
  root: string,
  call: SearchCall,
  filter: FileFilter,
  who: string,
): Promise<ToolAnswer> {
  return call.tool === 'glob' ? answerGlob(root, call, filter, who) : answerGrep(root, call, filter, who);
}

/**
 * Answer a `run_task` call. Running a task is the host's business (`ToolRunOptions.runTask`): this only
 * passes the name on, or says that tasks cannot be run here.
 */
export async function answerTaskCall(call: TaskCall, opts: ToolRunOptions, who: string): Promise<ToolAnswer> {
  if (!opts.runTask) {
    return {
      lines: ['run_task is not available here: no project tasks can be run.'],
      summary: `${who} asked to run "${call.name}", which cannot be done here.`,
    };
  }
  return opts.runTask(call.name, call.reason);
}

export interface SearchToolsOptions extends ToolRunOptions {
  root: string;
  /** The harness's name, for the lines shown to the user. */
  who: string;
  /** The harness's settings read fresh, for search `include` and `exclude`. */
  settings(): Promise<Record<string, unknown>>;
}

/**
 * Answer a reply's tool calls for a harness that has no exchange: `glob` and `grep` are answered, and a
 * call to a tool that sends files is told there is no way to send them here. Returns the message that
 * goes back (one `function_call_output` per call) and lines for the user.
 */
export async function runSearchTools(
  parsed: ParsedTools,
  opts: SearchToolsOptions,
): Promise<{ prepared: PreparedPrompt; summary: string[] }> {
  const lines: string[] = [];
  const summary: string[] = [];
  for (const error of parsed.errors) {
    lines.push(toolResult(INVALID_CALL_ID, error));
    summary.push(`Tool call not understood: ${error}`);
  }
  let filter: FileFilter = {};
  let filterError: string | undefined;
  try {
    filter = searchFilter(await opts.settings());
  } catch (e) {
    filterError = e instanceof Error ? e.message : String(e);
  }
  for (const call of parsed.calls) {
    if (call.tool === 'run_task') {
      const done = await answerTaskCall(call, opts, opts.who);
      lines.push(toolResult(call.callId, done.lines.join('\n')));
      summary.push(done.summary);
    } else if (call.tool !== 'glob' && call.tool !== 'grep') {
      lines.push(
        toolResult(call.callId, `${call.tool} is not available: ${opts.who} has no way to send files.`),
      );
      summary.push(`${opts.who} asked for ${call.tool}, which this harness cannot do.`);
    } else if (filterError) {
      // The details go to the user, not the model, which cannot fix a setting.
      lines.push(
        toolResult(call.callId, "not run: the user's search settings need fixing. Continue without it."),
      );
      summary.push(`${opts.who} asked for ${call.tool} ${call.pattern}, not run: ${filterError}`);
    } else {
      opts.onStatus?.(call.tool === 'glob' ? `Listing ${call.pattern}…` : `Searching for ${call.pattern}…`);
      const answer = await answerSearchCall(opts.root, call, filter, opts.who);
      lines.push(toolResult(call.callId, answer.lines.join('\n')));
      summary.push(answer.summary);
    }
  }
  return { prepared: { prompt: [...lines, 'Continue the task.'].join('\n'), attachments: [] }, summary };
}
