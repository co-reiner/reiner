/**
 * @file Reading a reply written in plain words: whole files under a "File: path" line, and the list of
 * files the model asks to see under "Files needed:".
 * @see {@link ../../docs/file-exchange.md#what-comes-back | Google Search file exchange: what comes back}
 */

const FENCE = /^(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^\n]*$/;
const FILE_LINE = /^[ \t>*_#`-]*File:?[ \t]*[`*_]*([\w./@+-]+)[`*_]*[ \t:]*$/i;
const NEEDED_LINE = /^[ \t>*_#`-]*Files needed:?[ \t*_`]*$/i;
const PATH_LINE = /^[ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+)?[`*_]*([\w./@+-]+)[`*_]*[ \t]*$/;

/**
 * True for a "reply" that is only a list of web results: what AI mode gives when it takes a prompt for a
 * search (it opens with the number of sites and "Here are top web results").
 */
export const isWebResults = (markdown: string): boolean =>
  /^(\d+ sites?\s+)?#*\s*Here are top web results/i.test(markdown.trim());

const clean = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Whole files in a reply: each a line "File: <path>" directly before a code block (blank lines between
 * are fine). A block labelled diff is left to the diff reader. The last block for a path wins.
 */
export function extractWholeFiles(markdown: string): { path: string; text: string }[] {
  const lines = markdown.split('\n');
  const found = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const named = FILE_LINE.exec(lines[i] ?? '');
    if (!named?.[1]) continue;
    let at = i + 1;
    while (at < lines.length && (lines[at] ?? '').trim() === '') at++;
    const open = FENCE.exec(lines[at] ?? '');
    if (!open?.[1] || /^(diff|patch)$/i.test(open[2] ?? '')) continue;
    const end = lines.findIndex((l, n) => n > at && l.trim() === open[1]);
    if (end < 0) continue;
    found.set(clean(named[1]), `${lines.slice(at + 1, end).join('\n')}\n`);
    i = end;
  }
  return [...found].map(([path, text]) => ({ path, text }));
}

/** The paths under a "Files needed:" line: one per line, as a list or in a code block. */
export function extractNeededFiles(markdown: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => NEEDED_LINE.test(l));
  if (start < 0) return [];
  const paths: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || FENCE.test(line)) {
      // Blank lines and fences around the list are skipped; after the list they end it.
      if (paths.length && line.trim() === '') break;
      continue;
    }
    const path = PATH_LINE.exec(line)?.[1];
    if (!path) break;
    paths.push(clean(path));
  }
  return [...new Set(paths)];
}
