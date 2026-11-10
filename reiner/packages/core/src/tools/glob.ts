/**
 * @file Glob patterns for the `glob` and `grep` tools and the search `include`/`exclude` settings.
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 * @see {@link ../../../../docs/architecture/project-config.md#search-include-and-exclude | Project configuration: search include and exclude}
 */

/** A model's pattern may hold this many `**`: each one multiplies the work of testing one path. */
export const GLOB_MAX_SPANS = 3;

/**
 * The pattern with `/` separators and no leading `./` or `/`. A run of `**` folders is folded into one,
 * because every repeat would make the expression backtrack over the same folders again.
 */
function normalise(pattern: string): string {
  return pattern
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\*{3,}/g, '**')
    .replace(/(?:\*\*\/)+/g, '**/')
    .replace(/\*\*\/\*\*(?!\/)/g, '**');
}

/**
 * A model's pattern may hold this many single `*` in one name: each one multiplies the work of testing a
 * long file name, as `**` does for a path.
 */
export const GLOB_MAX_STARS = 4;

/** The most single `*` in any one name of a pattern (`**` not counted). */
export function globStars(pattern: string): number {
  const counts = normalise(pattern)
    .split('/')
    .map((name) => name.replaceAll('**', '').split('*').length - 1);
  return Math.max(0, ...counts);
}

/** How many `**` a pattern has once folded. Tool calls are refused above `GLOB_MAX_SPANS`. */
export function globSpans(pattern: string): number {
  return normalise(pattern).split('**').length - 1;
}

/**
 * A glob as a regular expression over `/`-separated project paths. `**` spans folders, `*` and `?` stay
 * inside one name, `{a,b}` and `[abc]` work as usual. A pattern without `/` matches the file name in any
 * folder (`*.ts`), the way `.gitignore` reads it, and a trailing `/` means everything below that folder,
 * counted from the project root (`fixtures/` is the top-level folder only).
 */
export function globToRegExp(pattern: string): RegExp {
  const p = normalise(pattern);
  const q = p.endsWith('/') ? `${p}**` : p;
  let out = '';
  let braces = 0;
  for (let i = 0; i < q.length; i++) {
    const c = q[i] as string;
    if (c === '*') {
      if (q[i + 1] === '*') {
        const slash = q[i + 2] === '/';
        out += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '{') {
      braces++;
      out += '(?:';
    } else if (c === '}' && braces > 0) {
      braces--;
      out += ')';
    } else if (c === ',' && braces > 0) out += '|';
    else if (c === '[') {
      const end = q.indexOf(']', i + 1);
      if (end === -1) out += '\\[';
      else {
        const body = q
          .slice(i + 1, end)
          .replace(/^!/, '^')
          .replace(/\\/g, '\\\\');
        out += `[${body}]`;
        i = end;
      }
    } else out += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  out += ')'.repeat(braces);
  return new RegExp(q.includes('/') ? `^${out}$` : `(?:^|/)${out}$`, 'i');
}
