/**
 * @file Live check of /instructions against a real, signed-in Microsoft 365 Copilot. Not part of `pnpm test`.
 * Changes the account's custom instructions: it saves Reiner's sections (for the project's current
 * mode and index setting) next to whatever text is there, after writing a backup, then reads them back.
 * With REMOVE=1 it takes the sections out again at the end.
 *
 * From reiner/:
 *   PowerShell: $env:REINER_CWD = '../test-projects/test01'; pnpm live:instructions
 *   bash:       REINER_CWD=../test-projects/test01 pnpm live:instructions
 *
 * @see {@link ../../exchange-packs/docs/packs.md#instructions-and-sections | File exchange: instructions and sections}
 * @see {@link ../../harness-ms/docs/file-exchange.md#custom-instructions | Copilot file exchange: custom instructions}
 * @see {@link ../../harness-ms/docs/module.md#live-checks | The `m365-copilot` module: live checks}
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sectionIds, setSections } from '@co-reiner/exchange-packs';
import type { ChatHarness } from '@co-reiner/harness-ms';
import { m365CopilotHarness } from '@co-reiner/harness-ms';
import { openSession } from '../src/session.ts';

const root = path.resolve(process.env.REINER_CWD || process.cwd());
const session = await openSession(root, { registry: [m365CopilotHarness] });
// These checks drive Copilot's chat methods directly, which every chat harness has.
const module = session.module as ChatHarness | null;
if (!module?.customInstructions) throw new Error('This harness has no custom instructions.');
if (process.env.SHOW !== '1') session.config.browser.headless = true;
// The harness's own pack exchange, as its commands use it.
const transfer = module.exchange;
const custom = module.customInstructions;

const t0 = Date.now();
const log = (msg: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${msg}`);
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

try {
  const started = await module.start({ onStatus: log });
  if (!started.signIn.signedIn) throw new Error(started.signIn.reason);
  const before = await custom.read({ onStatus: log });
  const own = setSections(before, []);
  log(`current: ${before.length} characters, sections: ${sectionIds(before).join(', ') || 'none'}`);
  const dir = path.join(session.paths.modulesDir, module.id, 'instructions-backups');
  await mkdir(dir, { recursive: true });
  const backup = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  await writeFile(backup, before, 'utf8');
  log(`backup: ${backup}`);

  const sections = await transfer.sections();
  const next = setSections(before, sections);
  await custom.write(next, { onStatus: log });
  await transfer.markSynced(true);
  const after = await custom.read({ onStatus: log });
  check(after.trim() === next.trim(), `saved and read back (${after.length} characters)`);
  check(setSections(after, []).trim() === own.trim(), "the user's own text is unchanged");
  check(
    JSON.stringify(sectionIds(after)) === JSON.stringify(sections.map((s) => s.id)),
    `sections saved: ${sectionIds(after).join(', ')}`,
  );
  const prepared = await transfer.prepare('Hello', 'any-chat');
  log(`prompt with a pack-less, unbriefed chat: ${JSON.stringify(prepared.prompt.slice(0, 40))}`);

  if (process.env.REMOVE === '1') {
    await custom.write(own, { onStatus: log });
    await transfer.markSynced(false);
    const removed = await custom.read({ onStatus: log });
    check(
      sectionIds(removed).length === 0 && removed.trim() === own.trim(),
      'sections removed, own text kept',
    );
  }
} finally {
  await module.stop({ wait: true });
}
log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
