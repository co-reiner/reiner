/**
 * @file Files in the Copilot page: uploads through the "+" menu, the files a reply offers (download links and
 * file cards: listing and saving them), and closing co-edited documents.
 * @see {@link ../../docs/file-exchange.md#packs-zipdocx | Copilot file exchange: packs}
 * @see {@link ../../docs/file-exchange.md#reply-modes | Copilot file exchange: reply modes}
 * @see {@link ../../docs/file-exchange.md#co-editing-documents | Copilot file exchange: co-editing documents}
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@co-reiner/browser';
import type { ChatActionOptions, StatusListener } from '@co-reiner/core';
import { tab } from './browser.ts';
import * as S from './selectors.ts';
import type { CopilotState, Locator } from './state.ts';

/** Take every attachment chip out of the prompt box's draft (the uploaded files stay in the uploads). */
export async function removeDraftAttachments(page: Page): Promise<void> {
  const chips = page.locator(S.REMOVE_ATTACHMENT);
  // Bounded: a chip that will not go must not hold the turn forever.
  for (let i = 0; i < 20 && (await chips.count()) > 0; i++) {
    await chips.first().click();
    await page.waitForTimeout(300);
  }
}

/**
 * Upload files into the prompt box through the "+" menu's "Upload images and files" item, the same file
 * chooser a user gets, then wait until Copilot has stored each one (its chip gets an `SPO_` id).
 */
export async function attach(page: Page, files: string[], onStatus?: StatusListener): Promise<void> {
  const names = files.map((f) => path.basename(f));
  // OneDrive renames a duplicate upload ("<name>.zip.docx" becomes "<name>.zip <number>.docx"), so chips are counted, not
  // matched by name. Callers should use unique file names to keep the names the model sees intact.
  const stored = () =>
    page.evaluate(
      (chip) => [...document.querySelectorAll(chip)].filter((c) => c.id.startsWith('SPO_')).length,
      S.ATTACHMENT,
    );
  // Chips left in the draft by an earlier, unsent attempt would go out with this prompt; remove them.
  await removeDraftAttachments(page);
  const before = await stored();
  onStatus?.(`Uploading ${names.join(', ')}…`);
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
  // Handled here, so a failed click cannot leave the wait rejecting unhandled; the await below rethrows.
  chooser.catch(() => {});
  await page.locator(S.PLUS_MENU).first().click();
  await page.getByRole('menuitem', { name: S.UPLOAD_MENU_ITEM }).click();
  await (await chooser).setFiles(files);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const done = (await stored()) - before;
    if (done >= names.length) return;
    const alert = await page
      .locator('[role="alert"]')
      .allInnerTexts()
      .then((t) => t.join(' ').trim())
      .catch(() => '');
    // Copilot also shows an informational alert ("Uploading from device will send a copy to OneDrive"),
    // so only failure wording counts.
    if (/can['’]?t|couldn['’]?t|cannot|unable|failed|not supported|too large|exceeds|blocked/i.test(alert))
      throw new Error(`Copilot refused the upload: ${alert}`);
    onStatus?.(`Uploading ${names.join(', ')}… (${Math.max(0, done)}/${names.length})`);
    await page.waitForTimeout(500);
  }
  throw new Error(`Uploading ${names.join(', ')} did not finish in 5 minutes.`);
}

/**
 * Names of the files a reply offers, after a prompt element (not inside it: the prompt's own attachments do
 * not count): download links (`a[download]`) and file cards ("Saved in … OneDrive"). Waits up to `waitMs`
 * for them.
 */
export async function replyDownloads(page: Page, prompt: unknown, waitMs: number): Promise<string[]> {
  const read = () =>
    page
      .evaluate(
        ({ prompt, link, cardName }) => {
          // No named helpers in here: tsx wraps them in a `__name()` call the page does not have, the
          // evaluate throws, and the catch below hides it as "no files".
          const p = prompt as Element | null;
          if (!p?.isConnected) return [] as string[];
          const found: string[] = [];
          for (const [selector, attribute] of [
            [link, 'download'],
            [cardName, 'title'],
          ] as const) {
            for (const el of document.querySelectorAll(selector)) {
              if (p.contains(el) || !(p.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))
                continue;
              const value = el.getAttribute(attribute);
              if (value) found.push(value);
            }
          }
          return found;
        },
        { prompt, link: S.DOWNLOAD_LINK, cardName: `${S.FILE_CARD} ${S.FILE_CARD_NAME}` },
      )
      .catch(() => [] as string[]);
  const until = Date.now() + waitMs;
  let names = await read();
  while (names.length === 0 && Date.now() < until) {
    await page.waitForTimeout(500).catch(() => {});
    names = await read();
  }
  return [...new Set(names)];
}

