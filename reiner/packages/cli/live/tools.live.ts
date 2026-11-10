/**
 * @file Live check of the tool round trip against a real, signed-in Microsoft 365 Copilot. Not part of `pnpm test`.
 *
 * In "Large Chat Test (Keep)": sends a pack (so the chat has seen the files), asks Copilot to act as if its
 * sandbox was reset and request src/greet.ts with the `share_files` tool, answers the call the way the TUI
 * does, and checks Copilot then reads the file.
 *
 * Then the search tools: puts decoy files that git ignores (`.env`, `debug.log`) in the project, asks Copilot
 * to call `glob`, then `grep`, then to name the functions it found, and checks the decoys never reach the
 * chat. The decoys are removed afterwards. `ONLY=share` or `ONLY=search` runs one part.
 *
 * From reiner/:
 *   PowerShell: $env:REINER_CWD = '../test-projects/test01'; pnpm live:tools
 *   bash:       REINER_CWD=../test-projects/test01 pnpm live:tools
 *
 * @see {@link ../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 * @see {@link ../../harness-ms/docs/module.md#live-checks | The `m365-copilot` module: live checks}
 */
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractToolCalls } from '@co-reiner/core';
import type { ChatHarness } from '@co-reiner/harness-ms';
import { m365CopilotHarness } from '@co-reiner/harness-ms';
import { openSession } from '../src/session.ts';

const LARGE_CHAT_TITLE = 'Large Chat Test (Keep)';
const root = path.resolve(process.env.REINER_CWD || process.cwd());
const session = await openSession(root, { registry: [m365CopilotHarness] });
// These checks drive Copilot's chat methods directly, which every chat harness has.
const module = session.module as ChatHarness | null;
if (!module) throw new Error('No harness in this project.');
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

const only = process.env.ONLY;
const DECOY = 'decoyFromIgnoredFile';
const decoys = [path.join(root, '.env'), path.join(root, 'debug.log')];
// The search part writes the decoys and removes them afterwards: never over a file that is already there.
const inTheWay = only === 'share' ? [] : decoys.filter((d) => existsSync(d));
if (inTheWay.length) {
  console.error(
    `Stopped before writing anything: ${inTheWay.join(', ')} already exist${inTheWay.length === 1 ? 's' : ''}. ` +
      'This check writes decoy files with those names and deletes them. Move them away, use a scratch project, or run with ONLY=share.',
  );
  process.exit(1);
}
/** Decoys this run wrote, so only those are removed. */
const written: string[] = [];

try {
  const started = await module.start({ onStatus: log });
  if (!started.signIn.signedIn) throw new Error(started.signIn.reason);
  const chat = (await module.listChats()).find((c) => c.title === LARGE_CHAT_TITLE);
  if (!chat) throw new Error(`"${LARGE_CHAT_TITLE}" is not in the recent list.`);
  await module.openChat(chat.id);

  if (only !== 'search') {
    // The chat must have seen the files before they can be asked for: send a pack first if it has not.
    if (!(await transfer.state()).shared[chat.id]?.includes('src/greet.ts')) {
      const pack = await transfer.pack();
      log(`packed ${pack.files.length} files: ${pack.files.join(', ')}`);
    }
    const ask = [
      'Test of Reiner tools, step 1 of 2: use the share_files tool now to ask for src/greet.ts.',
      'Step 2, when the tool result arrives: reply with only the first line of src/greet.ts from the new pack.',
    ].join(' ');
    const first = await transfer.prepare(ask, chat.id);
    const reply1 = await module.send(first.prompt, { attachments: first.attachments, onStatus: log });
    await transfer.afterSend(chat.id, first, ask);
    log(`reply 1: ${JSON.stringify(reply1.markdown.slice(0, 200))}`);
    const calls = extractToolCalls(reply1.markdown);
    check(calls.calls.length === 1 && calls.errors.length === 0, 'reply 1 is one valid tool call');
    const call = calls.calls[0];
    check(
      call?.tool === 'share_files' && call.paths?.includes('src/greet.ts') === true,
      'it asks for src/greet.ts',
    );

    const result = await transfer.runTools(calls, chat.id);
    for (const line of result.summary) log(`tool: ${line}`);
    // A chat with the whole project gets a new full pack if anything changed, or is told its pack is current.
    check(
      result.prepared.pack?.files.includes('src/greet.ts') === true ||
        result.prepared.prompt.includes('no file changed since'),
      'Reiner sent src/greet.ts, or pointed at the current full pack',
    );
    const reply2 = await module.send(result.prepared.prompt, {
      attachments: result.prepared.attachments,
      onStatus: log,
    });
    await transfer.afterSend(chat.id, result.prepared, '');
    log(`reply 2: ${JSON.stringify(reply2.markdown.slice(0, 200))}`);
    check(
      reply2.markdown.includes("import { add } from './util/math.ts'"),
      'Copilot read the file from the tool result',
    );
  }

  if (only !== 'share') {
    for (const d of decoys) {
      // `wx` fails rather than overwrite a file that appeared since the check above.
      await writeFile(d, `export function ${DECOY}() {}${String.fromCharCode(10)}`, { flag: 'wx' });
      written.push(d);
    }
    const ask = [
      'Test of Reiner search tools, step 1 of 3: call the glob tool now with pattern "**/*.ts".',
      'Step 2, when its result arrives: call the grep tool with pattern "export function".',
      'Step 3, when that result arrives: reply with only the function names grep found, comma-separated.',
    ].join(' ');
    let prepared = await transfer.prepare(ask, chat.id);
    let original = ask;
    const seen: string[] = [];
    const sentResults: string[] = [];
    let final = '';
    for (let round = 1; round <= 3; round++) {
      const reply = await module.send(prepared.prompt, { attachments: prepared.attachments, onStatus: log });
      await transfer.afterSend(chat.id, prepared, original);
      log(`search reply ${round}: ${JSON.stringify(reply.markdown.slice(0, 200))}`);
      const calls = extractToolCalls(reply.markdown);
      if (calls.calls.length + calls.errors.length === 0) {
        final = reply.markdown;
        break;
      }
      seen.push(...calls.calls.map((c) => c.tool), ...calls.errors.map((e) => `error: ${e}`));
      const result = await transfer.runTools(calls, chat.id);
      for (const line of result.summary) log(`tool: ${line}`);
      sentResults.push(result.prepared.prompt);
      prepared = result.prepared;
      original = '';
    }
    check(
      seen.join(',') === 'glob,grep',
      `Copilot called glob, then grep (got: ${seen.join(', ') || 'none'})`,
    );
    const sent = sentResults.join(String.fromCharCode(10));
    check(
      sent.includes('src/greet.ts') && sent.includes('src/util/math.ts'),
      'glob listed the project files',
    );
    check(sent.includes('src/greet.ts:3: export function greet'), 'grep sent path:line: text');
    check(
      !sent.includes(DECOY) && !sent.includes('.env') && !sent.includes('debug.log'),
      'nothing from the git-ignored decoys was sent',
    );
    check(
      ['greet', 'total', 'add'].every((f) => final.includes(f)),
      'Copilot named greet, total and add',
    );
    check(!final.includes(DECOY), 'Copilot never saw the decoy');
  }
} finally {
  for (const d of written) await rm(d, { force: true });
  await module.stop({ wait: true });
}
log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
