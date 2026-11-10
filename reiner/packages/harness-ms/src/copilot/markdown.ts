/**
 * @file Converting a rendered Copilot reply's HTML to markdown in Node, keeping code block indentation.
 * @see {@link ../../docs/module.md#sending-and-reading | Copilot module: sending and reading}
 * @see {@link ../../../../docs/architecture/modules.md#reading-replies | Harness modules: reading replies}
 * @see {@link ../../../../AGENTS.md#browser-gotchas | AGENTS.md: browser gotchas}
 */
import domino from '@mixmark-io/domino';
import TurndownService from 'turndown';
import * as S from './selectors.ts';

/**
 * Turn the HTML of a rendered Copilot reply back into markdown. Runs in Node on the reply's innerHTML,
 * so nothing extra runs in the page.
 *
 * Copilot's code blocks are rich widgets (header, copy button, one div per line). Turndown collapses
 * whitespace before its rules run, which would lose indentation, so each widget is first replaced by a
 * plain <pre><code> block, where turndown keeps whitespace as it is.
 */
export function replyHtmlToMarkdown(html: string): string {
  const doc = domino.createDocument(`<!doctype html><html><body><div id="reply">${html}</div></body></html>`);
  const root = doc.getElementById('reply');
  if (!root) return '';

  for (const block of [...root.querySelectorAll(S.CODE_BLOCK)]) {
    const language = (block.querySelector(S.CODE_LANGUAGE)?.textContent ?? '').trim().toLowerCase();
    const lines = [...block.querySelectorAll(S.CODE_LINE)]
      .sort((a, b) => Number(a.getAttribute('data-line-index')) - Number(b.getAttribute('data-line-index')))
      .map((line) => (line.textContent ?? '').replace(/ /g, ' '));
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    if (language) code.setAttribute('class', `language-${language}`);
    code.textContent = lines.join('\n');
    pre.appendChild(code);
    block.parentNode?.replaceChild(pre, block);
  }
  // Icons, buttons and screen-reader-only live regions are not part of the answer.
  for (const el of [...root.querySelectorAll('svg, button, style, script, [aria-live]')]) el.remove();

  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  return collapseBlankLines(td.turndown(root as unknown as HTMLElement)).trim();
}

/**
 * Collapse runs of blank lines to one, outside fenced code blocks only: inside a fence every line is the
 * model's text (a diff, a file), so its blank lines stay as they are.
 */
function collapseBlankLines(markdown: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.split('\n')) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === undefined) {
      if (mark) fence = mark;
      else if (line === '' && out[out.length - 1] === '') continue;
    } else if (mark && mark[0] === fence[0] && mark.length >= fence.length && line.trim() === mark) {
      fence = undefined;
    }
    out.push(line);
  }
  return out.join('\n');
}
