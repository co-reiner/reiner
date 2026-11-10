/**
 * @file Copilot's chats: new chat, list, open, current, read history, rename and delete (refusing "(Keep)").
 * @see {@link ../../docs/module.md#chat-history | Copilot module: chat history}
 * @see {@link ../../docs/commands.md#yn-questions-and-keep | Copilot's slash commands: y/N questions and (Keep)}
 * @see {@link ../../../../docs/architecture/modules.md#required-and-optional | Harness modules: required and optional}
 */
import type { Page } from '@co-reiner/browser';
import {
  type ChatActionOptions,
  type ChatInfo,
  type HistoryTurn,
  type NewChatResult,
  writeState,
} from '@co-reiner/core';
import { reapplyModel, signedInPage, signedInTab, tab } from './browser.ts';
import { chatLink, chatMenu, forgetChat, knownChats, readChats, rememberChats } from './chat-list.ts';
import { chatModel } from './chat-model.ts';
import { replyHtmlToMarkdown } from './markdown.ts';
import * as S from './selectors.ts';
import { CHECK_TIMEOUT_MS, type CopilotState } from './state.ts';

/** A chat with "(Keep)" in its title is never deleted: the one check for the module and `/delete`. */
export const isKeepChat = (title: string) => /\(keep\)/i.test(title);

/** True when the tab's URL is this chat's (the URL is the truth about which chat is open). */
function onChat(page: Page, id: string): boolean {
  const open = S.chatIdOf(page.url())?.toLowerCase();
  const wanted = id.toLowerCase();
  return open === wanted || open?.startsWith(`${wanted}/`) === true;
}

export async function newChat(st: CopilotState, opts: ChatActionOptions = {}): Promise<NewChatResult> {
  const opened = await tab(st, opts.onStatus);
  opts.onStatus?.('Starting a new chat…');
  const previous = S.chatIdOf(opened.page.url());
  const page = opened.page;
  const input = page.locator(S.CHAT_INPUT.join(', ')).first();
  // Copilot's address opens a new chat too: used when the "New chat" control is not there or did not work.
  const openFresh = async () => {
    await page.goto(st.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await input.waitFor({ timeout: CHECK_TIMEOUT_MS }).catch(() => {});
  };
  /** True once the tab has left the conversation it was on. */
  const left = () => !previous || S.chatIdOf(page.url()) !== previous;
  const link = page.locator(S.NEW_CHAT).first();
  if (await link.isVisible().catch(() => false)) {
    await link.click().catch(() => {});
    await input.waitFor({ timeout: CHECK_TIMEOUT_MS }).catch(() => {});
    // Wait until the tab has left the previous conversation, so currentChat() and send() see the new one.
    if (previous) {
      await page.waitForURL((u) => !u.toString().includes(previous), { timeout: 10_000 }).catch(() => {});
    }
  } else await openFresh();
  if (!left()) await openFresh();
  // Never report a new chat that is not there: the next prompt would go into the old conversation.
  if (!left()) {
    throw new Error(
      'Copilot did not start a new chat: the tab is still on the earlier conversation. Try /new again.',
    );
  }
  // A new chat resets the model: select the project's saved one now, and say so if it is not offered.
  st.keepChatModel = false;
  st.modelDirty = true;
  const notes: string[] = [];
  const appliedModel = await reapplyModel(st, opened.page, notes, opts.onStatus);
  return { notes, ...(appliedModel ? { appliedModel } : {}) };
}

export async function listChats(st: CopilotState, opts: ChatActionOptions = {}): Promise<ChatInfo[]> {
  const page = await signedInPage(st, [], opts.onStatus);
  opts.onStatus?.('Reading the chat list…');
  // Which chat is open comes from the tab's URL, not from the sidebar's mark, which can lag behind a switch.
  const open = S.chatIdOf(page.url());
  const list = (await readChats(st, page)).map(({ current: _mark, ...chat }) =>
    chat.id === open ? { ...chat, current: true } : chat,
  );
  // The list as shown to the user, in Copilot's order: /chat and /delete numbers and suggestions use it.
  await writeState(st.ctx.stateDir, 'recent-chats', list);
  return list;
}

export async function currentChat(
  st: CopilotState,
  opts: ChatActionOptions = {},
): Promise<ChatInfo | undefined> {
  // The URL is the truth: a new chat has no conversation id until its first message is sent.
  // The sidebar's "current" mark can lag behind a switch.
  const opened = await tab(st, opts.onStatus);
  const id = S.chatIdOf(opened.page.url());
  if (!id) return undefined;
  const known = [...(await readChats(st, opened.page)), ...(await knownChats(st))].find((c) => c.id === id);
  return { id, title: known?.title ?? '', current: true };
}

export async function openChat(
  st: CopilotState,
  id: string,
  opts: ChatActionOptions = {},
): Promise<ChatInfo> {
  // No model is applied before switching: the chat keeps the model it shows once loaded.
  const page = await signedInTab(st, opts.onStatus);
  const known = [...(await readChats(st, page)), ...(await knownChats(st))].find((c) => c.id === id);
  opts.onStatus?.(`Opening chat "${known?.title || id}"…`);
  const link = chatLink(page, id);
  if (await link.isVisible().catch(() => false)) {
    await link.click();
  } else {
    // Not in the recent list: open its link, as a person would from a bookmark.
    await page.goto(new URL(S.chatPathOf(id), st.url).toString(), {
      waitUntil: 'domcontentloaded',
    });
  }
  await page.waitForURL((u) => u.toString().includes(id), { timeout: 30_000 }).catch(() => {});
  const notOpened = `Copilot did not open the chat "${known?.title || id}". It may have been deleted.`;
  if (!onChat(page, id)) throw new Error(notOpened);
  // Long chats load slowly. Wait until the conversation shows at least one message.
  opts.onStatus?.('Waiting for the chat to load…');
  await page
    .locator(`${S.QUESTION}, ${S.REPLY}`)
    .first()
    .waitFor({ state: 'attached', timeout: 90_000 })
    .catch(() => {});
  await page
    .locator(S.CHAT_INPUT.join(', '))
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {});
  // Copilot can leave a chat it could not load: only a tab still on this chat counts, and keeps its model.
  if (!onChat(page, id)) throw new Error(notOpened);
  return { id, title: known?.title ?? '', current: true, ...(await chatModel(st, page, opts.onStatus)) };
}

