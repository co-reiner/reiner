/**
 * @file Answering a reply's tool calls: the search tools and `run_task` through core, and the two tools
 * that send files (`share_files`, `share_project`) in this exchange's own way.
 * @see {@link ../../docs/file-exchange.md#tools | Google Search file exchange: tools}
 * @see {@link ../../../../docs/architecture/tool-protocol.md#who-answers-a-call | Tool protocol: who answers a call}
 */
import {
  answerSearchCall,
  answerTaskCall,
  INVALID_CALL_ID,
  type ParsedTools,
  type PreparedPrompt,
  shareableFiles,
  type ToolCall,
  type ToolRunOptions,
  toolResult,
} from '@co-reiner/core';
import { carry, type ExchangeContext, filterOf, readMode } from './context.ts';
import { readShared, refusedLine, type SharedFile, sizeOf, TEXT_LIMIT } from './files.ts';

/** One run over a reply's calls: the answer lines, the files to send with them, the lines for the user. */
interface Run {
  ctx: ExchangeContext;
  opts: ToolRunOptions;
  lines: string[];
  summary: string[];
  files: Map<string, SharedFile>;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

async function shareFiles(run: Run, call: Extract<ToolCall, { tool: 'share_files' }>): Promise<void> {
  const who = run.ctx.displayName;
  const wanted = call.all
    ? [...run.ctx.seen]
    : (call.paths ?? []).map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''));
  const { files, refused } = await readShared(run.ctx.root, wanted);
  for (const f of files) run.files.set(f.path, f);
  const sent = files.length ? `${plural(files.length, 'file')} sent with this message` : 'nothing sent';
  run.lines.push(toolResult(call.callId, [`${sent}.`, ...refusedLine(refused)].join(' ')));
  run.summary.push(
    `${who} asked for ${call.all ? 'the shared files again' : wanted.join(', ')}. Sending ${files.length}${refused.length ? `, refused ${refused.length}` : ''}.`,
  );
}

async function shareProject(run: Run, call: Extract<ToolCall, { tool: 'share_project' }>): Promise<void> {
  const who = run.ctx.displayName;
  const ok = await run.opts.confirm?.(`${who} asks for the whole project. Send its file list and content?`);
  if (!ok) {
    run.lines.push(toolResult(call.callId, 'the user declined to share the whole project.'));
    run.summary.push(`${who} asked for the whole project: not sent.`);
    return;
  }
  const paths = await shareableFiles(run.ctx.root, await filterOf(run.ctx));
  const { files } = await readShared(run.ctx.root, paths);
  // Quoted content has to fit a prompt; an upload takes far more. Too big: the list alone, to pick from.
  const fits = (await readMode(run.ctx)) === 'upload' || sizeOf(files) <= TEXT_LIMIT;
  if (fits) for (const f of files) run.files.set(f.path, f);
  const list = [`${plural(paths.length, 'file')} in the project:`, ...paths];
  const tail = fits
    ? 'Their content is sent with this message.'
    : 'The content is too long for one message: ask for the files you need with share_files.';
  run.lines.push(toolResult(call.callId, [...list, tail].join('\n')));
  run.summary.push(`${who} asked for the whole project: sent the list${fits ? ' and the content' : ''}.`);
}

/** Answer every call of a reply, and build the message that carries the answers and any files. */
export async function answerCalls(
  ctx: ExchangeContext,
  parsed: ParsedTools,
  opts: ToolRunOptions,
): Promise<{ prepared: PreparedPrompt; summary: string[] }> {
  const run: Run = { ctx, opts, lines: [], summary: [], files: new Map() };
  const who = ctx.displayName;
  for (const error of parsed.errors) {
    run.lines.push(toolResult(INVALID_CALL_ID, error));
    run.summary.push(`Tool call not understood: ${error}`);
  }
  const filter = await filterOf(ctx);
  for (const call of parsed.calls) {
    if (call.tool === 'share_files') await shareFiles(run, call);
    else if (call.tool === 'share_project') await shareProject(run, call);
    else {
      if (call.tool !== 'run_task') {
        opts.onStatus?.(call.tool === 'glob' ? `Listing ${call.pattern}…` : `Searching for ${call.pattern}…`);
      }
      const answer =
        call.tool === 'run_task'
          ? await answerTaskCall(call, opts, who)
          : await answerSearchCall(ctx.root, call, filter, who);
      run.lines.push(toolResult(call.callId, answer.lines.join('\n')));
      run.summary.push(answer.summary);
    }
  }
  let carried = { text: '', attachments: [] as string[] };
  try {
    carried = await carry(ctx, [...run.files.values()]);
  } catch (e) {
    // Too long to send: the model is told, so it can ask for less.
    const why = e instanceof Error ? e.message : String(e);
    run.lines.push(
      'The files asked for were not sent: together they are too long for one message. Ask for fewer.',
    );
    run.summary.push(why);
  }
  const prompt = [...run.lines, ...(carried.text ? ['', carried.text, ''] : []), 'Continue the task.'].join(
    '\n',
  );
  return { prepared: { prompt, attachments: carried.attachments }, summary: run.summary };
}
