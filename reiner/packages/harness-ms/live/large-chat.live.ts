/**
 * @file Live check against a real, signed-in Microsoft 365 Copilot. Not part of `pnpm test`.
 *
 * Uses one long-lived chat, "Large Chat Test (Keep)", so it grows over time and exercises Copilot's
 * weak spot: loading and scrolling large conversations. Each run:
 *   1. finds the chat (creates and renames it on the first run),
 *   2. opens it and adds `TURNS` prompts,
 *   3. switches to a fresh "New chat" (sends nothing there, so Copilot saves no extra chat),
 *   4. switches back, checks the last prompt is shown, and sends one more prompt.
 *
 * Needs a signed-in project folder (its .reiner/ profile) with no TUI open there. From reiner/:
 *   PowerShell: $env:REINER_CWD = '..\test-projects\test01'; pnpm live:large-chat
 *   bash:       REINER_CWD=../test-projects/test01 pnpm live:large-chat
 * Options: TURNS=<n> prompts per run (default 2), SHOW=1 to watch the browser.
 *
 * @see {@link ../docs/module.md#live-checks | Copilot module: live checks}
 * @see {@link ../docs/module.md#sending-and-reading | Copilot module: sending and reading}
 * @see {@link ../docs/module.md#chat-history | Copilot module: chat history}
 */
import path from 'node:path';
import { createCopilotModule } from '../src/copilot/module.ts';

export const LARGE_CHAT_TITLE = 'Large Chat Test (Keep)';
const TURNS = Number(process.env.TURNS ?? 2);

const root = path.resolve(process.env.REINER_CWD || process.cwd());
const module = createCopilotModule({
  projectRoot: root,
  profileDir: path.join(root, '.reiner/profiles/m365-copilot'),
  stateDir: path.join(root, '.reiner/modules/m365-copilot'),
  logDir: path.join(root, '.reiner/logs'),
  browser: { channel: 'auto', headless: process.env.SHOW !== '1', keepOpen: false },
  settings: {},
});

const t0 = Date.now();
const log = (msg: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${msg}`);
const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const start = Date.now();
  const result = await fn();
  log(`${label} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  return result;
};
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

try {
  const started = await time('started', () => module.start());
  if (!started.signIn.signedIn) throw new Error(started.signIn.reason);

  let chat = (await module.listChats()).find((c) => c.title === LARGE_CHAT_TITLE);
  if (!chat) {
    log(`"${LARGE_CHAT_TITLE}" not found in the recent list; creating it`);
    await module.newChat();
    await module.send(
      'This conversation is a long-running test log for the Reiner CLI. Reply with just: Ready.',
    );
    chat = await module.renameChat(LARGE_CHAT_TITLE);
  }
  check(chat.title === LARGE_CHAT_TITLE, `found "${LARGE_CHAT_TITLE}" (${chat.id.slice(0, 8)}…)`);

  await time('opened the large chat', () => module.openChat(chat.id));
  let lastPrompt = '';
  for (let i = 1; i <= TURNS; i++) {
    lastPrompt = `Test run ${stamp}, turn ${i}: write about 150 words on a random topic from computing history, then end with the line "END ${i}".`;
    const reply = await time(`turn ${i} answered`, () => module.send(lastPrompt));
    check(
      reply.markdown.includes(`END ${i}`),
      `turn ${i} reply is complete (${reply.markdown.length} chars)`,
    );
  }

  await time('switched to a new chat', () => module.newChat());
  const away = await module.currentChat();
  check(away?.id !== chat.id, 'the new chat is not the large chat');

  await time('switched back to the large chat', () => module.openChat(chat.id));
  const back = await module.currentChat();
  check(back?.id === chat.id, 'the large chat is open again');

  const reply = await time('one more turn answered', () =>
    module.send(`Test run ${stamp}: reply with just the word "back".`),
  );
  check(
    /back/i.test(reply.markdown),
    `sending works after switching back ("${reply.markdown.slice(0, 20)}")`,
  );
} catch (error) {
  failures++;
  log(`ERROR ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await module.stop({ wait: true });
}
log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
