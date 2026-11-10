/**
 * @file Sending a prompt to Copilot, streaming the reply back as markdown, and stopping generation.
 * @see {@link ../../docs/module.md#sending-and-reading | Copilot module: sending and reading}
 * @see {@link ../../docs/module.md#page-lessons | Copilot module: page lessons}
 * @see {@link ../../docs/file-exchange.md#co-editing-documents | Copilot file exchange: co-editing documents}
 * @see {@link ../../../../docs/architecture/modules.md#reading-replies | Harness modules: reading replies}
 */
import type { Page } from '@co-reiner/browser';
import type { ChatReply, SendOptions } from '@co-reiner/core';
import { signedInPage } from './browser.ts';
import { replyHtmlToMarkdown } from './markdown.ts';
import { closeCoEditing, replyDownloads } from './page-files.ts';
import { pickerButtonModel } from './picker.ts';
import * as S from './selectors.ts';
import {
  type CopilotState,
  EMPTY_IDLE_MS,
  NEVER_STARTED_MS,
  STOP_WAIT_MS,
  THINKING_IDLE_MS,
} from './state.ts';
import { type PromptHandle, promptStart, submitPrompt } from './submit.ts';
import { replacePreviousUploads } from './uploads.ts';

/** This turn's prompt: its element, and the start of its text to find it again if Copilot re-renders it. */
interface Turn {
  prompt: PromptHandle;
  start: string;
}

/**
 * Read the newest reply with text after this turn's prompt, and how many reply slots (empty or not)
 * follow it. Thinking models ("Think deeper") add empty reply placeholders before and around the answer,
 * so empty ones are skipped. If Copilot re-rendered the conversation and the prompt element is gone, the
 * newest prompt that starts with this turn's text takes its place. `null` when the prompt cannot be found.
 */
function readReply(page: Page, turn: Turn): Promise<{ html: string; slots: number } | null> {
  return page
    .evaluate(
      ({ prompt, start, question, reply }) => {
        let anchor: Element | null = prompt?.isConnected ? prompt : null;
        if (!anchor) {
          const all = [...document.querySelectorAll(question)];
          anchor =
            all.reverse().find((q) => (q as HTMLElement).innerText.replace(/\s+/g, ' ').includes(start)) ??
            null;
        }
        if (!anchor) return null;
        const from = anchor;
        const after = [...document.querySelectorAll(reply)].filter(
          (r) => (from.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        );
        // Skip empty placeholders: the answer is the newest reply that has text.
        const filled = after.filter((r) => (r.textContent ?? '').trim().length > 0);
        return {
          html: filled.length ? (filled[filled.length - 1] as Element).innerHTML : '',
          slots: after.length,
        };
      },
      { prompt: turn.prompt, start: turn.start, question: S.QUESTION, reply: S.REPLY },
    )
    .catch(() => null);
}

/** Poll the rendered reply until the stop button is gone and the text has stopped changing. */
async function waitForReply(
  st: CopilotState,
  page: Page,
  turn: Turn,
  deadline: number,
  onDelta: SendOptions['onDelta'],
): Promise<{ markdown: string; finished: boolean; unstopped?: boolean }> {
  const stop = page.locator(S.STOP_BUTTON).first();
  let markdown = '';
  let unchanged = 0;
  /** When stopGenerating() was first seen, and since when the stop button has been gone. */
  let stoppedAt: number | undefined;
  let idleSince: number | undefined;
  /** Copilot has shown the stop button or some reply text for this turn. */
  let started = false;
  /** An empty reply slot follows the prompt: Copilot is still thinking. */
  let thinking = false;
  const submittedAt = Date.now();
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error('The browser window was closed while Copilot was answering.');
    const read = await readReply(page, turn);
    if (read) thinking = read.slots > 0;
    const next = read === null ? markdown : replyHtmlToMarkdown(read.html);
    if (next !== markdown) {
      markdown = next;
      unchanged = 0;
      onDelta?.(markdown);
    } else {
      unchanged++;
    }
    const generating = await stop.isVisible().catch(() => false);
    if (generating || markdown) started = true;
    // Nothing at all after the prompt went in: the page never took it. Do not hold the user for the whole timeout.
    if (!started && !thinking && !st.stopRequested && Date.now() - submittedAt > NEVER_STARTED_MS) {
      throw new Error(
        `Copilot did not start answering within ${NEVER_STARTED_MS / 1000} seconds. Check its window, then send the prompt again.`,
      );
    }
    // Before Copilot shows any sign of answering, an idle page means "not started yet", not "done".
    idleSince = generating || !started ? undefined : (idleSince ?? Date.now());
    if (st.stopRequested) {
      stoppedAt ??= Date.now();
      // Esc can land before Copilot shows its stop button: press it as soon as it is there.
      if (generating) await stop.click().catch(() => {});
    }
    // Normal end: the stop button is gone and the text has settled.
    // After the user stops it, or once the button has been gone for 3 s, finish even if the page
    // keeps changing (Copilot can keep re-rendering a stopped or finished reply). A stop asked for before
    // Copilot started waits longer for the button to show up, so it can be pressed.
    // A thinking model can hide the stop button between thinking and writing, so with no text yet, an
    // idle page only counts as done after much longer: minutes while an empty reply slot shows it is
    // still thinking, 20 s when the stop button came and went without a slot. (A turn that never starts
    // at all is the 30 s check above.)
    const settled = started && !generating && unchanged >= 2 && markdown !== '';
    const sinceStop = stoppedAt === undefined ? 0 : Date.now() - stoppedAt;
    const stopDone =
      stoppedAt !== undefined && (started ? !generating || sinceStop > 3000 : sinceStop > STOP_WAIT_MS);
    // Stopped, but Copilot never showed anything to stop: it has the prompt and may still answer.
    if (stopDone && !started) return { markdown, finished: true, unstopped: true };
    const idleLongEnough =
      idleSince !== undefined &&
      Date.now() - idleSince > (markdown ? 3000 : thinking ? THINKING_IDLE_MS : EMPTY_IDLE_MS);
    if (settled || stopDone || idleLongEnough) return { markdown, finished: true };
    await page.waitForTimeout(300).catch(() => {});
  }
  return { markdown, finished: false };
}

