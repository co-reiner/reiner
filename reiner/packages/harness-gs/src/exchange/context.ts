/**
 * @file What the Google Search exchange keeps while a session runs, its two ways of carrying files, and
 * the choice between them.
 * @see {@link ../../docs/file-exchange.md#how-files-travel | Google Search file exchange: how files travel}
 */
import path from 'node:path';
import { type ChatReply, type FileFilter, readState, searchFilter } from '@co-reiner/core';
import { bundleFiles, quoteFiles, type SharedFile, sizeOf, TEXT_LIMIT, UPLOAD_LIMIT } from './files.ts';

/** How shared files travel: quoted in the prompt, or as one text file through the page's upload button. */
export type ShareMode = 'text' | 'upload';
export const SHARE_MODES: { id: ShareMode; detail: string }[] = [
  { id: 'text', detail: 'files are quoted in the prompt' },
  { id: 'upload', detail: 'files go as one text file through the "+" button' },
];

export interface ExchangeHost {
  root: string;
  stateDir: string;
  /** The harness's name, for the lines shown to the user. */
  displayName: string;
  /** The harness's settings read fresh, for search `include` and `exclude`. */
  settings(): Promise<Record<string, unknown>>;
}

/** What the exchange keeps while the session runs. */
export interface ExchangeContext extends ExchangeHost {
  /** Files the user queued with /share, to go with the next prompt. */
  pending: string[];
  /** Conversations that have had the briefing. */
  briefed: Set<string>;
  /** Files sent in the open conversation, for `share_files` with `all`. */
  seen: Set<string>;
  lastReply: ChatReply | undefined;
  /** Uploaded files so far, so each gets its own name. */
  uploads: number;
}

export async function readMode(ctx: ExchangeHost): Promise<ShareMode> {
  const saved = await readState<{ mode?: string }>(ctx.stateDir, 'exchange');
  return saved?.mode === 'upload' ? 'upload' : 'text';
}

/** The user's search `include` and `exclude`; a broken setting counts as none here. */
export async function filterOf(ctx: ExchangeHost): Promise<FileFilter> {
  try {
    return searchFilter(await ctx.settings());
  } catch {
    return {};
  }
}

/**
 * Files as they go with one message: quoted (text mode) or gathered into one upload. Returns the text to
 * add to the message and the file to attach, or throws when they fit neither.
 */
export async function carry(
  ctx: ExchangeContext,
  files: SharedFile[],
): Promise<{ text: string; attachments: string[] }> {
  if (files.length === 0) return { text: '', attachments: [] };
  const size = sizeOf(files);
  if ((await readMode(ctx)) === 'text') {
    if (size > TEXT_LIMIT) {
      throw new Error(
        `These files are too long to quote in one prompt (${size} characters; the limit is ${TEXT_LIMIT}). Share fewer, or switch with /transfer upload.`,
      );
    }
    for (const f of files) ctx.seen.add(f.path);
    return { text: quoteFiles(files), attachments: [] };
  }
  if (size > UPLOAD_LIMIT) {
    throw new Error(`These files are too large to upload as one text file (${size} characters).`);
  }
  const name = `project-files-${++ctx.uploads}.txt`;
  const file = await bundleFiles(path.join(ctx.stateDir, 'outbox'), name, files);
  for (const f of files) ctx.seen.add(f.path);
  const names = files.map((f) => f.path).join(', ');
  return {
    text: `The attached file ${name} holds these files of my project, each under a line "===== <path> =====": ${names}.`,
    attachments: [file],
  };
}
