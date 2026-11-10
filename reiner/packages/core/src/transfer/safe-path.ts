/**
 * @file Where a model's change may land: `safeTarget` turns a path from a diff or an archive into a file
 * inside the project, or throws. It fails closed: anything it cannot prove safe is refused.
 * @see {@link ../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

const PROTECTED = new Set(['.git', '.reiner']);

/**
 * Two relative paths name the same file. Case is ignored where the file system usually ignores it, and so
 * is the Unicode form of a name: macOS stores "é" as two code points (decomposed) while git and most
 * tools write one (composed), so a real path and the path asked for can differ byte for byte and still be
 * the same file. Without this such a file was refused as "reached through a link".
 */
export function samePath(a: string, b: string): boolean {
  const fold = process.platform === 'win32' || process.platform === 'darwin';
  const form = (s: string) => (fold ? s.normalize('NFC').toLowerCase() : s.normalize('NFC'));
  return form(a) === form(b);
}

/** The path's segments, refusing anything that is not a plain relative path to a file. */
function segmentsOf(rel: string): string[] {
  const clean = rel.replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[a-z]:/i.test(clean)) throw new Error(`Unsafe path: ${rel}`);
  const segments = clean.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0) throw new Error(`Not a file path: ${rel}`);
  for (const s of segments) {
    // `..` could climb into a protected folder; trailing dots and spaces, `:` (Windows streams) and short
    // names such as GIT~1 are other spellings Windows accepts for a different name.
    if (s === '..') throw new Error(`Path climbs out with "..": ${rel}`);
    if (/[.\s]$/.test(s) || s.includes(':') || /~\d/.test(s)) throw new Error(`Unsafe path: ${rel}`);
  }
  // At any depth: a nested repository's `.git/` (a submodule, a vendored clone) is as off limits as the top one.
  const kept = segments.find((s) => PROTECTED.has(s.toLowerCase()));
  if (kept) throw new Error(`Refusing to change ${kept}/: ${rel}`);
  return segments;
}

/**
 * Resolve an archive or diff path inside `root`, or throw. Refused: absolute paths, `..`, the project root
 * itself, `.git/` and `.reiner/` in any spelling and at any depth, an existing link at the target, and any folder on the way
 * that is a link or junction (checked through the real path of the deepest folder that exists). A link
 * swapped in between this check and the write is not covered.
 */
export function safeTarget(root: string, rel: string): string {
  const segments = segmentsOf(rel);
  const base = path.resolve(root);
  const target = path.join(base, ...segments);
  const realBase = realpathSync.native(base);
  const link = lstatSync(target, { throwIfNoEntry: false });
  if (link?.isSymbolicLink()) throw new Error(`Refusing to change a link: ${rel}`);
  // The deepest part of the path that exists must be exactly where the plain path says it is.
  let existing = target;
  let depth = segments.length;
  while (depth > 0 && !lstatSync(existing, { throwIfNoEntry: false })) {
    existing = path.dirname(existing);
    depth--;
  }
  const expected = path.join(...(depth > 0 ? segments.slice(0, depth) : ['.']));
  const actual = path.relative(realBase, realpathSync.native(existing)) || '.';
  if (!samePath(actual, expected)) throw new Error(`Path goes through a link: ${rel}`);
  return target;
}