/** The reply for a turn the user cancelled before the prompt went: nothing reached the model. */
function cancelled(startedAt: number, notes: string[]): ChatReply {
  return {
    markdown: '',
    stopped: true,
    notSent: true,
    ...(notes.length ? { notes } : {}),
    elapsedMs: Date.now() - startedAt,
  };
}

export async function send(st: CopilotState, prompt: string, opts: SendOptions = {}): Promise<ChatReply> {
  const notes: string[] = [];
  const startedAt = Date.now();
  // From here on a stop (Esc) counts for this turn, also while files are still being uploaded.
  st.stopRequested = false;
  // Old copies of files uploaded again go first: this visits OneDrive and comes back to the chat, so it
  // runs before anything on the chat page is read.
  const files = opts.attachments ?? [];
  const replaced = files.length ? await replacePreviousUploads(st, files, opts.onStatus) : [];
  if (st.stopRequested) {
    const bin = `The earlier upload of ${replaced.join(', ')} had already been moved to the OneDrive recycle bin; the pack goes up again with your next prompt.`;
    return cancelled(startedAt, replaced.length ? [bin] : []);
  }
  const page = await signedInPage(st, notes, opts.onStatus);
  if (st.stopRequested) return cancelled(startedAt, []);

  const submitted = await submitPrompt(st, page, prompt, opts);
  if ('cancelled' in submitted) return cancelled(startedAt, submitted.cancelled);
  const ours = submitted.prompt;
  const turn = { prompt: ours, start: promptStart(prompt) };
  opts.onStatus?.('Waiting for Copilot to answer…');
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  const { markdown, finished, unstopped } = await waitForReply(st, page, turn, deadline, opts.onDelta);
  if (!finished && !markdown) throw new Error('Copilot did not finish answering in time.');
  // An idle page with no text is not an answer: only a reply the user stopped may come back empty.
  if (!markdown && !st.stopRequested) throw new Error('Copilot stopped without writing a reply.');

  // A document opened for co-editing stays in Copilot's prompt context until it is closed.
  const closedDocument = await closeCoEditing(page);
  if (closedDocument) opts.onStatus?.('Closed the document Copilot opened for co-editing.');
  // Files the model created (links, file cards) render a moment after the text settles. Always set, also
  // when empty: a reply without it (read back from the history) has its files looked up in the page.
  const downloads = finished && !st.stopRequested ? await replyDownloads(page, ours, 5000) : [];
  const conversation = page.url();
  const model = await pickerButtonModel(page);
  const left = unstopped
    ? [
        'Copilot had the prompt but had not started answering, so there was nothing to stop: it may still reply in its window. /history shows what it wrote.',
      ]
    : [];
  return {
    markdown,
    stopped: st.stopRequested || !finished,
    ...(left.length ? { notes: left } : {}),
    ...(conversation.includes('/conversation/') ? { conversationUrl: conversation } : {}),
    ...(model ? { model } : {}),
    downloads,
    ...(closedDocument ? { closedDocument } : {}),
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Stop the turn in progress. While a reply is being written this presses Copilot's own stop button. Before
 * that, `send` sees the request at its next step: it cancels cleanly if the prompt has not gone yet, and
 * otherwise presses the button as soon as Copilot shows it.
 */
export async function stopGenerating(st: CopilotState): Promise<void> {
  if (!st.live || st.live.page.isClosed()) return;
  st.stopRequested = true;
  const stop = st.live.page.locator(S.STOP_BUTTON).first();
  if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {});
}
