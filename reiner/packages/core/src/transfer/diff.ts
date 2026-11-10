/**
 * @file Reading a unified diff before it is applied: the files it touches, the files it deletes, and the
 * check that the names Reiner shows and tests are the names `git apply` will act on.
 * @see {@link ../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */

/** A header's file name: the timestamp plain `diff -u` adds after a tab is not part of it. */
const headerName = (raw: string): string => raw.replace(/\t.*$/, '').trim();

/** The file a `diff --git a/P b/P` line names, when both sides are the same path (the only form applied). */
function gitLineName(rest: string): string | undefined {
  const line = rest.trimEnd();
  const length = (line.length - 5) / 2;
  if (!Number.isInteger(length) || length < 1) return undefined;
  const name = line.slice(2, 2 + length);
  return line === `a/${name} b/${name}` ? name : undefined;
}

/** Files a unified diff touches (new paths; old paths for deletions). */
export function diffFiles(diff: string): string[] {
  const files = new Set<string>();
  let minus = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const rest = line.slice('diff --git '.length);
      const name = gitLineName(rest) ?? /^a\/(.+?) b\/(.+)$/.exec(rest.trimEnd())?.[2];
      if (name) files.add(name);
      continue;
    }
    if (line.startsWith('--- ')) minus = headerName(line.slice(4)).replace(/^a\//, '');
    else if (line.startsWith('+++ ')) {
      const plus = headerName(line.slice(4));
      files.add(plus === '/dev/null' ? minus : plus.replace(/^b\//, ''));
    }
  }
  return [...files].filter((f) => f && f !== '/dev/null');
}

/** A diff cut into one section per file (text before the first section stays with the first one). */
function diffSections(diff: string): string[] {
  const lines = diff.split(/(?<=\n)/);
  const sections: string[] = [];
  let current = '';
  let gitHeaderOpen = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    const startsGit = line.startsWith('diff --git ');
    // A plain file header starts a section, unless it belongs to the `diff --git` header just above it.
    const startsPlain = line.startsWith('--- ') && next.startsWith('+++ ') && !gitHeaderOpen;
    if ((startsGit || startsPlain) && current.trim()) {
      sections.push(current);
      current = '';
    }
    if (startsGit) gitHeaderOpen = true;
    else if (line.startsWith('@@') || startsPlain) gitHeaderOpen = false;
    else if (line.startsWith('+++ ')) gitHeaderOpen = false;
    current += line;
  }
  if (current) sections.push(current);
  return sections;
}

/** Whether a section removes its file: git's own marker, or a new side of `/dev/null`. */
const isDeletion = (part: string): boolean =>
  /^deleted file mode /m.test(part) || /^\+\+\+ \/dev\/null\s*$/m.test(part);

/**
 * Split a unified diff into the files it deletes and the rest. Deleted files are moved to the recycle bin by
 * Reiner instead of being removed by `git apply`. Handles `git diff` sections (`diff --git`) and plain
 * unified diffs (a `---` line followed by `+++`); a deletion is a section whose new side is `/dev/null`, or
 * one git marks `deleted file mode` (a binary or empty file has no `---` line, so its name comes from the
 * `diff --git` line).
 */
export function splitDeletions(diff: string): { rest: string; deleted: string[] } {
  const deleted: string[] = [];
  const kept: string[] = [];
  for (const part of diffSections(diff)) {
    const minus = /^--- (.+)$/m.exec(part)?.[1];
    const fromGit = /^diff --git (.+)$/m.exec(part)?.[1];
    const name = minus ? headerName(minus).replace(/^a\//, '') : fromGit ? gitLineName(fromGit) : undefined;
    if (isDeletion(part) && name && name !== '/dev/null') deleted.push(name);
    else kept.push(part);
  }
  return { rest: kept.join(''), deleted };
}

/**
 * Refuse a diff whose shown names are not the names `git apply` would act on. git reads a file's name from
 * several places (the `diff --git` line, `---`/`+++`, `rename`/`copy` headers), unquotes quoted names, and
 * drops the first folder of a plain header. So every name in a section must agree, renames and copies are
 * not applied (their source is never checked), quoted names are refused, and a plain header must carry the
 * `a/` and `b/` prefixes, except in a deletion, which Reiner does itself. Throws with the reason.
 */
export function checkDiff(diff: string): void {
  for (const part of diffSections(diff)) {
    const head = part.split(/^@@/m)[0] ?? '';
    if (/^(rename|copy) (from|to) /m.test(head)) {
      throw new Error(
        'This diff renames or copies a file, which is not applied. Ask for the old file deleted and the new one in full.',
      );
    }
    const gitLine = /^diff --git (.+)$/m.exec(head)?.[1];
    const minus = /^--- (.+)$/m.exec(head)?.[1];
    const plus = /^\+\+\+ (.+)$/m.exec(head)?.[1];
    if ([gitLine, minus, plus].some((s) => s?.includes('"'))) {
      throw new Error('This diff has a quoted file name, which is not applied. Ask for the file in full.');
    }
    const expected = gitLine === undefined ? undefined : gitLineName(gitLine);
    if (gitLine !== undefined && expected === undefined) {
      throw new Error(`The diff names two different files in one section: diff --git ${gitLine.trim()}`);
    }
    const deletion = isDeletion(part);
    const sides: string[] = [];
    for (const [raw, prefix] of [
      [minus, 'a/'],
      [plus, 'b/'],
    ] as const) {
      const name = raw === undefined ? '/dev/null' : headerName(raw);
      if (name === '/dev/null') continue;
      // A plain deletion needs no prefix: Reiner moves that file to the recycle bin itself.
      if (name.startsWith(prefix)) sides.push(name.slice(prefix.length));
      else if (deletion && expected === undefined) sides.push(name);
      else throw new Error(`The diff's file name must start with ${prefix}: ${name}`);
    }
    const first = expected ?? sides[0];
    if (sides.some((s) => s !== first)) {
      throw new Error(`The diff names different files in one section: ${[first, ...sides].join(', ')}`);
    }
  }
}

/** The first line of the block in which a model lists the files to delete, as its instructions put it. */
export const DELETE_HEADER = '#To delete (only to a bin):';

const DELETE_LINE = /^#+\s*to delete\b/i;
const FENCE_LINE = /^(`{3,}|~{3,})/;

/**
 * Files a reply asks to delete: the lines after a `#To delete (only to a bin):` header, one relative path
 * each, up to the end of its code block or the next blank line. The header is found in a code block or,
 * when the harness's page shows it as a heading, in the text. Nothing is deleted here: the paths become a
 * change set, which is shown, asked about, and only ever moved to the recycle bin.
 */
export function extractDeletions(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/).map((l) => l.trim());
  const paths: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!DELETE_LINE.test(lines[i] ?? '')) continue;
    let j = i + 1;
    // A heading may be followed by a blank line before its list.
    while (j < lines.length && lines[j] === '') j++;
    for (; j < lines.length; j++) {
      const line = lines[j] ?? '';
      if (!line || FENCE_LINE.test(line) || line.startsWith('#')) break;
      const file = line
        .replace(/^[-*]\s+/, '')
        .replace(/^`+|`+$/g, '')
        .trim();
      if (file) paths.push(file.replace(/\\/g, '/'));
    }
    i = j;
  }
  return [...new Set(paths)];
}
