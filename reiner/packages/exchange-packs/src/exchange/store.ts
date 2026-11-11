/**
 * @file What the pieces of the pack exchange share: the host a harness gives it, its saved state, the pack
 * waiting for the next prompt, and the instruction sections for the current settings.
 * @see {@link ../../../../docs/architecture/file-exchange.md | File exchange}
 * @see {@link ../../../../docs/architecture/modules.md#file-exchange | Harness modules: file exchange}
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { type ChatReply, type PreparedPrompt, readState, writeState } from '@co-reiner/core';
import {
  buildSections,
  type InstructionSection,
  renderSections,
  type TransferMode,
  type TransferSupport,
} from '../instructions.ts';
import { type PackResult, type ProjectSnapshot, packBaseName } from '../pack.ts';

/**
 * What the pack exchange needs from the harness that uses it. The harness builds this from its
 * `HarnessContext`; the exchange never sees the host (the CLI) or the harness module itself.
 */
export interface PackHost {
  /** The project root. */
  root: string;
  /** The project's `.reiner/` folder: packs are made in `outgoing/`, received files saved in `incoming/`. */
  reinerDir: string;
  /** The harness's state folder: the exchange keeps `transfer.json` there. */
  stateDir: string;
  /** The harness's name, for messages to the user. */
  displayName: string;
  /** The harness's settings, read fresh (`staleMinutes`, search `include` and `exclude`). */
  settings(): Promise<Record<string, unknown>>;
  /** The reply modes the harness offers and whether its packs may carry the search index. */
  support: TransferSupport;
}

/** The exchange's settings and what each chat has, kept per project and harness in `transfer.json`. */
export interface TransferState {
  /** The id of the current reply mode. */
  mode: string;
  /** Add the SQLite search index to packs. */
  index: boolean;
  /** Next patch number. */
  sequence: number;
  /** Per chat id: the instruction signature last sent there, so sections are not repeated every prompt. */
  briefed: Record<string, string>;
  /** The signature of the sections saved in the harness's custom instructions (/instructions sync). */
  synced?: string;
  /**
   * Per chat id: project files uploaded there. Only these can be asked for again with `share_files`
   * (`share_project` sends everything, after a y/N).
   */
  shared: Record<string, string[]>;
  /**
   * Per chat id: the full pack it has (`file`, the project's `digest` then, and each file's `files` snapshot,
   * to list changes since), and `seen`, the digest of what the chat has now (the full pack, or it plus the
   * latest part pack). Before each prompt the exchange sends what changed since.
   */
  primary: Record<
    string,
    { file: string; digest: string; made?: string; files?: ProjectSnapshot; seen?: string }
  >;
  /** Per chat id: when a prompt was last sent there (ISO time), to tell when its sandbox may be stale. */
  lastSent: Record<string, string>;
}

/** A prepared prompt as the exchange makes it: it also remembers the pack that goes, to record it after the send. */
export interface PackPrepared extends PreparedPrompt {
  pack?: PackResult;
  /** For a part pack: the digest of what the chat has once it is in (see `withPack`). */
  view?: string;
  /**
   * How this prompt tells the model about the exchange, recorded for the chat after the send: `sections`
   * when it carries the instruction sections itself, `synced` when it carries only the facts line because
   * the sections are saved in the harness's custom instructions. Absent for a prompt that goes as typed and
   * for a tool answer, which never carries the sections.
   */
  briefs?: 'sections' | 'synced';
}

/** What `briefed` holds for a chat that relies on the saved custom instructions, not on a prompt. */
export const BRIEFED_BY_SYNC = 'synced';

/** What the exchange's pieces share: its host, the pack waiting for the next prompt, and the last reply. */
export interface TransferContext {
  host: PackHost;
  /** A pack made with /pack, sent with the next prompt. */
  pending?: PackResult | undefined;
  /** The last reply, for /apply. */
  lastReply?: ChatReply | undefined;
}

export const pad3 = (n: number) => String(n).padStart(3, '0');

export const support = (ctx: TransferContext): TransferSupport => ctx.host.support;
export const projectName = (ctx: TransferContext) => packBaseName(ctx.host.root);
export const incomingDir = (ctx: TransferContext) => path.join(ctx.host.reinerDir, 'incoming');
export const outgoingDir = (ctx: TransferContext) => path.join(ctx.host.reinerDir, 'outgoing');

/** The mode a state names, or the harness's default when that mode is no longer offered. */
export function currentMode(ctx: TransferContext, s: TransferState): TransferMode {
  const { modes, defaultMode } = support(ctx);
  const mode = modes.find((m) => m.id === s.mode) ?? modes.find((m) => m.id === defaultMode) ?? modes[0];
  if (!mode) throw new Error(`${ctx.host.displayName} offers no reply mode.`);
  return mode;
}

/**
 * State saved before full packs were tracked has no `primary`: its chats got whole-project packs then, so
 * they count as having the project, with a digest that never matches, so the next prompt refreshes it.
 */
function earlierPrimary(shared: Record<string, string[]> | undefined): TransferState['primary'] {
  return Object.fromEntries(
    Object.keys(shared ?? {}).map((id) => [id, { file: 'an earlier pack', digest: '' }]),
  );
}

export async function readTransferState(ctx: TransferContext): Promise<TransferState> {
  const t = support(ctx);
  const saved = await readState<Partial<TransferState>>(ctx.host.stateDir, 'transfer');
  const mode = saved?.mode && t.modes.some((m) => m.id === saved.mode) ? saved.mode : t.defaultMode;
  return {
    mode,
    index: (saved?.index ?? true) && t.index,
    sequence: saved?.sequence ?? 1,
    briefed: saved?.briefed ?? {},
    shared: saved?.shared ?? {},
    primary: saved?.primary ?? earlierPrimary(saved?.shared),
    lastSent: saved?.lastSent ?? {},
    ...(saved?.synced ? { synced: saved.synced } : {}),
  };
}

export async function saveTransferState(ctx: TransferContext, next: TransferState): Promise<void> {
  await writeState(ctx.host.stateDir, 'transfer', next);
}

/** The instruction sections for a state's mode and index setting. */
export function sectionsFor(ctx: TransferContext, s: TransferState): InstructionSection[] {
  return buildSections({ mode: currentMode(ctx, s), index: s.index });
}

/** Mode, index setting and a hash of the section text: any change means the sections must go again. */
export function signature(ctx: TransferContext, s: TransferState): string {
  const text = renderSections(sectionsFor(ctx, s));
  return `${s.mode}|index=${s.index}|${createHash('sha256').update(text).digest('hex').slice(0, 12)}`;
}

/** What to tell the user about a pack that goes with a message. */
export function packNotes(p: PackResult): string[] {
  const size = `${p.files.length} files, ${(p.bytes / 1024).toFixed(0)} KB${p.indexed ? `, ${p.indexed} indexed` : ''}`;
  return [
    `Attaching ${path.basename(p.file)} (${size}).`,
    ...(p.refused.length
      ? [`Not shared: ${p.refused.map((r) => `${r.path} (${r.reason})`).join(', ')}`]
      : []),
  ];
}
