/**
 * @file Reading project files for sharing, through the share rules, and the two shapes they travel in:
 * quoted in the prompt, or gathered into one text file to upload.
 * @see {@link ../../docs/file-exchange.md#how-files-travel | Google Search file exchange: how files travel}
 * @see {@link ../../../../docs/architecture/file-exchange.md#share-rules | File exchange: share rules}
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkShareable, type FileFilter, globFiles } from '@co-reiner/core';

/** A file larger than this is not shared: it would not fit a prompt, and is rarely source. */
export const FILE_LIMIT = 200_000;
/** What one prompt may carry as quoted text. More than this goes by upload, or not at all. */
export const TEXT_LIMIT = 24_000;
/** What one uploaded file may hold. */
export const UPLOAD_LIMIT = 1_000_000;

export interface SharedFile {
  path: string;
  text: string;
}

export interface Refusal {
  path: string;
  reason: string;
}

/** Read files the share rules allow. Binary files and very large ones are refused with the reason. */
export async function readShared(
  root: string,
  paths: string[],
): Promise<{ files: SharedFile[]; refused: Refusal[] }> {
  const { allowed, refused } = await checkShareable(root, [...new Set(paths)]);
  const files: SharedFile[] = [];
  for (const rel of allowed) {
    const full = path.join(root, ...rel.split('/'));
    const info = await stat(full).catch(() => undefined);
    if (!info?.isFile()) refused.push({ path: rel, reason: 'not a file' });
    else if (info.size > FILE_LIMIT) refused.push({ path: rel, reason: 'too large to share as text' });
    else {
      const text = await readFile(full, 'utf8');
      if (text.includes('\0')) refused.push({ path: rel, reason: 'not a text file' });
      else files.push({ path: rel, text });
    }
  }
  return { files, refused };
}

/** What the user typed after /share as project paths: a glob is expanded, a plain path is kept. */
export async function expandPaths(root: string, args: string[], filter: FileFilter): Promise<string[]> {
  const found: string[] = [];
  for (const arg of args) {
    const rel = arg.replace(/\\/g, '/').replace(/^\.\//, '');
    if (/[*?[]/.test(rel)) found.push(...(await globFiles(root, rel, filter)).files);
    else found.push(rel);
  }
  return [...new Set(found)];
}

export const sizeOf = (files: SharedFile[]): number => files.reduce((n, f) => n + f.text.length, 0);

/** Files quoted for a prompt: each under its path, in a fence longer than any run of backticks inside. */
export function quoteFiles(files: SharedFile[]): string {
  return files
    .map((f) => {
      const longest = Math.max(2, ...[...f.text.matchAll(/`+/g)].map((m) => m[0].length));
      const fence = '`'.repeat(longest + 1);
      const body = f.text.endsWith('\n') ? f.text : `${f.text}\n`;
      return `File ${f.path}:\n${fence}\n${body}${fence}`;
    })
    .join('\n\n');
}

/** The line that opens each file inside an uploaded text file. */
export const sectionLine = (rel: string) => `===== ${rel} =====`;

/** Gather files into one text file to upload, and return its path. An earlier one of that name is replaced. */
export async function bundleFiles(dir: string, name: string, files: SharedFile[]): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  const body = files.map((f) => `${sectionLine(f.path)}\n${f.text.endsWith('\n') ? f.text : `${f.text}\n`}`);
  await writeFile(file, body.join('\n'));
  return file;
}

export const refusedLine = (refused: Refusal[]): string[] =>
  refused.length ? [`Not shared: ${refused.map((r) => `${r.path} (${r.reason})`).join('; ')}.`] : [];
