/**
 * @file Project files as text in a message, for the `messages` mode: no upload at all. The project goes as its
 * file list; the files the model asks for go quoted under their paths, up to a limit per message, and the
 * rest is named so the model asks for it again.
 * @see {@link ../docs/packs.md#the-messages-mode | File exchange: the messages mode}
 * @see {@link ../../../docs/architecture/file-exchange.md#share-rules | File exchange: share rules}
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { checkShareable, shareableFiles } from '@co-reiner/core';

/** What one message may carry as quoted files when the harness sets no limit of its own. */
export const DEFAULT_TEXT_LIMIT = 24_000;
/** A file larger than this is never quoted: it would not fit a message, and is rarely source. */
const FILE_LIMIT = 200_000;
/** The most paths a project's file list names; past it, the model finds the rest with `glob`. */
const LIST_LIMIT = 400;

export interface Refusal {
  path: string;
  reason: string;
}

interface TextFile {
  path: string;
  text: string;
}

/** Read files the share rules allow. Binary files and very large ones are refused with the reason. */
async function readShared(root: string, paths: string[]): Promise<{ files: TextFile[]; refused: Refusal[] }> {
  const { allowed, refused } = await checkShareable(root, [...new Set(paths)]);
  const files: TextFile[] = [];
  for (const rel of allowed) {
    const full = path.join(root, ...rel.split('/'));
    const info = await stat(full).catch(() => undefined);
    if (!info?.isFile()) refused.push({ path: rel, reason: 'not a file' });
    else if (info.size > FILE_LIMIT) refused.push({ path: rel, reason: 'too large to send as text' });
    else {
      const text = await readFile(full, 'utf8');
      if (text.includes('\0')) refused.push({ path: rel, reason: 'not a text file' });
      else files.push({ path: rel, text });
    }
  }
  return { files, refused };
}

/** One file quoted: its path, then its text in a fence longer than any run of backticks inside. */
function quote(f: TextFile): string {
  const longest = Math.max(2, ...[...f.text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const body = f.text.endsWith('\n') ? f.text : `${f.text}\n`;
  return `File ${f.path}:\n${fence}\n${body}${fence}`;
}

export interface QuotedFiles {
  /** The quoted files, for the message (empty when none was sent). */
  text: string;
  /** The files quoted. */
  sent: string[];
  /** Files that fit no longer within the limit: the model may ask for them in a later call. */
  left: string[];
  refused: Refusal[];
}

/** Quote the files the share rules allow, in order, as many as fit `limit` characters. */
export async function quoteFiles(root: string, paths: string[], limit: number): Promise<QuotedFiles> {
  const { files, refused } = await readShared(root, paths);
  const parts: string[] = [];
  const sent: string[] = [];
  const left: string[] = [];
  let used = 0;
  for (const f of files) {
    const q = quote(f);
    if (used + q.length > limit) left.push(f.path);
    else {
      parts.push(q);
      sent.push(f.path);
      used += q.length + 2;
    }
  }
  return { text: parts.join('\n\n'), sent, left, refused };
}

/** What the quoted files come to, as lines of a tool answer or a prompt. */
export function quotedLines(q: QuotedFiles): string[] {
  return [
    q.sent.length ? `Quoted below: ${q.sent.join(', ')}.` : 'No file quoted.',
    ...(q.left.length
      ? [`Not sent, too long for this message: ${q.left.join(', ')}. Ask for them with share_files again.`]
      : []),
    ...(q.refused.length ? [`Refused: ${q.refused.map((r) => `${r.path} (${r.reason})`).join('; ')}.`] : []),
  ];
}

export interface ProjectList {
  /** The list of project files, and how to get their content. */
  intro: string;
  /** How many files the project has (the list names at most `LIST_LIMIT`). */
  count: number;
}

/**
 * The whole project for a message: its file list only, never its content, however small the project. The
 * model asks for the files it needs with `share_files`, so a message never spends its room on files the task
 * does not need. The list follows the share rules alone: the search settings (`include`, `exclude`) are for
 * `glob` and `grep`, so they neither hide a shareable file here nor list one `share_files` would refuse.
 */
export async function projectList(root: string): Promise<ProjectList> {
  const paths = await shareableFiles(root);
  const listed = paths.slice(0, LIST_LIMIT);
  const more = paths.length - listed.length;
  const list = `The files of my project (${paths.length}): ${listed.join(', ')}${more ? `, and ${more} more (find them with glob)` : ''}.`;
  return { intro: `${list} Ask for the files you need with share_files.`, count: paths.length };
}
