/**
 * @file Live check of the Google Search harness against the real AI mode page. Not part of `pnpm test`.
 * Sends one prompt the way the TUI does (through the exchange, so the first prompt carries the briefing),
 * prints the reply as markdown, and answers what it asks for (files, tool calls) for up to two rounds. Sends few prompts on
 * purpose: Google blocks robots, and a block is handed to the person at the window, never worked around.
 *
 * From reiner/:
 *   PowerShell: $env:REINER_CWD = '../test-projects/test02'; pnpm live:gs-chat
 *   bash:       REINER_CWD=../test-projects/test02 pnpm live:gs-chat
 *
 * Options (environment): ASK (the prompt; default a three-word greeting), SHARE (paths or globs to send
 * with it, space separated), MODE (`text` or `upload`), PLAIN=1 (send the prompt as typed, no briefing),
 * FIRST (a prompt to send as typed before it), HIDE=1 (run the browser hidden).
 *
 * @see {@link ../docs/module.md#live-checks | The Google Search module: live checks}
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractToolCalls, type PreparedPrompt } from '@co-reiner/core';
import { createGoogleSearchModule } from '../src/gs/module.ts';

const root = path.resolve(process.env.REINER_CWD || process.cwd());
const dir = path.join(root, '.reiner');
const logs = path.join(dir, 'logs');
const module = createGoogleSearchModule({
  projectRoot: root,
  profileDir: path.join(dir, 'profiles', 'google-search'),
  stateDir: path.join(dir, 'modules', 'google-search'),
  logDir: logs,
  browser: { channel: 'auto', headless: process.env.HIDE === '1', keepOpen: false },
  settings: {},
});
const log = (text: string) => console.log(text);
const onStatus = (s: string) => log(`  … ${s}`);

try {
  const started = await module.start({ onStatus });
  if (!started.signIn.signedIn) {
    log(`Not usable: ${started.signIn.reason}`);
    const again = await module.login({ onStatus });
    if (!again.signIn.signedIn) throw new Error(again.signIn.reason);
  }
  const { exchange } = module;
  if (process.env.MODE === 'text' || process.env.MODE === 'upload') await exchange.setMode(process.env.MODE);
  if (process.env.SHARE) {
    const { queued, refused } = await exchange.queue(process.env.SHARE.split(/\s+/).filter(Boolean));
    log(
      `queued: ${queued.join(', ') || 'nothing'}; refused: ${refused.map((r) => r.path).join(', ') || 'nothing'}`,
    );
  }
  if (process.env.FIRST) {
    const opener = await module.send(process.env.FIRST, { onStatus });
    log(`<<< opener reply: ${opener.markdown.slice(0, 300)}`);
  }
  const ask = process.env.ASK || 'Hello, what can you do in 3 words';
  let prepared: PreparedPrompt =
    process.env.PLAIN === '1'
      ? { prompt: ask, attachments: [] }
      : await exchange.prepare(ask, (await module.currentChat?.())?.id);
  for (let round = 0; round < 3; round++) {
    log(`\n>>> prompt (${prepared.prompt.length} characters, ${prepared.attachments.length} attached)`);
    const reply = await module.send(prepared.prompt, {
      onStatus,
      ...(prepared.attachments.length ? { attachments: prepared.attachments } : {}),
    });
    const chat = await module.currentChat?.();
    await exchange.afterSend(chat?.id, prepared, round === 0 ? ask : '');
    log(
      `<<< reply in ${(reply.elapsedMs / 1000).toFixed(1)} s${reply.stopped ? ' (stopped)' : ''}:\n${reply.markdown}`,
    );
    await mkdir(logs, { recursive: true });
    await writeFile(path.join(logs, `live-reply-${round}.md`), reply.markdown);
    const tools = extractToolCalls(reply.markdown);
    const found = await exchange.collect(reply);
    log(
      `tool calls: ${tools.calls.length}, not understood: ${tools.errors.length}, change sets: ${found.sets.length}`,
    );
    for (const note of found.notes) log(`  note: ${note}`);
    if (tools.calls.length + tools.errors.length === 0) {
      // Files the reply asked for in plain words are queued: send them, as the user would with one line.
      if (exchange.pending().length === 0) break;
      prepared = await exchange.prepare('Here are the files.', chat?.id);
      continue;
    }
    const answered = await exchange.runTools(tools, chat?.id, { confirm: async () => true, onStatus });
    for (const line of answered.summary) log(`  tool: ${line}`);
    prepared = answered.prepared;
  }
} finally {
  await module.stop({ wait: true });
}
