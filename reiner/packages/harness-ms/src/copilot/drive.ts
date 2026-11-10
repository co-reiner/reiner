/**
 * @file OneDrive through its own web page: the user's address, the created folder, fetching files, and
 * `prepareTransfer`.
 * @see {@link ../../docs/file-exchange.md#onedrive | Copilot file exchange: OneDrive}
 * @see {@link ../../docs/file-exchange.md#missing-folders | Copilot file exchange: missing folders}
 * @see {@link ../../docs/file-exchange.md#reply-modes | Copilot file exchange: reply modes}
 * @see {@link ../../../exchange-packs/docs/packs.md#why-it-works-this-way | File exchange: why it works this way}
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@co-reiner/browser';
import {
  type ChatActionOptions,
  type ChatReply,
  readState,
  type SendOptions,
  type StatusListener,
  writeState,
} from '@co-reiner/core';
import { signedInPage } from './browser.ts';
import * as S from './selectors.ts';
import { type CopilotState, hostOf } from './state.ts';

/** What fetching files from the created folder brought back. */
export interface FetchResult {
  /** Saved local paths. */
  files: string[];
  /** Names that were not found. */
  notFound: string[];
  /** The folder does not exist (yet). */
  missing: boolean;
}

/** The user's OneDrive address is not known yet: no setting, no link on the Copilot page, none saved. */
export class DriveAddressUnknownError extends Error {
  constructor() {
    super(
      'Could not find your OneDrive address yet. Send a pack first (uploads link to OneDrive), or set "oneDriveUrl" in the harness settings.',
    );
    this.name = 'DriveAddressUnknownError';
  }
}

/**
 * The user's OneDrive site, e.g. https://contoso-my.sharepoint.com/personal/user_contoso_com. Read from
 * links in the Copilot page (uploaded files link to it), then remembered. A `oneDriveUrl` setting wins.
 */
