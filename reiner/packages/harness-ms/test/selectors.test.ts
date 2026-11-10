/**
 * @file Tests for reading Copilot chat ids (plain and agent chats), building their paths and link selectors,
 * and the selector for a reply's file card.
 * @see {@link ../docs/module.md#chat-history | Copilot module: chat history}
 */
import { describe, expect, it } from 'vitest';
import { chatIdOf, chatLinkSelector, chatPathOf, fileCardNamed } from '../src/copilot/selectors.ts';

const AGENT = 'P_c0fd1ab0.8ad61c39';
const CONV = '072cc88c-934d-43b7-8cb7-db44e3000000';

describe('chat ids', () => {
  it('reads plain chat ids from URLs and hrefs', () => {
    expect(chatIdOf('https://m365.cloud.microsoft/chat/conversation/986a97a3-1111-2222')).toBe(
      '986a97a3-1111-2222',
    );
    expect(chatIdOf('https://m365.cloud.microsoft/chat')).toBeUndefined();
  });

  it('reads agent chat ids from the page URL, or from the sidebar href plus the link id', () => {
    const id = `agent/${AGENT}/conversation/${CONV}`;
    expect(chatIdOf(`https://m365.cloud.microsoft/chat/agent/${AGENT}/conversation/${CONV}`)).toBe(id);
    expect(chatIdOf(`/chat/agent/${AGENT}`, CONV)).toBe(id);
  });

  it('builds the path and the exact link selector for each kind', () => {
    expect(chatPathOf('986a97a3')).toBe('/chat/conversation/986a97a3');
    expect(chatPathOf(`agent/${AGENT}/conversation/${CONV}`)).toBe(
      `/chat/agent/${AGENT}/conversation/${CONV}`,
    );
    expect(chatLinkSelector('986a97a3')).toBe('a[href*="/chat/conversation/986a97a3"]');
    expect(chatLinkSelector(`agent/${AGENT}/conversation/${CONV}`)).toBe(
      `a[href*="/chat/agent/"][id="${CONV}"]`,
    );
  });
});

describe('file cards', () => {
  it('finds a card by its exact file name, with quotes escaped', () => {
    expect(fileCardNamed('app.patch.001.zip 3.docx')).toBe(
      '.fai-EntityCard:has(.fai-EntityTitle__primaryText [title="app.patch.001.zip 3.docx"])',
    );
    expect(fileCardNamed('a"b.docx')).toContain('[title="a\\"b.docx"]');
  });
});
