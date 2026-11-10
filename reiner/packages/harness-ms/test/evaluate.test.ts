/**
 * @file Guards code that runs in the page: no named inner functions in `evaluate` callbacks, which tsx wraps
 * in a `__name()` helper the page does not have.
 * @see {@link ../../../AGENTS.md#browser-gotchas | AGENTS.md: browser gotchas}
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGES = path.resolve(import.meta.dirname, '..', '..');

/** Every .ts file under each package's src/. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  for (const pkg of readdirSync(PACKAGES)) {
    const src = path.join(PACKAGES, pkg, 'src');
    try {
      walk(src);
    } catch {
      // A package without src/.
    }
  }
  return out;
}

/** The argument list of each `.evaluate(` / `.evaluateAll(` call, found by matching brackets. */
function evaluateCalls(text: string): string[] {
  const calls: string[] = [];
  for (const m of text.matchAll(/\.evaluate(?:All)?\(/g)) {
    let depth = 0;
    const start = (m.index ?? 0) + m[0].length - 1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) {
        calls.push(text.slice(start, i + 1));
        break;
      }
    }
  }
  return calls;
}

const NAMED = /\b(?:const|let)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|\bfunction\s+\w+\s*\(/;

describe('page.evaluate callbacks', () => {
  it('define no named inner functions', () => {
    const offenders = sources().flatMap((file) =>
      evaluateCalls(readFileSync(file, 'utf8'))
        .filter((call) => NAMED.test(call))
        .map((call) => `${path.relative(PACKAGES, file)}: ${call.match(NAMED)?.[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});
