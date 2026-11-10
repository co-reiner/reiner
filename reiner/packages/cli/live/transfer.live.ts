/**
 * @file Live check of file exchange against a real, signed-in Microsoft 365 Copilot. Not part of `pnpm test`.
 *
 * Runs in "Large Chat Test (Keep)". For each mode (diff, download, onedrive) it does what the TUI does:
 * switches the mode, packs the project, sends a prompt with the pack and the instruction sections, reads
 * the reply, collects the changes and applies them, then checks the files and resets them with git.
 * It also checks that a OneDrive folder that does not exist is reported, not thrown.
 *
 * Needs a signed-in project folder that is a git repo with the sample files from
 * docs/architecture/file-exchange.md (src/greet.ts, src/util/math.ts, docs/notes.md) committed, and no
 * TUI open there. It resets src/ and docs/ in that folder. From reiner/:
 *   PowerShell: $env:REINER_CWD = '../test-projects/test01'; pnpm live:transfer
 *   bash:       REINER_CWD=../test-projects/test01 pnpm live:transfer
 * Options: MODES=diff,download,onedrive (default all), SHOW=1 to watch the browser.
 *
 * @see {@link ../../../docs/architecture/file-exchange.md | File exchange}
 * @see {@link ../../exchange-packs/docs/packs.md#why-it-works-this-way | File exchange: why it works this way}
 * @see {@link ../../harness-ms/docs/file-exchange.md#reply-modes | Copilot file exchange: reply modes}
 * @see {@link ../../harness-ms/docs/module.md#live-checks | The `m365-copilot` module: live checks}
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { applyChangeSet, changedPaths } from '@co-reiner/core';
import type { ChatHarness } from '@co-reiner/harness-ms';
import { m365CopilotHarness } from '@co-reiner/harness-ms';
import { openSession } from '../src/session.ts';

const LARGE_CHAT_TITLE = 'Large Chat Test (Keep)';
const root = path.resolve(process.env.REINER_CWD || process.cwd());
const modes = (process.env.MODES ?? 'diff,download,onedrive').split(',');

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
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const reset = () => {
  git('checkout', '--', 'src', 'docs');
  git('clean', '-fdq', '--', 'src', 'docs');
};

const ASK =
  'In src/greet.ts, make greet() trim the name and fall back to "friend" when it is empty. Add a new file src/util/strings.ts exporting isBlank(s: string): boolean and use it in greet(). Delete docs/notes.md.';

try {
  reset();
  const started = await module.start({ onStatus: log });
  if (!started.signIn.signedIn) throw new Error(started.signIn.reason);
  const chat = (await module.listChats()).find((c) => c.title === LARGE_CHAT_TITLE);
  if (!chat)
    throw new Error(`"${LARGE_CHAT_TITLE}" is not in the recent list. Run pnpm live:large-chat first.`);
  await module.openChat(chat.id);

  for (const mode of modes) {
    log(`── mode ${mode}`);
    const ready = (await module.prepareTransfer?.(mode, { onStatus: log })) ?? { ready: true, notes: [] };
    for (const n of ready.notes) log(`note: ${n}`);
    check(ready.ready, `${mode}: ready`);
    await transfer.setMode(mode);
    if (ready.existing) await transfer.skipUsedSequences(ready.existing);
    const pack = await transfer.pack();
    log(`packed ${pack.files.length} files, ${pack.indexed} indexed`);
    // Sections go in the prompt once per chat per setting, unless they are saved in the custom instructions.
    const st = await transfer.state();
    const sig = await transfer.signature();
    const expectSections = st.synced !== sig && st.briefed[chat.id] !== sig;
    const prepared = await transfer.prepare(ASK, chat.id);
    check(prepared.attachments.length === 1, `${mode}: pack attached`);
    const hasSections = prepared.prompt.includes('## Reply format for changes');
    check(
      hasSections === expectSections,
      `${mode}: instruction sections ${hasSections ? 'in the prompt' : 'not repeated (already in the chat or custom instructions)'}`,
    );
    const reply = await module.send(prepared.prompt, {
      attachments: prepared.attachments,
      onStatus: (s) => log(s),
      timeoutMs: 8 * 60_000,
    });
    log(
      `reply ${reply.markdown.length} chars in ${(reply.elapsedMs / 1000).toFixed(1)}s; downloads: ${reply.downloads?.join(', ') || 'none'}`,
    );
    await transfer.briefed(chat.id);
    const found = await transfer.collect(reply, log);
    for (const n of found.notes) log(`note: ${n}`);
    check(found.sets.length > 0, `${mode}: changes found (${found.sets.map((s) => s.source).join(', ')})`);
    // Apply the newest set only: a mode may also have a diff in the text.
    const set = found.sets[found.sets.length - 1];
    if (set) {
      log(
        `applying ${set.source}: ${changedPaths(set)
          .map((c) => `${c.action} ${c.path}`)
          .join(', ')}`,
      );
      await applyChangeSet(root, set);
      const greet = readFileSync(path.join(root, 'src/greet.ts'), 'utf8');
      check(greet.includes('friend') && greet.includes('isBlank'), `${mode}: greet.ts changed`);
      check(existsSync(path.join(root, 'src/util/strings.ts')), `${mode}: strings.ts added`);
      check(!existsSync(path.join(root, 'docs/notes.md')), `${mode}: notes.md deleted`);
      await transfer.advance();
    }
    reset();
  }

  if (modes.includes('onedrive')) {
    // A folder that does not exist must come back as missing, not as an error. The path is deliberately
    // one that never exists: the check only opens its address in OneDrive and reads the page, so nothing
    // is created. The real folder is still Documents/Copilot/Created (selectors.ts).
    const missingModule = m365CopilotHarness.create({
      projectRoot: root,
      profileDir: path.join(session.paths.profilesDir, 'm365-copilot'),
      stateDir: path.join(session.paths.modulesDir, 'm365-copilot'),
      logDir: session.paths.logsDir,
      browser: session.config.browser,
      settings: { createdFolder: 'Documents/Copilot/does-not-exist-reiner-live-check' },
    }) as ChatHarness;
    await module.stop({ wait: true });
    // The mode itself fetches: a reply that names a patch makes it look in the folder.
    const onedrive = missingModule.transfer.modes.find((m) => m.id === 'onedrive');
    const project = path.basename(root);
    const got = await onedrive?.collect?.(
      { markdown: `Saved ${project}.patch.999.zip.docx`, stopped: false, elapsedMs: 0 },
      { project, incomingDir: path.join(root, '.reiner/incoming'), onStatus: log },
    );
    check(
      got?.files.length === 0 && got.notes.some((n) => n.includes('does not exist yet')),
      'onedrive: missing folder reported as missing',
    );
    await missingModule.stop({ wait: true });
  }
} finally {
  reset();
  await module.stop({ wait: true });
}
log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
