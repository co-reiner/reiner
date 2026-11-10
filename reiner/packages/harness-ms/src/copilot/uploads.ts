/**
 * @file Copilot's uploads in OneDrive: listing them, moving old ones to the recycle bin, and replacing an
 * earlier upload of the same name so a pack keeps its name.
 * @see {@link ../../docs/file-exchange.md#packs-zipdocx | Copilot file exchange: packs}
 * @see {@link ../../docs/file-exchange.md#onedrive | Copilot file exchange: OneDrive}
 */
import path from 'node:path';
import type { ChatActionOptions, StatusListener } from '@co-reiner/core';
import type { Page } from 'playwright-core';
import { DriveAddressUnknownError, driveRow, inDriveFolder } from './drive.ts';
import * as S from './selectors.ts';
import type { CopilotState } from './state.ts';

/** The upload folder, relative to the library; `uploadsFolder` in the harness settings overrides it. */
const uploadsFolder = (st: CopilotState) =>
  (typeof st.ctx.settings.uploadsFolder === 'string'
    ? st.ctx.settings.uploadsFolder
    : S.DRIVE_UPLOADS_FOLDER
  ).replace(/^\/+|\/+$/g, '');

/** File names in Copilot's upload folder; empty when the folder does not exist yet. */
export async function listUploads(st: CopilotState, opts: ChatActionOptions = {}): Promise<string[]> {
  return inDriveFolder(
    st,
    uploadsFolder(st),
    async (page, exists) =>
      exists
        ? (await page.locator(S.DRIVE_ITEM_NAME).allInnerTexts())
            .map((t) => t.trim())
            .filter((t) => t && t !== 'Name')
        : [],
    opts.onStatus,
  );
}

/** Move one file to the recycle bin through its row's own context menu and the page's confirm dialog. */
async function deleteRow(page: Page, name: string): Promise<boolean> {
  const row = driveRow(page, name);
  if (
    !(await row
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false))
  )
    return false;
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: S.DRIVE_DELETE_ITEM, exact: true }).first().click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: S.DRIVE_DELETE_CONFIRM, exact: true });
  if (
    await confirm
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false)
  )
    await confirm.click();
  await row.waitFor({ state: 'detached', timeout: 15_000 });
  return true;
}

/** The names shown in the open OneDrive folder (the header row's "Name" left out). */
async function shownNames(page: Page): Promise<Set<string>> {
  const texts = await page.locator(S.DRIVE_ITEM_NAME).allInnerTexts();
  return new Set(texts.map((t) => t.trim()).filter((t) => t && t !== 'Name'));
}

/**
 * Move these uploads to the OneDrive recycle bin (recoverable there; it still counts toward storage until
 * OneDrive empties it). Names not in the folder are returned as `notFound`, without waiting for them.
 */
export async function removeUploads(
  st: CopilotState,
  names: string[],
  opts: ChatActionOptions = {},
): Promise<{ removed: string[]; notFound: string[] }> {
  const removed: string[] = [];
  const notFound: string[] = [];
  if (names.length === 0) return { removed, notFound };
  await inDriveFolder(
    st,
    uploadsFolder(st),
    async (page, exists) => {
      const shown = exists ? await shownNames(page) : new Set<string>();
      for (const name of names) {
        if (shown.has(name)) opts.onStatus?.(`Moving ${name} to the OneDrive recycle bin…`);
        if (shown.has(name) && (await deleteRow(page, name))) removed.push(name);
        else notFound.push(name);
      }
    },
    opts.onStatus,
  );
  return { removed, notFound };
}

/**
 * Before uploading, move any file of the same name out of Copilot's uploads (to the recycle bin): Copilot's
 * upload never replaces, and OneDrive would keep both and rename the new one ("<name>.zip <number>.docx"), hiding the
 * `.zip` from the model. Whoever uploaded the old copy, the new one takes its name. While the OneDrive
 * address is not known yet (nothing uploaded from this project so far), there is nowhere to look, so the
 * clean-up is skipped and the upload goes ahead; the upload itself makes the address known. Returns the
 * names it moved to the recycle bin.
 */
export async function replacePreviousUploads(
  st: CopilotState,
  files: string[],
  onStatus?: StatusListener,
): Promise<string[]> {
  try {
    const { removed } = await removeUploads(
      st,
      files.map((f) => path.basename(f)),
      onStatus ? { onStatus } : {},
    );
    return removed;
  } catch (error) {
    if (!(error instanceof DriveAddressUnknownError)) throw error;
    onStatus?.('OneDrive address not known yet; skipping the check for earlier uploads…');
    return [];
  }
}