type HistoryNode = { kind: 'prompt' | 'reply'; value: string };

// Prompts and replies in page order. A turn's answer is the last non-empty reply after its prompt
// (thinking models leave an empty placeholder reply first).
function readHistoryNodes(page: Page): Promise<HistoryNode[]> {
  return page
    .evaluate(
      ({ question, reply }) =>
        [...document.querySelectorAll(`${question}, ${reply}`)].map((el) =>
          el.matches(question)
            ? { kind: 'prompt' as const, value: (el as HTMLElement).innerText }
            : { kind: 'reply' as const, value: el.innerHTML },
        ),
      { question: S.QUESTION, reply: S.REPLY },
    )
    .catch(() => [] as HistoryNode[]);
}

function toTurns(nodes: HistoryNode[]): { prompt: string; replyHtml: string }[] {
  const turns: { prompt: string; replyHtml: string }[] = [];
  for (const node of nodes) {
    if (node.kind === 'prompt') {
      // Copilot prefixes each prompt with a screen-reader label, "You said:".
      turns.push({ prompt: node.value.replace(/^\s*You said:\s*/i, '').trim(), replyHtml: '' });
    } else if (turns.length > 0 && node.value.trim()) {
      const last = turns[turns.length - 1];
      if (last) last.replyHtml = node.value;
    }
  }
  return turns;
}

export async function readHistory(
  st: CopilotState,
  opts: ChatActionOptions & { turns?: number } = {},
): Promise<HistoryTurn[]> {
  // Signed in or an error: a sign-in page has no messages, and that must not read as an empty chat.
  const page = await signedInTab(st, opts.onStatus);
  opts.onStatus?.('Reading the chat history…');
  // After a chat is opened, Copilot fills in older replies a moment after the prompts. Read until the
  // replies stop changing (two reads in a row agree), for at most 10 seconds.
  let turns = toTurns(await readHistoryNodes(page));
  let previous = '';
  for (const deadline = Date.now() + 10_000; Date.now() < deadline; ) {
    const signature = turns.map((t) => `${t.prompt.length}:${t.replyHtml.length}`).join(',');
    if (signature === previous && turns.every((t) => t.replyHtml)) break;
    if (signature === previous && Date.now() > deadline - 7000) break;
    previous = signature;
    await page.waitForTimeout(700).catch(() => {});
    turns = toTurns(await readHistoryNodes(page));
  }
  return turns.slice(-Math.max(1, opts.turns ?? 3)).map((t) => ({
    prompt: t.prompt,
    reply: t.replyHtml ? replyHtmlToMarkdown(t.replyHtml) : '',
  }));
}

export async function renameChat(
  st: CopilotState,
  title: string,
  opts: ChatActionOptions & { id?: string } = {},
): Promise<ChatInfo> {
  const page = await signedInPage(st, [], opts.onStatus);
  const id = opts.id ?? S.chatIdOf(page.url());
  if (!id)
    throw new Error('This chat has no messages yet, so Copilot has not saved it. Send a prompt first.');
  opts.onStatus?.(`Renaming the chat to "${title}"…`);
  await chatMenu(st, page, id, 'Rename');
  const input = page.locator(S.CHAT_RENAME_INPUT).first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(title);
  await page.keyboard.press('Enter');
  const renamed = await page
    .waitForFunction(
      ({ selector, title }) => document.querySelector(selector)?.getAttribute('aria-label') === title,
      { selector: S.chatLinkSelector(id), title },
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!renamed) throw new Error('Copilot did not show the new name. The rename may not have been saved.');
  await rememberChats(st, [{ id, title }]);
  return { id, title, current: S.chatIdOf(page.url()) === id };
}

export async function deleteChat(st: CopilotState, id: string, opts: ChatActionOptions = {}): Promise<void> {
  const page = await signedInPage(st, [], opts.onStatus);
  const chat = (await readChats(st, page)).find((c) => c.id === id);
  if (!chat) throw new Error("That chat is not in Copilot's recent list, so it cannot be deleted from here.");
  if (isKeepChat(chat.title)) {
    throw new Error(`"${chat.title}" is marked (Keep). Rename it first if you really want to delete it.`);
  }
  opts.onStatus?.(`Deleting "${chat.title}"…`);
  await chatMenu(st, page, id, 'Delete');
  // Copilot's own confirmation: a "Delete" button next to "Cancel".
  const confirm = page
    .locator('button')
    .filter({ hasText: /^Delete$/ })
    .last();
  await confirm.waitFor({ state: 'visible', timeout: 5000 });
  await confirm.click();
  const gone = await chatLink(page, id)
    .waitFor({ state: 'detached', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!gone) throw new Error('Copilot still lists the chat. It may not have been deleted.');
  await forgetChat(st, id);
}
