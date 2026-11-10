/**
 * @file Copilot's history sidebar: reading the chat links, the chats seen before, and each chat's "More" menu.
 * @see {@link ../../docs/module.md#chat-history | Copilot module: chat history}
 */
import type { Page } from '@co-reiner/browser';
import { type ChatInfo, readState, writeState } from '@co-reiner/core';
import * as S from './selectors.ts';
import type { CopilotState, Locator } from './state.ts';

/** Chats seen before, so a chat that has dropped off Copilot's recent list can still be opened by id. */
export async function knownChats(st: CopilotState): Promise<ChatInfo[]> {
  return (await readState<ChatInfo[]>(st.ctx.stateDir, 'chats')) ?? [];
}

export async function rememberChats(st: CopilotState, chats: ChatInfo[]): Promise<void> {
  const merged = new Map((await knownChats(st)).map((c) => [c.id, { id: c.id, title: c.title }]));
  for (const c of chats) merged.set(c.id, { id: c.id, title: c.title });
  await writeState(st.ctx.stateDir, 'chats', [...merged.values()].slice(-500));
}

export async function forgetChat(st: CopilotState, id: string): Promise<void> {
  await writeState(
    st.ctx.stateDir,
    'chats',
    (await knownChats(st)).filter((c) => c.id !== id),
  );
}

/**
 * Read the history sidebar, opening it first if it has been collapsed. Every chat read is remembered in
 * `chats`; the numbered `recent-chats` list is saved only by `listChats`, when the list is shown to the user.
 */
export async function readChats(st: CopilotState, page: Page): Promise<ChatInfo[]> {
  const links = page.locator(S.CHAT_LINK);
  if (
    !(await links
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    const toggle = page.locator(S.SIDEBAR_TOGGLE).first();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click().catch(() => {});
      await page.waitForTimeout(600).catch(() => {});
    }
  }
  const raw = await links
    .evaluateAll((els) =>
      els.map((e) => ({
        href: e.getAttribute('href') ?? '',
        linkId: e.getAttribute('id'),
        title: e.getAttribute('aria-label') ?? (e.textContent ?? '').trim(),
        current: e.getAttribute('aria-current') === 'true' || e.getAttribute('aria-current') === 'page',
      })),
    )
    .catch(() => []);
  const chats = new Map<string, ChatInfo>();
  for (const r of raw) {
    const id = S.chatIdOf(r.href, r.linkId);
    if (id && !chats.has(id)) {
      chats.set(id, {
        id,
        title: r.title,
        ...(id.startsWith('agent/') ? { agent: true } : {}),
        ...(r.current ? { current: true } : {}),
      });
    }
  }
  const list = [...chats.values()];
  await rememberChats(st, list);
  return list;
}

/** A chat's link in the history sidebar. */
export function chatLink(page: Page, id: string): Locator {
  return page.locator(S.chatLinkSelector(id)).first();
}

/** Open a chat's "More" menu in the sidebar and click one of its items (Rename, Delete, …). */
export async function chatMenu(st: CopilotState, page: Page, id: string, item: string): Promise<void> {
  await readChats(st, page);
  const link = chatLink(page, id);
  if (!(await link.isVisible().catch(() => false))) {
    throw new Error("That chat is not in Copilot's recent list. Open it first with /chat.");
  }
  await link.hover();
  await page.waitForTimeout(300).catch(() => {});
  await link.locator('xpath=..').locator(S.CHAT_MORE).first().click();
  const entry = page.locator(S.CHAT_MENU_ITEM).filter({ hasText: item }).first();
  await entry.waitFor({ state: 'visible', timeout: 5000 });
  await entry.click();
}
