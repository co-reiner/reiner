/**
 * @file Converting a rendered AI mode reply's HTML to markdown in Node.
 * @see {@link ../../docs/module.md#sending-and-reading | The Google Search module: sending and reading}
 * @see {@link ../../../../docs/architecture/modules.md#reading-replies | Harness modules: reading replies}
 */
import domino from '@mixmark-io/domino';
import TurndownService from 'turndown';
import * as S from './selectors.ts';

/**
 * Turn the HTML of a rendered reply back into markdown. Runs in Node on the reply's innerHTML, so nothing
 * extra runs in the page.
 *
 * The page draws headings as divs with a heading role, and puts source chips and buttons inside the text:
 * headings become real ones, the furniture is dropped. A code block is a widget (language label, code,
 * caution line, copy button): each becomes one plain `<pre><code>`, where turndown keeps whitespace.
 */
export function replyHtmlToMarkdown(html: string): string {
  const doc = domino.createDocument(`<!doctype html><html><body><div id="reply">${html}</div></body></html>`);
  const root = doc.getElementById('reply');
  if (!root) return '';

  for (const block of all(root, S.CODE_BLOCK)) {
    const pre = block.querySelector('pre');
    // Widgets nest (a container in a container): only the outermost one that still holds its code counts.
    if (!pre || !block.parentNode) continue;
    const code = doc.createElement('code');
    const language = languageOf(block);
    if (language) code.setAttribute('class', `language-${language}`);
    code.textContent = (pre.textContent ?? '').split(String.fromCharCode(160)).join(' ').replace(/\n$/, '');
    const plain = doc.createElement('pre');
    plain.appendChild(code);
    block.parentNode.replaceChild(plain, block);
  }
  for (const el of all(root, S.REPLY_NOISE)) el.remove();
  for (const el of all(root, S.REPLY_HEADING)) {
    const level = Math.min(6, Math.max(1, Number(el.getAttribute('aria-level')) || 3));
    const heading = doc.createElement(`h${level}`);
    heading.textContent = el.textContent ?? '';
    el.parentNode?.replaceChild(heading, el);
  }
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  return td
    .turndown(root as unknown as HTMLElement)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Matches as an array. Domino answers a bare tag selector with a list that cannot be spread. */
const all = (root: Element, selector: string): Element[] =>
  Array.prototype.slice.call(root.querySelectorAll(selector)) as Element[];

/** The language a code block names: its first small div, when that holds one word. */
function languageOf(block: Element): string {
  const label = all(block, 'div').find((d) => d.children.length === 0);
  const text = (label?.textContent ?? '').trim().toLowerCase();
  return /^[\w+#.-]{1,20}$/.test(text) ? text : '';
}
