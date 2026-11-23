/**
 * @file Tests that the model hears what became of its changes: applied, declined with or without the user's
 * reason, so a model that sends one file at a time goes on with the next.
 * @see {@link ../../../docs/architecture/file-exchange.md#telling-the-model-what-was-applied | File exchange: telling the model what was applied}
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChangeSet } from '@co-reiner/core';
import { afterEach, describe, expect, it } from 'vitest';
import { outcomeMessage } from '../src/tui/commands/outcome.ts';
import { offerChanges } from '../src/tui/commands/shared.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const write = (p: string, text: string): ChangeSet => ({
  kind: 'files',
  source: `${p} from the reply`,
  writes: [{ path: p, data: new TextEncoder().encode(text) }],
  deletes: [],
});

/** A project with no tasks, and a stand-in for the TUI that answers y/N in turn and gives `reason` when asked. */
function setup(answers: boolean[], reason?: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reiner-outcome-'));
  dirs.push(root);
  const asked: string[] = [];
  const api = {
    session: { root, transcript: { append: async () => {} }, tasks: async () => ({}) },
    checks: { suspect: new Set<string>() },
    print: () => {},
    busy: () => {},
    confirm: async () => answers.shift() ?? false,
    ...(reason === undefined
      ? {}
      : {
          ask: async (q: string) => {
            asked.push(q);
            return reason;
          },
        }),
  } as unknown as Parameters<typeof offerChanges>[0];
  return { root, api, asked };
}

describe('telling the model what was applied', () => {
  it('says what was applied and what was not, with the reason, and asks for the rest', async () => {
    const t = setup([true, false], 'keep the old name');
    const told = await offerChanges(t.api, [write('a.txt', 'alpha\n'), write('b.txt', 'beta\n')], []);
    expect(readFileSync(path.join(t.root, 'a.txt'), 'utf8')).toBe('alpha\n');
    expect(t.asked).toHaveLength(1);
    expect(told).toBe(
      [
        'I applied your changes to a.txt.',
        'I did not apply your changes to b.txt. My reason: keep the old name',
        'Continue with any remaining changes; if there are none, say that you are done.',
      ].join('\n'),
    );
  });

  it('sends a "no" without a reason when none is typed, or where nobody can be asked', async () => {
    const blank = setup([false], '');
    expect(await offerChanges(blank.api, [write('a.txt', 'x')], [])).toContain(
      'I did not apply your changes to a.txt.\n',
    );
    const oneShot = setup([false]);
    expect(await offerChanges(oneShot.api, [write('a.txt', 'x')], [])).not.toContain('My reason');
  });

  it('tells nothing when no change was offered', () => {
    expect(outcomeMessage([])).toBeUndefined();
  });
});
