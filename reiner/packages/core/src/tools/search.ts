/**
 * @file Search tools for the model. Both work only on `shareableFiles(root)`, never on the disk directly, so a
 * file outside the project or ignored by git is never named or read, and a pattern that only matches such
 * files gives the same empty answer as one that matches nothing.
 *
 * The user can adjust that list per harness in `.reiner/config.jsonc` (`harnesses.<id>.include` and
 * `exclude`, see `searchFilter`). Packs and `share_files` do not read these settings.
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 * @see {@link ../../../../docs/architecture/project-config.md#search-include-and-exclude | Project configuration: search include and exclude}
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { type FileFilter, shareableFiles } from '../transfer/share.ts';
import { globToRegExp } from './glob.ts';
import { decodeText } from './text.ts';

export { globToRegExp };

/** `include` and `exclude` in a harness's settings: glob patterns, as the tools take them. */
const SearchSettings = z.object({
  include: z.array(z.string().min(1)).default([]),
  exclude: z.array(z.string().min(1)).default([]),
});

/** The search filter from a harness's settings. Throws a message for the user when they are not lists of patterns. */
export function searchFilter(settings: Record<string, unknown> | undefined): FileFilter {
  const parsed = SearchSettings.safeParse({ include: settings?.include, exclude: settings?.exclude });
  if (!parsed.success) {
    throw new Error(
      `"include" and "exclude" in .reiner/config.jsonc must be lists of glob patterns, e.g. ["generated/**"]: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}

export const GLOB_LIMIT = 200;
export const GREP_LIMIT = 100;
/** Files larger than this are not searched by grep. */
const GREP_MAX_FILE = 1024 * 1024;
const LINE_SHOWN = 200;
/** Longer lines are not tested at all: keeps a bad regular expression from running away on minified code. */
const LINE_TESTED = 2000;
const GREP_BUDGET_MS = 5000;

export interface GlobResult {
  files: string[];
  total: number;
}

export async function globFiles(root: string, pattern: string, filter: FileFilter = {}): Promise<GlobResult> {
  const re = globToRegExp(pattern);
  const matched = (await shareableFiles(root, filter)).filter((f) => re.test(f));
  return { files: matched.slice(0, GLOB_LIMIT), total: matched.length };
}

export interface GrepOptions {
  /** Only files matching this glob. */
  glob?: string;
  ignoreCase?: boolean;
  /** The user's include and exclude patterns. */
  filter?: FileFilter;
}

export interface GrepResult {
  matches: { file: string; line: number; text: string }[];
  total: number;
  files: number;
  /** Why the search stopped early, if it did. */
  stopped?: string;
}

/** Lines matching a regular expression, in the files `glob` would list. Throws on a bad expression. */
export async function grepFiles(root: string, pattern: string, opts: GrepOptions = {}): Promise<GrepResult> {
  const re = new RegExp(pattern, opts.ignoreCase ? 'i' : '');
  const only = opts.glob ? globToRegExp(opts.glob) : undefined;
  const base = path.resolve(root);
  const started = Date.now();
  const matches: GrepResult['matches'] = [];
  const hitFiles = new Set<string>();
  let total = 0;
  let stopped: string | undefined;
  for (const file of await shareableFiles(root, opts.filter)) {
    // Before the glob test too: the budget covers the time spent matching paths.
    if (Date.now() - started > GREP_BUDGET_MS) {
      stopped = `stopped after ${GREP_BUDGET_MS / 1000} s; narrow the pattern or add a glob`;
      break;
    }
    if (only && !only.test(file)) continue;
    const full = path.join(base, ...file.split('/'));
    const info = await stat(full).catch(() => undefined);
    if (!info || info.size > GREP_MAX_FILE) continue;
    const decoded = decodeText(new Uint8Array(await readFile(full)));
    if (!decoded) continue;
    const lines = decoded.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      if (line.length > LINE_TESTED || !re.test(line)) continue;
      total++;
      hitFiles.add(file);
      if (matches.length < GREP_LIMIT) {
        const trimmed = line.trim();
        matches.push({
          file,
          line: i + 1,
          text: trimmed.length > LINE_SHOWN ? `${trimmed.slice(0, LINE_SHOWN)}…` : trimmed,
        });
      }
    }
  }
  return { matches, total, files: hitFiles.size, ...(stopped ? { stopped } : {}) };
}
