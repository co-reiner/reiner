/**
 * @file Packs for the next prompt, the prompt as sent (facts line and sections), and what each chat has had.
 * @see {@link ../../docs/packs.md#outbound-packs | File exchange: packs}
 * @see {@link ../../docs/packs.md#where-the-sections-live | File exchange: where the sections live}
 * @see {@link ../../docs/packs.md#keeping-the-project-current | File exchange: keeping the project current}
 */
import path from 'node:path';
import { promptFacts, renderSections } from '../instructions.ts';
import { type PackResult, packProject } from '../pack.ts';
import { partLine, refreshPrimary, withPack } from './primary.ts';
import {
  BRIEFED_BY_SYNC,
  outgoingDir,
  type PackPrepared,
  packNotes,
  pad3,
  projectName,
  readTransferState,
  saveTransferState,
  sectionsFor,
  signature,
  type TransferContext,
} from './store.ts';

/** Packing for the next prompt, building the prompt as sent, and recording what each chat has had. */
export function promptMethods(ctx: TransferContext) {
  return {
    pending: () => ctx.pending,

    /** The whole project as a full pack, for the next prompt. Changes after it go as part packs. */
    async pack(): Promise<PackResult> {
      const s = await readTransferState(ctx);
      const pack = await packProject({ root: ctx.host.root, outDir: outgoingDir(ctx), index: s.index });
      ctx.pending = pack;
      return pack;
    },

    prepare: (text: string, chatId: string | undefined) => prepare(ctx, text, chatId),

    /** Record that a chat has the current sections (call after a send that carried them). */
    async briefed(chatId: string | undefined): Promise<void> {
      if (!chatId) return;
      const s = await readTransferState(ctx);
      await saveTransferState(ctx, { ...s, briefed: { ...s.briefed, [chatId]: signature(ctx, s) } });
    },

    /**
     * After a send: remember how the chat was told about the exchange (`sent.briefs`) and which files it
     * has seen (when a pack went with it). The chat id is only known after the first send of a new chat.
     * A tool answer has no `briefs`, so answering a tool call never counts as briefing the chat.
     */
    async afterSend(chatId: string | undefined, sent: PackPrepared, _userText: string): Promise<void> {
      // The /pack pack has gone out. `prepare` leaves it waiting, so a send that fails can be retried with it.
      if (sent.pack && sent.pack === ctx.pending) ctx.pending = undefined;
      if (!chatId) return;
      const s = await readTransferState(ctx);
      const next = { ...s, lastSent: { ...s.lastSent, [chatId]: new Date().toISOString() } };
      if (sent.briefs) {
        const how = sent.briefs === 'sections' ? signature(ctx, s) : BRIEFED_BY_SYNC;
        next.briefed = { ...s.briefed, [chatId]: how };
      }
      if (sent.pack) {
        const before = s.shared[chatId] ?? [];
        next.shared = { ...s.shared, [chatId]: [...new Set([...before, ...sent.pack.files])].sort() };
      }
      await saveTransferState(ctx, sent.pack ? withPack(next, chatId, sent.pack, sent.view) : next);
    },
  };
}

/**
 * The prompt as sent: the facts line, the instruction sections when this chat has not had them in their
 * current form (or a pack is attached), then the user's text.
 */
async function prepare(
  ctx: TransferContext,
  text: string,
  chatId: string | undefined,
): Promise<PackPrepared> {
  // A chat that has the project gets what changed (a part pack), or a full pack when it was idle, like
  // re-running the pack script before each question; a pack made with /pack goes first.
  const refresh = ctx.pending ? undefined : await refreshPrimary(ctx, chatId);
  const s = await readTransferState(ctx);
  const pack = ctx.pending ?? refresh?.pack;
  const sent = chatId ? s.briefed[chatId] : undefined;
  // A chat has files when a pack ever went to it, with a prompt or with a tool answer.
  const hasFiles =
    chatId !== undefined && (s.primary[chatId] !== undefined || (s.shared[chatId]?.length ?? 0) > 0);
  // Chats that never got a pack do not need the file-exchange text at all.
  if (!pack && sent === undefined && !hasFiles) return { prompt: text, attachments: [] };
  // Sections go once per chat, and again when the mode or index setting changed since. When they are
  // saved in the harness's custom instructions in their current form, the facts line is enough.
  const synced = s.synced === signature(ctx, s);
  const needsSections = !synced && sent !== signature(ctx, s);
  const lines = [
    promptFacts({
      project: projectName(ctx),
      sequence: pad3(s.sequence),
      ...(pack ? { pack: path.basename(pack.file), made: pack.made, part: !pack.digest } : {}),
    }),
  ];
  if (pack && !pack.digest) lines.push(partLine(pack, chatId ? s.primary[chatId] : undefined));
  if (needsSections) lines.push('', renderSections(sectionsFor(ctx, s)).trim());
  lines.push('', text);
  // `ctx.pending` stays until `afterSend`: if the send throws, the pack is still there for the retry.
  return {
    prompt: lines.join('\n'),
    attachments: pack ? [pack.file] : [],
    notes: [...(refresh ? [refresh.note] : []), ...(pack ? packNotes(pack) : [])],
    // Recorded after the send. A chat that had the sections in a prompt keeps that record while synced.
    ...(needsSections
      ? { briefs: 'sections' as const }
      : synced && sent !== signature(ctx, s)
        ? { briefs: 'synced' as const }
        : {}),
    ...(pack ? { pack } : {}),
    ...(refresh ? { view: refresh.view } : {}),
  };
}