async function driveSite(st: CopilotState, page: Page): Promise<string | undefined> {
  if (typeof st.ctx.settings.oneDriveUrl === 'string') return st.ctx.settings.oneDriveUrl.replace(/\/+$/, '');
  const fromPage = await page
    .evaluate(() => {
      for (const a of document.querySelectorAll('a[href*="-my.sharepoint.com/personal/"]')) {
        const m = /^(https:\/\/[^/]+-my\.sharepoint\.com\/personal\/[^/?#]+)/.exec(
          a.getAttribute('href') ?? '',
        );
        if (m) return m[1];
      }
      return undefined;
    })
    .catch(() => undefined);
  if (fromPage) {
    await writeState(st.ctx.stateDir, 'drive', { site: fromPage });
    return fromPage;
  }
  return (await readState<{ site: string }>(st.ctx.stateDir, 'drive'))?.site;
}

export const createdFolder = (st: CopilotState) =>
  (typeof st.ctx.settings.createdFolder === 'string'
    ? st.ctx.settings.createdFolder
    : S.DRIVE_CREATED_FOLDER
  ).replace(/^\/+|\/+$/g, '');

/**
 * Open a OneDrive folder in a tab of its own next to the chat, run `fn` there, then close that tab. The
 * chat tab is never navigated away, so its chat, model and scroll stay as they were. Uses the drive's own
 * page (we puppet, never call Graph). A missing folder shows no column header row; a tab that ended up off
 * the OneDrive site (a sign-in or error page) is an error, not a missing folder.
 */
export async function inDriveFolder<T>(
  st: CopilotState,
  folder: string,
  fn: (page: Page, exists: boolean) => Promise<T>,
  onStatus?: StatusListener,
): Promise<T> {
  const chat = await signedInPage(st, [], onStatus);
  const site = await driveSite(st, chat);
  if (!site) throw new DriveAddressUnknownError();
  const sitePath = new URL(site).pathname;
  onStatus?.(`Opening OneDrive in its own tab: ${folder}…`);
  const page = await chat.context().newPage();
  try {
    await page.goto(
      `${site}/_layouts/15/onedrive.aspx?id=${encodeURIComponent(`${sitePath}/${S.DRIVE_LIBRARY}/${folder}`)}`,
      { waitUntil: 'domcontentloaded' },
    );
    const exists = await page
      .getByRole('row')
      .first()
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    const host = hostOf(page.url());
    if (!exists && host !== new URL(site).host) {
      throw new Error(
        `OneDrive did not open the folder ${folder}: the tab ended on ${host || 'another page'}. Check that you are signed in to OneDrive in the browser window, or the "oneDriveUrl" setting.`,
      );
    }
    // Rows fill in a while after the header. Wait for a name cell, or give up quietly for an empty folder.
    if (exists)
      await page
        .locator(S.DRIVE_ITEM_NAME)
        .first()
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    return await fn(page, exists);
  } finally {
    await page.close().catch(() => {});
    await chat.bringToFront().catch(() => {});
  }
}

async function listDriveFolder(
  st: CopilotState,
  folder: string,
  onStatus?: StatusListener,
): Promise<string[] | undefined> {
  return inDriveFolder(
    st,
    folder,
    async (page, exists) =>
      exists
        ? (await page.locator(S.DRIVE_ITEM_NAME).allInnerTexts())
            .map((t) => t.trim())
            .filter((t) => t && t !== 'Name')
        : undefined,
    onStatus,
  );
}

/** The row of a OneDrive folder list with exactly this name ("x.zip.docx" never matches "ax.zip.docx"). */
export function driveRow(page: Page, name: string) {
  return (
    page
      .getByRole('row')
      // The exact name: "x.zip.docx" must not match "ax.zip.docx" or a renamed duplicate, "<name>.zip <number>.docx".
      .filter({
        has: page.locator(S.DRIVE_ITEM_NAME, {
          hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`),
        }),
      })
      .first()
  );
}

/** Download each named file from the open OneDrive folder; names that are not shown go in `notFound`. */
async function downloadDriveFiles(
  page: Page,
  names: string[],
  dir: string,
  onStatus?: StatusListener,
): Promise<FetchResult> {
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  const notFound: string[] = [];
  for (const name of names) {
    const row = driveRow(page, name);
    const shown = await row
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!shown) {
      notFound.push(name);
      continue;
    }
    onStatus?.(`Downloading ${name} from OneDrive…`);
    await row.click({ button: 'right' });
    const download = page.waitForEvent('download', { timeout: 60_000 });
    // Handled here, so a failed click cannot leave the wait rejecting unhandled; the await below rethrows.
    download.catch(() => {});
    await page.getByRole('menuitem', { name: 'Download' }).first().click();
    const d = await download;
    const file = path.join(dir, path.basename(d.suggestedFilename() || name));
    await d.saveAs(file);
    files.push(file);
    await page.keyboard.press('Escape').catch(() => {});
  }
  return { files, notFound, missing: false };
}

export async function fetchCreatedFiles(
  st: CopilotState,
  names: string[],
  dir: string,
  opts: ChatActionOptions = {},
): Promise<FetchResult> {
  return inDriveFolder(
    st,
    createdFolder(st),
    async (page, exists) => {
      if (!exists) return { files: [], notFound: names, missing: true };
      return downloadDriveFiles(page, names, dir, opts.onStatus);
    },
    opts.onStatus,
  );
}

export async function prepareTransfer(
  st: CopilotState,
  mode: string,
  opts: ChatActionOptions,
  send: (prompt: string, opts?: SendOptions) => Promise<ChatReply>,
): Promise<{ ready: boolean; notes: string[]; existing?: string[] }> {
  if (mode !== 'onedrive') return { ready: true, notes: [] };
  const folder = createdFolder(st);
  const existing = await listDriveFolder(st, folder, opts.onStatus);
  if (existing) return { ready: true, notes: [`OneDrive folder found: ${folder}`], existing };
  // Copilot creates its OneDrive folders the first time it saves a file. Ask it for a tiny document,
  // then look again. Reiner never creates the folders itself.
  opts.onStatus?.(
    `OneDrive folder ${folder} is missing; asking Copilot to create a document so it sets it up…`,
  );
  await send(S.PROVISION_PROMPT, opts.onStatus ? { onStatus: opts.onStatus } : {});
  for (let i = 0; i < 3; i++) {
    const created = await listDriveFolder(st, folder, opts.onStatus);
    if (created)
      return { ready: true, notes: [`Copilot created the OneDrive folder ${folder}.`], existing: created };
    await new Promise((r) => setTimeout(r, 5000));
  }
  return {
    ready: false,
    notes: [
      `OneDrive folder ${folder} is still missing after asking Copilot for a document.`,
      'Ask Copilot to create any Word document, or set "createdFolder" in the harness settings if it saves elsewhere.',
    ],
  };
}
