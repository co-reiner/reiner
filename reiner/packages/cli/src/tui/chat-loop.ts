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
  hasToolCalls,
  type ParsedTools,
  type PreparedPrompt,
  type ProjectExchange,
  runSearchTools,
} from '@co-reiner/core';
import { hintSent, runTaskForModel, taskHint } from './checks.ts';
import { type CommandApi, offerChanges } from './commands.ts';
import { type PluginTools, pluginLines, pluginLinesSent, pluginTools } from './plugin-host.ts';
import { sendRound } from './send.ts';

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

/** What a turn starts from: text to send, or the open chat's newest reply, picked up again (`/continue`). */
export type ChatStart = string | { lastReply: true };

/** The next step of a turn: a message to send, or a reply already there to handle. */
type Step = { prepared: PreparedPrompt; original: string } | { reply: ChatReply; chatId: string | undefined };

/**
 * The open chat's newest reply, read back from the page as `/history` reads it, to handle again: after a
 * restart, or when a reply was not handled. Plugins name their tools when the reply is read, so a call to
 * one of them is known.
 */
async function lastReply(d: ChatDeps, module: HarnessModule): Promise<Step | undefined> {
  const name = module.displayName;
  if (!module.readHistory) {
    d.api.print({ kind: 'error', text: `${name} has no chat history to continue from.` });
    return undefined;
  }
  d.setBusy(`Reading ${name}'s last reply…`);
  const [turn] = await module.readHistory({ turns: 1, onStatus: d.setBusy });
  if (!turn?.reply) {
    d.api.print({ kind: 'info', text: 'The open chat has no reply to continue from.' });
    return undefined;
  }
  const chat = await module.currentChat?.().catch(() => undefined);
  d.trackChat(chat);
  d.api.print({ kind: 'info', text: `Continuing from ${name}'s last reply.` });
  void d.api.session.transcript.append({ role: 'event', text: 'continue from the last reply' });
  return { reply: { markdown: turn.reply, stopped: false, elapsedMs: 0 }, chatId: chat?.id };
}

/**
 * Send a prompt to the active harness and stream its reply into the live area below the transcript, or
 * pick up the open chat's last reply again (`/continue`). How the project reaches the model and comes back
 * is the harness's `exchange`: it prepares the prompt, answers tool calls (a few rounds at most) and
 * collects the changes. A harness without one gets the prompt as typed.
 */
export async function runChat(d: ChatDeps, start: ChatStart): Promise<void> {
  const { api } = d;
  const module = api.session.module;
  if (!module) {
    api.print({ kind: 'error', text: 'No harness picked yet. Use /harness <name>.' });
    return;
  }
  if (typeof start === 'string')
    void api.session.transcript.append({ role: 'user', text: start, harness: module.id });
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
      // Once per chat, the prompt says which of the project's checks (and the plugins' tools) the model may ask for.
      const asSent = prompt + (await taskHint(api, chatId)) + (await pluginLines(api, chatId));
      return exchange ? exchange.prepare(asSent, chatId) : { prompt: asSent, attachments: [] };
    };
    let next =
      typeof start === 'string'
        ? { prepared: await prepare(start, d.openChatId), original: start }
        : await lastReply(d, module);
    for (let round = 0; next; round++) {
      const sending = !('reply' in next);
      // Esc while the prompt was being prepared (packing can take a while): nothing has left the machine.
      if (sending && cancelledEarly()) return;
      const { reply, chatId } =
        'reply' in next ? next : await sendRound(d, module, next.prepared, next.original);
      if (sending) {
        if (reply.stopped) return;
        hintSent(api, chatId);
        pluginLinesSent(api, chatId);
      }
      const plugins = await pluginTools(api);
      const tools = extractToolCalls(reply.markdown, plugins.names);
      if (!hasToolCalls(tools)) {
        const found = exchange ? await exchange.collect(reply, d.setBusy) : replyDiffs(reply);
        // What became of the changes (and any failing check the user wants fixed) is the next prompt, so a
        // model that sends one file at a time goes on with the next.
        const followUp = await offerChanges(api, found.sets, found.notes);
        if (!followUp) return;
        api.print({ kind: 'info', text: `Telling ${module.displayName} what was applied…` });
        void api.session.transcript.append({ role: 'user', text: followUp, harness: module.id });
        d.setStreaming('');
        next = { prepared: await prepare(followUp, chatId), original: followUp };
        round = -1;
        continue;
      }
      // Tool calls answered in a row before Reiner stops and hands back to the user (`toolRounds`, /rounds).
      const limit = api.session.config.toolRounds;
      if (round >= limit) {
        api.print({
          kind: 'error',
          text: `Stopped after ${limit} tool rounds in a row. /continue carries on; /rounds changes the limit.`,
        });
        return;
      }
      // Esc counts while the tools run too: the loop sees it before the answer is sent.
      d.setStreaming('');
      const prepared = await answerTools(d, {
        exchange,
        tools,
        plugins,
        chatId,
        harnessName: module.displayName,
      });
      next = { prepared, original: '' };
    }
  } catch (error) {
    api.print({ kind: 'error', text: errorText(error) });
  } finally {
    d.setStreaming(null);
    d.setBusy(null);
    d.refreshCache();
  }
}

/**
 * Run the reply's tool calls and return the message that answers them. The harness's exchange answers them
 * all; without one, core answers the search tools (`glob`, `grep`) and says the file tools are not there.
 */
async function answerTools(
  d: ChatDeps,
  turn: {
    exchange: ProjectExchange | undefined;
    tools: ParsedTools;
    plugins: PluginTools;
    chatId: string | undefined;
    harnessName: string;
  },
): Promise<PreparedPrompt> {
  const { exchange, tools, plugins, chatId, harnessName } = turn;
  d.setBusy('Running the tool call…');
  const ask = {
    confirm: d.api.confirm,
    onStatus: d.setBusy,
    runTask: (name: string, reason?: string) => runTaskForModel(d.api, name, reason),
    callExternal: (name: string, args: Record<string, unknown>) => plugins.call(name, args),
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
