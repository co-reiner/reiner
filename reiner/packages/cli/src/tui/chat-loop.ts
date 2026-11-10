/**
 * @file The chat and tool loop: sends a prompt, streams the reply, answers tool calls for a few rounds,
 * and offers the reply's file changes.
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 * @see {@link ../../../../docs/architecture/tool-protocol.md | Tool protocol}
 * @see {@link ../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import {
  type ChangeSet,
  type ChatInfo,
  type ChatReply,
  diffFiles,
  extractDiffs,
  extractToolCalls,
  type HarnessModule,
  type ParsedTools,
  type PreparedPrompt,
  type ProjectExchange,
  runSearchTools,
} from '@co-reiner/core';
import { hintSent, runTaskForModel, taskHint } from './checks.ts';
import { type CommandApi, offerChanges } from './commands.ts';
import { hasCommand } from './hints.ts';

/** Tool calls answered in a row before Reiner stops and hands back to the user. */
export const MAX_TOOL_ROUNDS = 3;

export interface ChatDeps {
  api: CommandApi;
  setBusy(label: string | null): void;
  /** The reply being written right now (markdown so far), or null when no chat is in progress. */
  setStreaming(markdown: string | null): void;
  trackChat(chat: ChatInfo | undefined): void;
  refreshCache(): void;
  openChatId: string | undefined;
  /** Set by Esc while the turn runs. The loop checks it between steps, before the harness is asked to send. */
  cancel: { current: boolean };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Without an exchange, only a diff the model wrote in its reply can be offered. */
function replyDiffs(reply: ChatReply): { sets: ChangeSet[]; notes: string[] } {
  const sets = extractDiffs(reply.markdown).map(
    (diff): ChangeSet => ({ kind: 'diff', source: 'reply', diff, files: diffFiles(diff) }),
  );
  return { sets, notes: [] };
}

/**
 * Send a prompt to the active harness and stream its reply into the live area below the transcript. How
 * the project reaches the model and comes back is the harness's `exchange`: it prepares the prompt, answers
 * tool calls (a few rounds at most) and collects the changes. A harness without one gets the prompt as typed.
 */
export async function runChat(d: ChatDeps, text: string): Promise<void> {
  const { api } = d;
  const module = api.session.module;
  if (!module) {
    api.print({ kind: 'error', text: 'No harness picked yet. Use /harness <name>.' });
    return;
  }
  void api.session.transcript.append({ role: 'user', text, harness: module.id });
  d.setBusy(`Sending to ${module.displayName}…`);
  d.setStreaming('');
  d.cancel.current = false;
  const cancelledEarly = () => {
    if (!d.cancel.current) return false;
    api.print({ kind: 'info', text: 'Cancelled before anything was sent.' });
    return true;
  };
  try {
    const exchange = module.exchange;
    const prepare = async (prompt: string, chatId: string | undefined): Promise<PreparedPrompt> => {
      // Once per chat, the prompt says which of the project's checks the model may ask for.
      const asSent = prompt + (await taskHint(api, chatId));
      return exchange ? exchange.prepare(asSent, chatId) : { prompt: asSent, attachments: [] };
    };
    let prepared = await prepare(text, d.openChatId);
    let original = text;
    for (let round = 0; ; round++) {
      // Esc while the prompt was being prepared (packing can take a while): nothing has left the machine.
      if (cancelledEarly()) return;
      const { reply, chatId } = await sendRound(d, module, prepared, original);
      if (reply.stopped) return;
      hintSent(api, chatId);
      const tools = extractToolCalls(reply.markdown);
      if (tools.calls.length + tools.errors.length === 0) {
        const found = exchange ? await exchange.collect(reply, d.setBusy) : replyDiffs(reply);
        // A check that failed after the apply, which the user wants fixed: its output is the next prompt.
        const followUp = await offerChanges(api, found.sets, found.notes);
        if (!followUp) return;
        api.print({ kind: 'info', text: `Sending the failing checks to ${module.displayName}…` });
        void api.session.transcript.append({ role: 'user', text: followUp, harness: module.id });
        d.setStreaming('');
        prepared = await prepare(followUp, chatId);
        original = followUp;
        round = -1;
        continue;
      }
      if (round >= MAX_TOOL_ROUNDS) {
        api.print({ kind: 'error', text: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds in a row.` });
        return;
      }
      // Esc counts while the tools run too: the loop sees it before the answer is sent.
      d.setStreaming('');
      prepared = await answerTools(d, exchange, tools, chatId, module.displayName);
      original = '';
    }
  } catch (error) {
    api.print({ kind: 'error', text: errorText(error) });
  } finally {
    d.setStreaming(null);
    d.setBusy(null);
    d.refreshCache();
  }
}

/** One send: attach, stream, print the reply, and record what the chat now has. */
async function sendRound(
  d: ChatDeps,
  module: HarnessModule,
  prepared: PreparedPrompt,
  original: string,
): Promise<{ reply: ChatReply; chatId: string | undefined }> {
  const name = module.displayName;
  for (const note of prepared.notes ?? []) d.api.print({ kind: 'info', text: note });
  d.setStreaming('');
  const reply = await module.send(prepared.prompt, {
    ...(prepared.attachments.length ? { attachments: prepared.attachments } : {}),
    onStatus: (s) => d.setBusy(`${s} (Esc to stop)`),
    onDelta: (markdown) => {
      d.setStreaming(markdown);
      d.setBusy(`${name} is writing… (Esc to stop)`);
    },
  });
  d.setStreaming(null);
  if (reply.notSent) {
    // Cancelled inside the harness before the prompt went: nothing to print or record as sent.
    d.api.print({ kind: 'info', text: `Cancelled before the prompt reached ${name}.` });
    for (const note of reply.notes ?? []) d.api.print({ kind: 'warning', text: note });
    return { reply, chatId: undefined };
  }
  printReply(d.api, module, reply);
  // The first prompt in a new chat creates it in the harness; show it in the status line.
  const current = await module.currentChat?.().catch(() => undefined);
  d.trackChat(current);
  await module.exchange?.afterSend(current?.id, prepared, original);
  return { reply, chatId: current?.id };
}

function printReply(api: CommandApi, module: HarnessModule, reply: ChatReply): void {
  const name = module.displayName;
  const model = reply.model ? { model: reply.model } : {};
  api.print({
    kind: 'assistant',
    markdown: reply.markdown,
    harness: name,
    elapsedMs: reply.elapsedMs,
    stopped: reply.stopped,
    ...model,
  });
  if (reply.closedDocument) {
    api.print({
      kind: 'info',
      text: `Closed the document ${name} opened for co-editing, so it leaves the prompt context.`,
    });
  }
  for (const note of reply.notes ?? []) api.print({ kind: 'warning', text: note });
  if (!reply.markdown && !reply.stopped) {
    api.print({
      kind: 'error',
      text: `No reply text could be read from ${name}. Check the browser window${hasCommand(module, 'history') ? ', or run /history' : ''}.`,
    });
  }
  void api.session.transcript.append({
    role: 'assistant',
    text: reply.markdown,
    harness: module.id,
    elapsedMs: reply.elapsedMs,
    stopped: reply.stopped,
    ...model,
  });
}

/**
 * Run the reply's tool calls and return the message that answers them. The harness's exchange answers them
 * all; without one, core answers the search tools (`glob`, `grep`) and says the file tools are not there.
 */
async function answerTools(
  d: ChatDeps,
  exchange: ProjectExchange | undefined,
  tools: ParsedTools,
  chatId: string | undefined,
  harnessName: string,
): Promise<PreparedPrompt> {
  d.setBusy('Running the tool call…');
  const ask = {
    confirm: d.api.confirm,
    onStatus: d.setBusy,
    runTask: (name: string, reason?: string) => runTaskForModel(d.api, name, reason),
  };
  const { session } = d.api;
  const result = exchange
    ? await exchange.runTools(tools, chatId, ask)
    : await runSearchTools(tools, {
        ...ask,
        root: session.root,
        who: harnessName,
        settings: () => session.harnessSettings(),
      });
  for (const line of result.summary) d.api.print({ kind: 'info', text: line });
  void d.api.session.transcript.append({ role: 'event', text: `tools: ${result.summary.join(' | ')}` });
  d.setBusy(`Sending the tool result to ${harnessName}…`);
  return result.prepared;
}
