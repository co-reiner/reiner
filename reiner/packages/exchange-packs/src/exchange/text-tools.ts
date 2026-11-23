/**
 * @file `share_files` and `share_project` in the `messages` mode: the files asked for go quoted with the
 * answer, up to the message's limit; the project goes as its file list. Nothing is uploaded.
 * @see {@link ../../docs/packs.md#the-messages-mode | File exchange: the messages mode}
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 */
import { projectList, quotedLines, quoteFiles } from '../text.ts';
import { textLimit } from './store.ts';
import { answer, type Call, type ToolRun } from './tool-run.ts';

/** What is left of this answer's limit for quoted files. */
const budget = (run: ToolRun) => textLimit(run.ctx) - (run.text ?? []).reduce((n, t) => n + t.length, 0);

/** Add quoted files to the answer, and remember them as seen by the chat. */
function carry(run: ToolRun, text: string, sent: string[]): void {
  if (text) run.text = [...(run.text ?? []), text];
  run.quoted = [...(run.quoted ?? []), ...sent];
}

/**
 * Quote the files asked for. Any file the share rules allow may be asked for: in this mode the model may only
 * have seen the file list. What does not fit this message is named, for a later call.
 */
export async function shareFilesText(run: ToolRun, call: Call<'share_files'>): Promise<void> {
  const wanted = call.all
    ? [...run.ledger]
    : (call.paths ?? []).map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''));
  run.opts.onStatus?.('Reading the files…');
  const q = await quoteFiles(run.ctx.host.root, wanted, budget(run));
  carry(run, q.text, q.sent);
  answer(run, quotedLines(q));
  const why = call.reason ? ` (${call.reason})` : '';
  run.summary.push(
    `${run.who} asked for ${call.all ? 'all shared files' : wanted.join(', ')}${why}. Quoting ${q.sent.length}${q.left.length ? `, ${q.left.length} left for later` : ''}${q.refused.length ? `, refused ${q.refused.length}` : ''}.`,
  );
}

/** The whole project: its file list only, as /pack sends it; after a y/N, as with a pack. */
export async function shareProjectText(run: ToolRun, call: Call<'share_project'>): Promise<void> {
  const why = call.reason ? ` (${call.reason})` : '';
  const yes = run.opts.confirm
    ? await run.opts.confirm(`${run.who} asks for the whole project${why}. Send its file list?`)
    : false;
  if (!yes) {
    answer(run, ['the user declined; nothing sent. Continue with what you have, or ask the user.']);
    run.summary.push(`${run.who} asked for the whole project${why}. Not sent.`);
    return;
  }
  run.opts.onStatus?.('Reading the project…');
  const project = await projectList(run.ctx.host.root);
  answer(run, [project.intro]);
  run.summary.push(`${run.who} asked for the whole project${why}. Sending its file list (${project.count}).`);
}
