/**
 * @file Sending a prompt to Google's AI mode, streaming the reply back as markdown, stopping, and starting
 * a new conversation.
 * @see {@link ../../docs/module.md#sending-and-reading | The Google Search module: sending and reading}
 * @see {@link ../../docs/module.md#robot-checks | The Google Search module: robot checks}
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@co-reiner/browser';
import type { ChatReply, SendOptions, StatusListener } from '@co-reiner/core';
import { readyPage, showRobotCheck } from './browser.ts';
import { replyHtmlToMarkdown } from './markdown.ts';
import * as S from './selectors.ts';
import { type GsState, NO_REPLY_MS, ROBOT_CHECK_REASON } from './state.ts';

/** The newest turn's reply: its HTML so far, and whether the page marks it finished. */
function readReply(page: Page, turns: number): Promise<{ html: string; complete: boolean } | null> {
  return page
    .evaluate(
      ({ turn, reply, body, complete, turns }) => {
        const all = document.querySelectorAll(turn);
        // Only a turn newer than the ones there before this prompt is this prompt's.
        if (all.length <= turns) return null;
        const scope = (all[all.length - 1] as Element).querySelector(reply);
        if (!scope) return { html: '', complete: false };
        return {
          html: scope.querySelector(body)?.innerHTML ?? '',
          complete: scope.getAttribute(complete) === 'true',
        };
      },
      { turn: S.TURN, reply: S.REPLY, body: S.REPLY_BODY, complete: S.REPLY_COMPLETE, turns },
    )
    .catch(() => null);
}

/** Upload files through the page's own "Add files" entry and its file chooser. */
async function attach(page: Page, files: string[], onStatus?: StatusListener): Promise<void> {
  onStatus?.(`Uploading ${files.map((f) => path.basename(f)).join(', ')}…`);
  await page.locator(S.ADD_MENU).first().click();
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
  await page.locator(S.ADD_FILES).first().click();
  await (await chooser).setFiles(files);
  // The upload shows as a chip in the prompt box; give it a moment to finish before the prompt goes.
  await page.waitForTimeout(4000).catch(() => {});
}

/** Poll the newest turn until the page marks the reply finished, or the user stops it. */
async function waitForReply(
  st: GsState,
  page: Page,
  turns: number,
  deadline: number,
  onDelta: SendOptions['onDelta'],
): Promise<{ markdown: string; finished: boolean; html: string }> {
  const stop = page.locator(S.STOP_BUTTON).first();
  const sentAt = Date.now();
  let markdown = '';
  let html = '';
  let unchanged = 0;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error('The browser window was closed while Google was answering.');
    const read = await readReply(page, turns);
    if (read) html = read.html;
    const next = read ? replyHtmlToMarkdown(read.html) : markdown;
    if (next !== markdown) {
      markdown = next;
      unchanged = 0;
      onDelta?.(markdown);
    } else {
      unchanged++;
    }
    if (st.stopRequested) {
      if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {});
      return { markdown, finished: true, html };
    }
    if (read?.complete && markdown && unchanged >= 2) return { markdown, finished: true, html };
    // No text at all for this long: Google is holding the reply back, as it does while a robot check waits.
    if (!markdown && Date.now() - sentAt > NO_REPLY_MS) return { markdown, finished: false, html };
    await page.waitForTimeout(300).catch(() => {});
  }
  return { markdown, finished: markdown !== '', html };
}

/** No reply came: see whether a robot check is the cause, show it if so, and say what to do. */
async function noReply(st: GsState, onStatus?: StatusListener): Promise<never> {
  // The page as it stood, kept for finding out why: it is the first thing to look at when the page changes.
  const page = st.live?.page;
  if (page && !page.isClosed()) {
    const html = await page.content().catch(() => '');
    await mkdir(st.ctx.logDir, { recursive: true })
      .then(() => writeFile(path.join(st.ctx.logDir, 'google-search-no-reply.html'), html))
      .catch(() => {});
  }
  if (await showRobotCheck(st, onStatus)) {
    throw new Error(`${ROBOT_CHECK_REASON} Then send the prompt again: it starts a new conversation.`);
  }
  // The look for a check left AI mode; go back so the next prompt has its box.
  await st.live?.page.goto(st.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  throw new Error(
    'Google did not answer and shows no robot check. Look at its window, then send the prompt again.',
  );
}

export async function send(st: GsState, prompt: string, opts: SendOptions = {}): Promise<ChatReply> {
  const startedAt = Date.now();
  st.stopRequested = false;
  const page = await readyPage(st, opts.onStatus);
  const cancelled = (): ChatReply => ({
    markdown: '',
    stopped: true,
    notSent: true,
    elapsedMs: Date.now() - startedAt,
  });
  if (st.stopRequested) return cancelled();

  const turns = await page.locator(S.TURN).count();
  const files = opts.attachments ?? [];
  if (files.length) await attach(page, files, opts.onStatus);
  opts.onStatus?.('Typing the prompt…');
  const box = page.locator(S.CHAT_INPUT).first();
  await box.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  // insertText puts the whole prompt in at once, like a paste, without pressing Enter on newlines.
  await page.keyboard.insertText(prompt);
  if (st.stopRequested) {
    await page.keyboard.press('ControlOrMeta+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    const left = files.length
      ? ['The files were already attached to the prompt box; reload the page to drop them.']
      : [];
    return { ...cancelled(), ...(left.length ? { notes: left } : {}) };
  }
  await page.keyboard.press('Enter');
  st.thread ??= { id: `thread-${++st.threads}`, title: prompt.replace(/\s+/g, ' ').trim().slice(0, 60) };

  opts.onStatus?.('Waiting for Google to answer…');
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  const { markdown, finished, html } = await waitForReply(st, page, turns, deadline, opts.onDelta);
  if (!markdown && !st.stopRequested) return noReply(st, opts.onStatus);
  // The reply as the page drew it, kept for when the page changes and the markdown comes out wrong.
  await mkdir(st.ctx.logDir, { recursive: true })
    .then(() => writeFile(path.join(st.ctx.logDir, 'google-search-last-reply.html'), html))
    .catch(() => {});
  return { markdown, stopped: st.stopRequested || !finished, elapsedMs: Date.now() - startedAt };
}

/** Stop the turn in progress: press the page's own stop button, and let `send` see the request. */
export async function stopGenerating(st: GsState): Promise<void> {
  if (!st.live || st.live.page.isClosed()) return;
  st.stopRequested = true;
  const stop = st.live.page.locator(S.STOP_BUTTON).first();
  if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {});
}

/** A new conversation, with the page's own "New thread" button (or a fresh load when it is not there). */
export async function newChat(st: GsState, onStatus?: StatusListener): Promise<void> {
  const page = await readyPage(st, onStatus);
  onStatus?.('Starting a new conversation…');
  const button = page.locator(S.NEW_THREAD).first();
  const clicked = await button
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) await page.goto(st.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1000).catch(() => {});
  st.thread = undefined;
}