/**
 * A reply's download link for `name`: the exact `download` attribute first, then a link whose text is
 * exactly the name, and only then one whose text contains it ("a.zip" must not pick "data.zip"). Undefined
 * when no link names it.
 */
async function downloadLink(page: Page, name: string): Promise<Locator | undefined> {
  const links = page.locator(S.DOWNLOAD_LINK);
  const exactText = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  for (const candidate of [
    page.locator(S.downloadLinkNamed(name)),
    links.filter({ hasText: exactText }),
    links.filter({ hasText: name }),
  ]) {
    if ((await candidate.count()) > 0) return candidate.last();
  }
  return undefined;
}

/** Start the download of `name`: its link, else its file card's "More actions" menu, item "Download". */
async function startDownload(page: Page, name: string): Promise<void> {
  const link = await downloadLink(page, name);
  if (link) return link.click();
  // Copilot sometimes shows the same file twice in one reply: the last card is the one to use.
  const card = page.locator(S.fileCardNamed(name)).last();
  await card.locator(S.FILE_CARD_MORE).click();
  const exact = new RegExp(`^\\s*${S.FILE_CARD_DOWNLOAD}\\s*$`);
  await page.locator(S.MENU_ITEM).filter({ hasText: exact }).last().click();
}

/**
 * Download the files the newest reply offers (all, or only `names`) into `dir`, through the page's own
 * controls. Returns the saved files and the names they came from.
 */
export async function downloadFromReply(
  st: CopilotState,
  dir: string,
  opts: ChatActionOptions & { names?: string[]; waitMs?: number } = {},
): Promise<{ files: string[]; names: string[] }> {
  const page = (await tab(st, opts.onStatus)).page;
  const prompts = page.locator(S.QUESTION);
  const last = (await prompts.count()) > 0 ? await prompts.last().elementHandle() : null;
  const offered = await replyDownloads(page, last, opts.waitMs ?? 5000);
  const names = offered.filter((n) => !opts.names || opts.names.includes(n));
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const name of names) {
    opts.onStatus?.(`Downloading ${name}…`);
    const download = page.waitForEvent('download', { timeout: 60_000 });
    // Handled here, so a failed click cannot leave the wait rejecting unhandled; the await below rethrows.
    download.catch(() => {});
    await startDownload(page, name);
    const d = await download;
    const file = path.join(dir, path.basename(d.suggestedFilename() || name));
    await d.saveAs(file);
    files.push(file);
  }
  return { files, names };
}

/** Download the files the newest reply offers (all, or only `names`) into `dir`; returns the saved files. */
export async function downloadReplyFiles(
  st: CopilotState,
  dir: string,
  opts: ChatActionOptions & { names?: string[] } = {},
): Promise<string[]> {
  return (await downloadFromReply(st, dir, opts)).files;
}

/**
 * Close a document Copilot opened for co-editing (Word for the web in the page). Walks up from the
 * editor frame to the nearest container with a close button and clicks it. Returns true when it closed
 * one. Touches nothing when no editor frame is open.
 */
export async function closeCoEditing(page: Page): Promise<boolean> {
  const frame = page.locator(S.COEDIT_FRAME).first();
  if (!(await frame.isVisible().catch(() => false))) return false;
  const marked = await frame
    .evaluate((el, close) => {
      let node: Element | null = el.parentElement;
      for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        const button = [...node.querySelectorAll(close)].find(
          (b) => !(el as Element).contains(b) && (b as HTMLElement).offsetParent !== null,
        );
        if (button) {
          button.setAttribute('data-reiner-coedit-close', '1');
          return true;
        }
      }
      return false;
    }, S.COEDIT_CLOSE)
    .catch(() => false);
  if (!marked) return false;
  await page
    .locator('[data-reiner-coedit-close="1"]')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(500).catch(() => {});
  return !(await frame.isVisible().catch(() => false));
}
