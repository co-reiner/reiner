/**
 * @file Tests `/apply` after a restart: with no reply yet in this run, changes come from the open chat's
 * newest reply.
 * @see {@link ../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exchangeOf, nl, setup } from './support.ts';

const DELETE_REPLY = ['Done.', '', '```', '#To delete (only to a bin):', 'src/old.ts', '```'].join(nl);

describe('recollect', () => {
  it("reads the open chat's newest reply when none arrived in this run", async () => {
    const { session } = await setup(1);
    const found = await exchangeOf(session).recollect(undefined, async () => DELETE_REPLY);
    expect(found.sets).toEqual([
      { kind: 'files', source: 'reply (to delete)', writes: [], deletes: ['src/old.ts'] },
    ]);
  });

  it('prefers the reply that arrived in this run', async () => {
    const { session } = await setup(1);
    const transfer = exchangeOf(session);
    await transfer.collect({ markdown: 'No changes this time.', stopped: false, elapsedMs: 1 });
    const found = await transfer.recollect(undefined, async () => DELETE_REPLY);
    expect(found.sets).toEqual([]);
  });

  it('says so when the open chat has no reply either', async () => {
    const { session } = await setup(1);
    const found = await exchangeOf(session).recollect(undefined, async () => undefined);
    expect(found.notes).toEqual(['No reply to apply from yet: the open chat has no reply.']);
  });
});

describe('files a reply offers', () => {
  const PATCH = ['--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-A', '+B', ''].join(nl);

  it('are taken in diff mode too, from the page when the reply came from the history', async () => {
    const asked: (string[] | undefined)[] = [];
    let patchFile = '';
    const { root, session } = await setup(1, async (_dir, opts) => {
      asked.push(opts.names);
      patchFile = path.join(root, 'app.patch.001.patch');
      await writeFile(patchFile, PATCH);
      return [patchFile];
    });
    const found = await exchangeOf(session).recollect(
      undefined,
      async () => 'Saved app.patch.001.zip 3.docx.',
    );
    expect(asked).toEqual([undefined]);
    expect(found.sets.map((s) => s.kind)).toEqual(['diff']);
  });

  it('cost nothing for a live reply that offered none', async () => {
    let calls = 0;
    const { session } = await setup(1, async () => {
      calls++;
      return [];
    });
    await exchangeOf(session).collect({
      markdown: 'Just text.',
      stopped: false,
      elapsedMs: 1,
      downloads: [],
    });
    expect(calls).toBe(0);
  });
});
