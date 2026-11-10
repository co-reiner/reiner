/**
 * @file Putting a prompt into Copilot's prompt box and sending it, with the points where a turn the user
 * cancelled stops before anything reaches the model.
 * @see {@link ../../docs/module.md#sending-and-reading | Copilot module: sending and reading}
 * @see {@link ../../docs/module.md#cancelling-a-turn | Copilot module: cancelling a turn}
 */
import path from 'node:path';
import type { Page } from '@co-reiner/browser';
import type { SendOptions } from '@co-reiner/core';
import { attach, removeDraftAttachments } from './page-files.ts';
import * as S from './selectors.ts';
import type { CopilotState, Locator } from './state.ts';

export type PromptHandle = Awaited<ReturnType<Locator['elementHandle']>>;

/** What submitting came to: this turn's prompt element, or why nothing was sent. */
export type Submitted = { prompt: PromptHandle } | { cancelled: string[] };

/** The start of a prompt as the page shows it, to recognise this turn's prompt element. */
export const promptStart = (prompt: string) => prompt.replace(/\s+/g, ' ').trim().slice(0, 40);

/** Empty the prompt box: its text and any attachment chips. */
async function clearDraft(page: Page, box: Locator): Promise<void> {
  await removeDraftAttachments(page).catch(() => {});
  await box.click().catch(() => {});
  await page.keyboard.press('ControlOrMeta+A').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
}

/**
 * Type the prompt into the box, press Enter, and return this turn's prompt element once Copilot shows it.
 * The user can cancel until Enter is pressed (`st.stopRequested`): the draft is emptied, nothing is sent,
 * and the notes say what the turn left behind (an uploaded file stays in Copilot's uploads).
 */
export async function submitPrompt(
  st: CopilotState,
  page: Page,
  prompt: string,
  opts: SendOptions,
): Promise<Submitted> {
  // Long chats are loaded lazily, so counting prompts on the page is unreliable. Instead remember the
  // newest prompt element before sending, and look for a newer one that starts with this prompt's text.
  const questions = page.locator(S.QUESTION);
  const previous = (await questions.count()) > 0 ? await questions.last().elementHandle() : null;
  const start = promptStart(prompt);
  const box = page.locator(S.CHAT_INPUT.join(', ')).first();
  const files = opts.attachments ?? [];
  if (files.length) {
    await attach(page, files, opts.onStatus);
    if (st.stopRequested) {
      await clearDraft(page, box);
      const names = files.map((f) => path.basename(f)).join(', ');
      return {
        cancelled: [
          `${names} had already been uploaded: it stays in Copilot's uploads in OneDrive, unused. The next upload of that name replaces it, and /transfer clean removes it.`,
        ],
      };
    }
  }
  opts.onStatus?.('Typing the prompt into Copilot…');
  await box.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  // insertText puts the whole prompt in at once, like a paste, without pressing Enter on newlines.
  await page.keyboard.insertText(prompt);
  // The last moment to cancel without Copilot seeing the prompt.
  if (st.stopRequested) {
    await clearDraft(page, box);
    return { cancelled: [] };
  }
  await page.keyboard.press('Enter');

  // The prompt shows up in the conversation once Copilot has taken it. Its replies come after it.
  const taken = (ms: number) =>
    page
      .waitForFunction(
        ({ selector, previous, start }) => {
          const all = document.querySelectorAll(selector);
          const last = all[all.length - 1] as HTMLElement | undefined;
          return !!last && last !== previous && last.innerText.replace(/\s+/g, ' ').includes(start);
        },
        { selector: S.QUESTION, previous, start },
        { timeout: ms, polling: 250 },
      )
      .then(() => true)
      .catch(() => false);
  let sent = await taken(5000);
  if (!sent) {
    // Sometimes Enter lands before the editor is ready. If the prompt is still in the box, press it again.
    const left = (await box.innerText().catch(() => '')).trim();
    if (left.length > 0) {
      opts.onStatus?.('Copilot did not take the prompt; pressing Enter again…');
      await box.click().catch(() => {});
      await page.keyboard.press('End').catch(() => {});
      await page.keyboard.press('Enter');
    }
    sent = await taken(25_000);
  }
  if (!sent) throw new Error('Copilot did not take the prompt (it never appeared in the conversation).');
  return { prompt: await questions.last().elementHandle() };
}
