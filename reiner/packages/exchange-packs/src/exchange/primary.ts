/**
 * @file Keeping each chat's copy of the project current: a full pack when the chat has been idle or has none,
 * otherwise a part pack with everything changed since its full pack and the files deleted since.
 * @see {@link ../../docs/packs.md#keeping-the-project-current | File exchange: keeping the project current}
 * @see {@link ../../docs/packs.md#outbound-packs | File exchange: packs}
 */
import path from 'node:path';
import {
  type PackResult,
  packProject,
  partPackName,
  projectSnapshot,
  snapshotChanges,
  snapshotDigest,
} from '../pack.ts';
import {
  outgoingDir,
  projectName,
  readTransferState,
  type TransferContext,
  type TransferState,
} from './store.ts';

/** Minutes a chat may be idle before its next prompt carries a full pack again (`staleMinutes` setting). */
export const STALE_MINUTES = 10;

/** True when this chat has had a full pack, so it has the whole project and is kept current. */
export function hasProject(s: TransferState, chatId: string | undefined): boolean {
  return chatId !== undefined && s.primary[chatId] !== undefined;
}

export interface Refresh {
  pack: PackResult;
  /** The digest of what the chat has once this pack is in, recorded after the send. */
  view: string;
  /** Why it goes, for the TUI. */
  note: string;
}

/** The harness's `staleMinutes` setting, read fresh; 10 when unset or not a positive number. */
async function staleMinutes(ctx: TransferContext): Promise<number> {
  const value = (await ctx.host.settings()).staleMinutes;
  return typeof value === 'number' && value > 0 ? value : STALE_MINUTES;
}

/**
 * What a chat that has the project needs before the next prompt, or undefined when its copy is current:
 * - idle longer than `staleMinutes` (its sandbox may have been reset): a new full pack;
 * - files changed since what it has: a part pack with every file changed since its full pack, and the
 *   files deleted since in `.reiner/deleted.txt`, so the newest part alone is enough on top of the full pack.
 */
export async function refreshPrimary(
  ctx: TransferContext,
  chatId: string | undefined,
): Promise<Refresh | undefined> {
  const s = await readTransferState(ctx);
  if (!chatId || !hasProject(s, chatId)) return undefined;
  const known = s.primary[chatId];
  const now = await projectSnapshot(ctx.host.root);
  const view = snapshotDigest(now);
  const last = s.lastSent[chatId];
  const idle = last ? (Date.now() - Date.parse(last)) / 60_000 : Number.POSITIVE_INFINITY;
  if (idle >= (await staleMinutes(ctx))) {
    const why = Number.isFinite(idle)
      ? `The chat was idle for ${Math.round(idle)} min`
      : 'This chat has no recent prompt';
    return full(ctx, s, `${why}: sending a fresh full pack in case its sandbox was reset.`);
  }
  if ((known?.seen ?? known?.digest) === view) return undefined;
  const changes = known?.files ? snapshotChanges(known.files, now) : undefined;
  if (!changes || changes.changed.length + changes.deleted.length === 0)
    return full(
      ctx,
      s,
      `The project changed${known ? ` since ${known.file}` : ''}: sending an up-to-date full pack.`,
    );
  const pack = await packProject({
    root: ctx.host.root,
    outDir: outgoingDir(ctx),
    fileName: partPackName(projectName(ctx)),
    files: changes.changed,
    deletedList: changes.deleted,
    ...(known?.made ? { base: known.made } : {}),
    index: false,
  });
  const counts = `${changes.changed.length} changed${changes.deleted.length ? `, ${changes.deleted.length} deleted` : ''}`;
  return { pack, view, note: `Files changed since ${known?.file}: sending a part pack (${counts}).` };
}

async function full(ctx: TransferContext, s: TransferState, note: string): Promise<Refresh> {
  const pack = await packProject({ root: ctx.host.root, outDir: outgoingDir(ctx), index: s.index });
  return { pack, view: pack.digest ?? '', note };
}

/** Record what a chat has after a send that carried this pack (`view` for a part pack). */
export function withPack(s: TransferState, chatId: string, pack: PackResult, view?: string): TransferState {
  if (pack.digest) {
    const files = pack.snapshot ? { files: pack.snapshot } : {};
    const record = {
      file: path.basename(pack.file),
      digest: pack.digest,
      made: pack.made,
      seen: pack.digest,
      ...files,
    };
    return { ...s, primary: { ...s.primary, [chatId]: record } };
  }
  const known = s.primary[chatId];
  if (!known || !view) return s;
  return { ...s, primary: { ...s.primary, [chatId]: { ...known, seen: view } } };
}

/** Some of the project's files as the part pack `<project>.part.zip.docx` (for chats without a full pack). */
export function packPart(ctx: TransferContext, files: string[]): Promise<PackResult> {
  return packProject({
    root: ctx.host.root,
    outDir: outgoingDir(ctx),
    fileName: partPackName(projectName(ctx)),
    files,
    index: false,
  });
}

/** The line a prompt carries for a part pack: what it builds on, and what to delete. */
export function partLine(pack: PackResult, base: { file: string; made?: string } | undefined): string {
  const on = base
    ? ` It holds every file changed since ${base.file}${base.made ? ` made=${base.made}` : ''}`
    : ' It holds only the files it lists';
  const gone = pack.deleted.length ? `; these files are gone, remove them: ${pack.deleted.join(', ')}` : '';
  return `Part pack ${path.basename(pack.file)}.${on}${gone}.`;
}
