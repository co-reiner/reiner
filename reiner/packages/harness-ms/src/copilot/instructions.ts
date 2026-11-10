/**
 * @file Copilot's custom instructions dialog: reading the text and saving it, checked by reading it back.
 * @see {@link ../../docs/file-exchange.md#custom-instructions | Copilot file exchange: custom instructions}
 * @see {@link ../../../exchange-packs/docs/packs.md#where-the-sections-live | File exchange: where the sections live}
 */
import type { Page } from '@co-reiner/browser';
import type { ChatActionOptions, StatusListener } from '@co-reiner/core';
import { signedInPage } from './browser.ts';
import * as S from './selectors.ts';
import type { CopilotState, Locator } from './state.ts';

/**
 * Open Settings → Personalization → Customize Copilot, run `fn` with the instructions field, then
 * close the dialog. The field's text loads a moment after it appears, so it is read until stable.
 */
/** Stop here if the user cancelled, saying what was and was not done. */
function stopIfCancelled(signal: AbortSignal | undefined, done: string): void {
  if (signal?.aborted) throw new Error(`Cancelled. ${done}`);
}

const UNCHANGED = 'Your custom instructions are unchanged.';

async function inCustomize<T>(
  st: CopilotState,
  fn: (page: Page, field: Locator) => Promise<T>,
  onStatus?: StatusListener,
  signal?: AbortSignal,
): Promise<T> {
  stopIfCancelled(signal, UNCHANGED);
  const page = await signedInPage(st, [], onStatus);
  onStatus?.('Opening Copilot settings…');
  try {
    await page.locator(S.SETTINGS_MENU).first().click();
    await page.getByText(S.SETTINGS_ITEM, { exact: true }).first().click();
    await page.getByText(S.PERSONALIZATION_TAB, { exact: true }).first().click();
    await page.locator(S.CUSTOMIZE_MANAGE).first().click();
    const field = page.locator(S.INSTRUCTIONS_FIELD).first();
    await field.waitFor({ timeout: 20_000 });
    let last = await field.inputValue();
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(500);
      const now = await field.inputValue();
      if (now === last && i >= 2) break;
      last = now;
    }
    return await fn(page, field);
  } finally {
    await page
      .locator(S.SETTINGS_CLOSE)
      .first()
      .click({ timeout: 5000 })
      .catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  }
}

export async function readInstructions(
  st: CopilotState,
  onStatus?: StatusListener,
  signal?: AbortSignal,
): Promise<string> {
  return inCustomize(st, (_page, field) => field.inputValue(), onStatus, signal);
}

/** Fill the field, press Save, wait, and return any message Copilot showed on saving. */
async function saveOnce(
  page: Page,
  field: Locator,
  text: string,
  onStatus?: StatusListener,
  signal?: AbortSignal,
): Promise<string> {
  onStatus?.('Saving custom instructions…');
  const dialogText = () =>
    page
      .locator('[role="dialog"]')
      .first()
      .innerText()
      .catch(() => '');
  const before = await dialogText();
  // The last moment to cancel with nothing changed: the dialog is closed without saving.
  stopIfCancelled(signal, UNCHANGED);
  await field.fill(text);
  const save = page.getByRole('button', { name: S.SAVE_CUSTOMIZATION });
  await save.click();
  // The button goes back to disabled once the save is done.
  await page
    .waitForFunction(
      (name) =>
        [...document.querySelectorAll('button')].some(
          (b) => (b.textContent ?? '').trim() === name && (b as HTMLButtonElement).disabled,
        ),
      S.SAVE_CUSTOMIZATION,
      { timeout: 20_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(3000);
  // Any message Copilot showed on saving (an error, a policy notice), to explain a refused save.
  const beforeLines = new Set(before.split('\n').map((l) => l.trim()));
  const shown = [
    ...(await dialogText()).split('\n').map((l) => l.trim()),
    ...(await page
      .locator('[role="alert"], [role="status"]')
      .allInnerTexts()
      .catch(() => [] as string[])),
  ].filter((l) => l && !beforeLines.has(l) && !text.includes(l));
  return [...new Set(shown)].join(' | ').slice(0, 500);
}

export async function writeInstructions(
  st: CopilotState,
  text: string,
  opts: ChatActionOptions = {},
): Promise<void> {
  let saveMessage = '';
  // Closing the dialog too soon after Save loses the save, silently. So wait after saving, check by
  // reading back from a fresh dialog, and try once more before giving up.
  const attempt = () =>
    inCustomize(
      st,
      async (page, field) => {
        saveMessage = await saveOnce(page, field, text, opts.onStatus, opts.signal);
      },
      opts.onStatus,
      opts.signal,
    );
  let saved = '';
  for (let i = 0; i < 2; i++) {
    await attempt();
    // Save has been pressed by now, so a cancel can no longer promise that nothing changed.
    stopIfCancelled(
      opts.signal,
      'Save had already been pressed: run /instructions to see what Copilot holds.',
    );
    saved = await readInstructions(st, opts.onStatus);
    if (saved.trim() === text.trim()) return;
    if (i === 0) opts.onStatus?.('The save did not stick; trying once more…');
  }
  throw new Error(
    `Copilot did not save the new instructions: it still holds ${saved.length} characters (${text.length} were sent).${saveMessage ? ` Copilot showed: "${saveMessage}".` : ' Copilot showed no message.'} The text from before the change is in the backup.`,
  );
}
