/**
 * @file Live check that a chat with the project gets what changed before a prompt (a part pack), against a
 * real, signed-in Microsoft 365 Copilot. Not part of `pnpm test`.
 *
 * In "Large Chat Test (Keep)": makes sure the chat has a fresh full pack, then creates `src/meet-live.ts`
 * with a unique function name (the user's `meet.ts` case), changes it, and deletes it, asking Copilot each
 * time. Checks each prompt carries the part pack `<project>.part.zip.docx` with what changed since the full
 * pack (and `.reiner/deleted.txt` for the deletion), that Copilot reads the newest content and knows the file
 * is gone, and that the uploads keep one copy of the part pack (the old one moved to the OneDrive recycle
 * bin). Then asks again without changes and checks nothing is uploaded.
 *
 * From reiner/:
 *   PowerShell: $env:REINER_CWD = '../test-projects/test01'; pnpm live:refresh
 *   bash:       REINER_CWD=../test-projects/test01 pnpm live:refresh
 *
 * @see {@link ../../exchange-packs/docs/packs.md#keeping-the-project-current | File exchange: keeping the project current}
 * @see {@link ../../harness-ms/docs/module.md#live-checks | The `m365-copilot` module: live checks}
 */
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PackPrepared } from '@co-reiner/exchange-packs';
import type { ChatHarness } from '@co-reiner/harness-ms';
import { m365CopilotHarness } from '@co-reiner/harness-ms';
import { openSession } from '../src/session.ts';

const LARGE_CHAT_TITLE = 'Large Chat Test (Keep)';
const root = path.resolve(process.env.REINER_CWD || process.cwd());
const session = await openSession(root, { registry: [m365CopilotHarness] });
// These checks drive Copilot's chat methods directly, which every chat harness has.
const module = session.module as ChatHarness | null;
if (!module) throw new Error('No harness in this project.');
const copilot: ChatHarness = module;
if (process.env.SHOW !== '1') session.config.browser.headless = true;
// The harness's own pack exchange, as its commands use it.
const transfer = module.exchange;

const t0 = Date.now();
const log = (msg: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${msg}`);
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const NAME = `meetLive${Date.now().toString(36)}`;
const file = path.join(root, 'src', 'meet-live.ts');

/** Send a prepared prompt the way the TUI does, and record what the chat now has. */
async function send(chatId: string, prepared: PackPrepared, original: string): Promise<string> {
  for (const note of prepared.notes ?? []) log(`note: ${note}`);
  const reply = await copilot.send(prepared.prompt, { attachments: prepared.attachments, onStatus: log });
  await transfer.afterSend(chatId, prepared, original);
  log(`reply: ${JSON.stringify(reply.markdown.slice(0, 200))}`);
  return reply.markdown;
}

try {
  const started = await module.start({ onStatus: log });
  if (!started.signIn.signedIn) throw new Error(started.signIn.reason);
  const chat = (await module.listChats()).find((c) => c.title === LARGE_CHAT_TITLE);
  if (!chat) throw new Error(`"${LARGE_CHAT_TITLE}" is not in the recent list.`);
  await module.openChat(chat.id);
  const chatId = chat.id;

  // Start from a full pack (as /pack does) that already holds src/meet-live.ts, so changing and deleting it
  // show up in part packs.
  await writeFile(file, `export function ${NAME}(): string {\n  return 'see you';\n}\n`);
  await transfer.pack();
  const warm = 'Test of Reiner, step 0: here is the project. Reply with just: ok';
  await send(chatId, await transfer.prepare(warm, chatId), warm);

  const project = path.basename(root);
  const part = `${project}.part.zip.docx`;
  const packCopies = async () =>
    (await copilot.uploads?.list({ onStatus: log }))?.filter((n) => n.startsWith(`${project}.`)) ?? [];
  const copiesBefore = await packCopies();
  log(`pack copies in the uploads before: ${copiesBefore.join(', ') || 'none'}`);

  /** Send a prompt and check a part pack goes with it, holding `has` and deleting `gone`. */
  async function round(ask: string, what: string, has: string[], gone: string[]): Promise<string> {
    const prepared = await transfer.prepare(ask, chatId);
    check(
      path.basename(prepared.pack?.file ?? '') === part,
      `${what}: a part pack ${part} goes with the prompt`,
    );
    check(
      JSON.stringify(prepared.pack?.files) === JSON.stringify(has),
      `${what}: it holds ${has.join(', ') || 'no files'}`,
    );
    check(
      JSON.stringify(prepared.pack?.deleted) === JSON.stringify(gone),
      `${what}: it deletes ${gone.join(', ') || 'nothing'}`,
    );
    return send(chatId, prepared, ask);
  }

  const askName = 'Test of Reiner: what function does src/meet-live.ts export? Reply with only its name.';
  await writeFile(file, `export function ${NAME}Again(): string {\n  return 'see you';\n}\n`);
  check(
    (await round(askName, 'changed file', ['src/meet-live.ts'], [])).includes(`${NAME}Again`),
    `Copilot read the changed file from the part pack (${NAME}Again)`,
  );
  await rm(file);
  const askGone =
    'Test of Reiner: after applying the packs, does src/meet-live.ts exist? Reply with only yes or no.';
  const gone = await round(askGone, 'deleted file', [], ['src/meet-live.ts']);
  check(/^[^a-z]*no[^a-z]*$/i.test(gone.trim()), 'Copilot knows the file was deleted');

  const copiesAfter = await packCopies();
  log(`pack copies in the uploads after: ${copiesAfter.join(', ')}`);
  check(copiesAfter.filter((n) => n === part).length === 1, `exactly one ${part} in the uploads`);
  check(
    copiesAfter.every((n) => copiesBefore.includes(n) || n === part),
    'no new renamed duplicate appeared',
  );

  const again = 'Test of Reiner: reply with just: ok';
  const quiet = await transfer.prepare(again, chatId);
  check(quiet.attachments.length === 0, 'nothing is uploaded when nothing changed');
  await send(chatId, quiet, again);
} finally {
  await rm(file, { force: true });
  await module.stop({ wait: true });
}
log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
