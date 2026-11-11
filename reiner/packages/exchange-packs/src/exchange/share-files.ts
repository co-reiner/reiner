/**
 * @file The `share_files` tool: a refreshed full pack for a chat that has the project, otherwise a part pack
 * of files the chat has seen.
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 * @see {@link ../../docs/packs.md#keeping-the-project-current | File exchange: keeping the project current}
 */
import path from 'node:path';
import { shareableFiles } from '@co-reiner/core';
import type { PackResult } from '../pack.ts';
import { hasProject, packPart, partLine, refreshPrimary } from './primary.ts';
import { answer, type Call, plural, refusedLine, type ToolRun } from './tool-run.ts';

type Refused = { path: string; reason: string }[];

/**
 * Send files again. A chat that has the whole project gets a new full pack when anything changed (never a
 * partial one), or is told its newest pack is current. Other chats get a part pack of the files they have
 * seen; anything else is refused, since sending it would widen what the chat has.
 */
export async function shareFiles(run: ToolRun, call: Call<'share_files'>): Promise<void> {
  const wanted = call.all
    ? [...run.ledger]
    : (call.paths ?? []).map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''));
  const asked = `${run.who} asked for ${call.all ? 'all shared files' : wanted.join(', ')}${call.reason ? ` (${call.reason})` : ''}`;
  if (run.pack?.digest) return inFullPack(run, run.pack, wanted, asked);
  if (hasProject(run.s, run.chatId)) return fromProject(run, wanted, asked);
  // An earlier `share_files` in this reply made the part pack (it has one name): keep its files in the new one.
  const earlier = run.pack?.files ?? [];
  const candidates = [...new Set([...earlier, ...wanted.filter((p) => run.ledger.has(p))])];
  const refused: Refused = wanted
    .filter((p) => !run.ledger.has(p))
    .map((p) => ({ path: p, reason: 'not shared in this chat before' }));
  let sent: string[] = [];
  if (candidates.length) {
    run.pack = await packPart(run.ctx, candidates);
    sent = run.pack.files;
    refused.push(...run.pack.refused);
  }
  answer(run, [
    `${sent.length ? `attached ${path.basename(run.pack?.file ?? '')}, a part pack with ${plural(sent.length, 'file')}: ${sent.join(', ')}.` : 'nothing attached.'}`,
    ...refusedLine(refused),
  ]);
  run.summary.push(`${asked}. Sending ${sent.length}${refusedSummary(refused)}.`);
}

/**
 * A `share_project` in the same reply already attached a full pack: it holds every shareable file, so
 * nothing else is packed (a second pack would replace it as the attachment) and the answer points at it.
 */
function inFullPack(run: ToolRun, pack: PackResult, wanted: string[], asked: string): void {
  const held = new Set(pack.files);
  const refused: Refused = wanted
    .filter((p) => !held.has(p))
    .map((p) => ({ path: p, reason: 'not in the project, or not shareable' }));
  const name = path.basename(pack.file);
  answer(run, [
    `nothing more attached: ${name}, attached with this message, is a full pack of the project and holds the files asked for. Unpack it.`,
    ...refusedLine(refused),
  ]);
  run.summary.push(`${asked}. They are in ${name}, sent with this answer${refusedSummary(refused)}.`);
}

/**
 * The chat has the project: send what the next prompt would (a part pack of what changed since its full pack,
 * or a full pack when it was idle), else point at the packs it has.
 */
async function fromProject(run: ToolRun, wanted: string[], asked: string): Promise<void> {
  run.opts.onStatus?.('Checking the project for changes…');
  const inProject = new Set(await shareableFiles(run.ctx.host.root));
  const refused: Refused = wanted
    .filter((p) => !inProject.has(p))
    .map((p) => ({ path: p, reason: 'not in the project, or not shareable' }));
  const refresh = await refreshPrimary(run.ctx, run.chatId);
  if (refresh) {
    run.pack = refresh.pack;
    run.view = refresh.view;
    const base = run.chatId ? run.s.primary[run.chatId] : undefined;
    const what = refresh.pack.digest
      ? `a new full pack with ${plural(refresh.pack.files.length, 'file')}. Use it instead of every older pack.`
      : partLine(refresh.pack, base);
    answer(run, [`attached ${path.basename(refresh.pack.file)}: ${what}`, ...refusedLine(refused)]);
    run.summary.push(`${asked}. ${refresh.note}${refusedSummary(refused)}`);
    return;
  }
  const current = run.chatId ? run.s.primary[run.chatId]?.file : undefined;
  answer(run, [
    `nothing attached: no file changed since ${current ?? 'the newest full pack'} and any newer part pack, which hold them. Unpack them again.`,
    ...refusedLine(refused),
  ]);
  run.summary.push(
    `${asked}. Nothing changed since ${current ?? 'the last full pack'}${refusedSummary(refused)}.`,
  );
}

const refusedSummary = (refused: Refused) =>
  refused.length ? `, refused ${refused.map((r) => `${r.path}: ${r.reason}`).join('; ')}` : '';
