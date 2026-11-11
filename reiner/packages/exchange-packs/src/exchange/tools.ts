/**
 * @file Runs the model's tool calls (`share_files`, `share_project`, `glob`, `grep`) and builds the answer.
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 * @see {@link ../../../../docs/architecture/tool-protocol.md | Tool protocol}
 * @see {@link ../../../../docs/architecture/project-config.md#search-include-and-exclude | Project configuration: search include and exclude}
 */
import path from 'node:path';
import {
  answerSearchCall,
  answerTaskCall,
  INVALID_CALL_ID,
  type ParsedTools,
  searchFilter,
  type ToolCall,
  toolResult,
} from '@co-reiner/core';
import { promptFacts } from '../instructions.ts';
import { packProject } from '../pack.ts';
import { shareFiles } from './share-files.ts';
import {
  outgoingDir,
  type PackPrepared,
  packNotes,
  pad3,
  projectName,
  readTransferState,
  type TransferContext,
} from './store.ts';
import { answer, type Call, plural, refusedLine, type ToolRun, type ToolRunOptions } from './tool-run.ts';

export type { ToolRunOptions } from './tool-run.ts';

/**
 * Run the model's tool calls and build the message that answers them.
 * - `share_files` sends again files this chat has already seen, re-read from disk, through the share
 *   rules. No question: it cannot widen what the chat has seen.
 * - `share_project` sends the whole project in a new pack, as /pack does, after a y/N.
 * - `glob` and `grep` answer inline from the files the share rules allow (search.ts); no question,
 *   because a git-ignored file or one outside the project is never named or read.
 * One reply gets at most one pack, and every result line is true about it: `share_project` calls run first,
 * and once its full pack is attached, `share_files` says the files are in that pack instead of making
 * another (share-files.ts).
 */
export async function runTools(
  ctx: TransferContext,
  parsed: ParsedTools,
  chatId: string | undefined,
  opts: ToolRunOptions = {},
): Promise<{ prepared: PackPrepared; summary: string[] }> {
  const s = await readTransferState(ctx);
  const run: ToolRun = {
    ctx,
    s,
    opts,
    ledger: new Set(chatId ? (s.shared[chatId] ?? []) : []),
    who: ctx.host.displayName,
    lines: [],
    summary: [],
    callId: INVALID_CALL_ID,
    chatId,
    filter: {},
  };
  for (const error of parsed.errors) {
    run.lines.push(toolResult(INVALID_CALL_ID, error));
    run.summary.push(`Tool call not understood: ${error}`);
  }
  if (parsed.calls.some((c) => c.tool === 'glob' || c.tool === 'grep')) await loadFilter(run);
  // The full pack first, so a `share_files` in the same reply knows whether it is attached.
  const whole = parsed.calls.filter((c) => c.tool === 'share_project');
  const rest = parsed.calls.filter((c) => c.tool !== 'share_project');
  for (const call of [...whole, ...rest]) await runOne(run, call);
  const facts = promptFacts({
    project: projectName(ctx),
    sequence: pad3(s.sequence),
    ...(run.pack ? { pack: path.basename(run.pack.file), made: run.pack.made, part: !run.pack.digest } : {}),
  });
  return {
    prepared: {
      prompt: [facts, ...run.lines, 'Continue the task.'].join('\n'),
      attachments: run.pack ? [run.pack.file] : [],
      notes: run.pack ? packNotes(run.pack) : [],
      ...(run.pack ? { pack: run.pack } : {}),
      ...(run.view ? { view: run.view } : {}),
    },
    summary: run.summary,
  };
}

async function runOne(run: ToolRun, call: ToolCall): Promise<void> {
  run.callId = call.callId;
  if (call.tool === 'share_project') return shareProject(run, call);
  if (call.tool === 'share_files') return shareFiles(run, call);
  if (call.tool === 'run_task') {
    // Not a pack tool: the host runs the project's tasks, and its answer goes back with the others.
    const done = await answerTaskCall(call, run.opts, run.who);
    answer(run, done.lines);
    run.summary.push(done.summary);
    return;
  }
  if (run.filterError) {
    answer(run, [`not run: the user's search settings need fixing. Continue without it.`]);
    run.summary.push(`${run.who} asked for ${call.tool} ${call.pattern}, not run: ${run.filterError}`);
    return;
  }
  return search(run, call);
}

/**
 * The user's include/exclude patterns, read fresh. A broken setting stops the search tools only, and the
 * details go to the user, not the model, which cannot fix it.
 */
async function loadFilter(run: ToolRun): Promise<void> {
  try {
    run.filter = searchFilter(await run.ctx.host.settings());
  } catch (e) {
    run.filterError = e instanceof Error ? e.message : String(e);
  }
}

async function shareProject(run: ToolRun, call: Call<'share_project'>): Promise<void> {
  const why = call.reason ? ` (${call.reason})` : '';
  if (run.pack?.digest) {
    // A second `share_project` in one reply: the pack is already attached, so no second question or pack.
    answer(run, [`already attached: ${path.basename(run.pack.file)} above is the whole project.`]);
    return;
  }
  const yes = run.opts.confirm
    ? await run.opts.confirm(`${run.who} asks for the whole project${why}. Pack and upload it?`)
    : false;
  if (!yes) {
    answer(run, [`the user declined; nothing attached. Continue with what you have, or ask the user.`]);
    run.summary.push(`${run.who} asked for the whole project${why}. Not sent.`);
    return;
  }
  run.opts.onStatus?.('Packing the project…');
  const pack = await packProject({
    root: run.ctx.host.root,
    outDir: outgoingDir(run.ctx),
    index: run.s.index,
  });
  run.pack = pack;
  answer(run, [
    `attached ${path.basename(pack.file)} with ${plural(pack.files.length, 'file')}${pack.indexed ? ' and the search index' : ''}.`,
    ...refusedLine(pack.refused),
  ]);
  run.summary.push(
    `${run.who} asked for the whole project${why}. Sending ${pack.files.length} files${pack.refused.length ? `, refused ${pack.refused.length}` : ''}.`,
  );
}

/** `glob` and `grep` are core's own tools: answered there, from the files the share rules allow. */
async function search(run: ToolRun, call: Call<'glob'> | Call<'grep'>): Promise<void> {
  run.opts.onStatus?.(call.tool === 'glob' ? `Listing ${call.pattern}…` : `Searching for ${call.pattern}…`);
  const found = await answerSearchCall(run.ctx.host.root, call, run.filter, run.who);
  answer(run, found.lines);
  run.summary.push(found.summary);
}
