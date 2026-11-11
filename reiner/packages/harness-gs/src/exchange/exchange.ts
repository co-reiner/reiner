/**
 * @file The Google Search harness's file exchange: files go quoted in the prompt or as one uploaded text
 * file, changes come back as a diff in the reply, and the reply's tool calls are answered here.
 * @see {@link ../../docs/file-exchange.md | Google Search file exchange}
 * @see {@link ../../../../docs/architecture/modules.md#file-exchange | Harness modules: file exchange}
 */
import {
  type ChangeSet,
  type ChatReply,
  diffFiles,
  extractDeletions,
  extractDiffs,
  type PreparedPrompt,
  type ProjectExchange,
  shareableFiles,
  writeState,
} from '@co-reiner/core';
import { briefing } from './brief.ts';
import {
  carry,
  type ExchangeContext,
  type ExchangeHost,
  filterOf,
  readMode,
  type ShareMode,
} from './context.ts';
import { expandPaths, type Refusal, readShared, refusedLine } from './files.ts';
import { extractNeededFiles, extractWholeFiles, isWebResults } from './reply-files.ts';
import { answerCalls } from './tools.ts';

type Collected = { sets: ChangeSet[]; notes: string[] };

export interface GsExchange extends ProjectExchange {
  mode(): Promise<ShareMode>;
  setMode(mode: ShareMode): Promise<void>;
  /** Queue files (paths or globs) to go with the next prompt. Returns what is queued now. */
  queue(args: string[]): Promise<{ queued: string[]; refused: Refusal[] }>;
  pending(): string[];
  clearPending(): void;
  /** The last reply's changes again. */
  recollect(): Promise<Collected>;
  /** A new conversation started: nothing has been shared in it yet. */
  reset(): void;
}

/** The changes a reply carries: whole files under "File:" lines, a diff, and files to delete. */
function changes(reply: ChatReply): ChangeSet[] {
  const sets: ChangeSet[] = extractDiffs(reply.markdown).map((diff) => ({
    kind: 'diff',
    source: 'reply',
    diff,
    files: diffFiles(diff),
  }));
  const whole = extractWholeFiles(reply.markdown);
  if (whole.length) {
    const writes = whole.map((f) => ({ path: f.path, data: new TextEncoder().encode(f.text) }));
    sets.push({ kind: 'files', source: 'reply (whole files)', writes, deletes: [] });
  }
  const gone = extractDeletions(reply.markdown);
  if (gone.length) sets.push({ kind: 'files', source: 'reply (to delete)', writes: [], deletes: gone });
  return sets;
}

/**
 * After a reply: its changes, and the files it asks to see. Those are queued for the next prompt (the
 * share rules decide which may go), so the user answers with one more line.
 */
async function collect(ctx: ExchangeContext, reply: ChatReply, again = false): Promise<Collected> {
  ctx.lastReply = reply;
  const notes: string[] = [];
  if (isWebResults(reply.markdown)) {
    notes.push(
      `${ctx.displayName} answered with web results, not a reply of its own. It does that when a prompt reads like a search: share the file it is about (/share <path>) and ask again in plain words.`,
    );
  }
  const needed = again ? [] : extractNeededFiles(reply.markdown);
  if (needed.length) {
    const { files, refused } = await readShared(ctx.root, needed);
    ctx.pending = [...new Set([...ctx.pending, ...files.map((f) => f.path)])];
    if (files.length) {
      notes.push(
        `${ctx.displayName} asks to see ${files.map((f) => f.path).join(', ')}: queued for your next prompt (/share clear drops them).`,
      );
    }
    notes.push(...refusedLine(refused));
  }
  return { sets: changes(reply), notes };
}

export function createGsExchange(host: ExchangeHost): GsExchange {
  const ctx: ExchangeContext = {
    ...host,
    pending: [],
    briefed: new Set(),
    seen: new Set(),
    lastReply: undefined,
    uploads: 0,
  };
  /** Files that went with the prompt being sent, taken off the queue once it has gone. */
  let inFlight: string[] = [];

  return {
    async prepare(text, chatId): Promise<PreparedPrompt> {
      const parts: string[] = [];
      const notes: string[] = [];
      parts.push(text);
      const { files, refused } = await readShared(ctx.root, ctx.pending);
      const carried = await carry(ctx, files);
      if (carried.text) parts.push(carried.text);
      // AI mode keeps no instructions between conversations: each one's first prompt carries them.
      if (!chatId || !ctx.briefed.has(chatId)) {
        const listed = await shareableFiles(ctx.root, await filterOf(ctx)).catch(() => []);
        parts.push(briefing(listed));
      }
      if (files.length) notes.push(`Sharing ${files.map((f) => f.path).join(', ')}.`);
      notes.push(...refusedLine(refused));
      inFlight = [...ctx.pending];
      return {
        prompt: parts.join('\n\n'),
        attachments: carried.attachments,
        ...(notes.length ? { notes } : {}),
      };
    },
    async afterSend(chatId) {
      if (chatId) ctx.briefed.add(chatId);
      ctx.pending = ctx.pending.filter((p) => !inFlight.includes(p));
      inFlight = [];
    },
    collect: (reply) => collect(ctx, reply),
    runTools: (calls, _chatId, opts = {}) => answerCalls(ctx, calls, opts),
    async applied() {},

    mode: () => readMode(ctx),
    setMode: (mode) => writeState(ctx.stateDir, 'exchange', { mode }),
    async queue(args) {
      const paths = await expandPaths(ctx.root, args, await filterOf(ctx));
      const { files, refused } = await readShared(ctx.root, paths);
      ctx.pending = [...new Set([...ctx.pending, ...files.map((f) => f.path)])];
      return { queued: [...ctx.pending], refused };
    },
    pending: () => [...ctx.pending],
    clearPending() {
      ctx.pending = [];
    },
    async recollect() {
      if (!ctx.lastReply) return { sets: [], notes: ['No reply to apply from yet in this session.'] };
      return collect(ctx, ctx.lastReply, true);
    },
    reset() {
      ctx.seen.clear();
    },
  };
}
