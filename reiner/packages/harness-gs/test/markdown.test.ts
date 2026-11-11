/**
 * @file Tests for converting an AI mode reply, with its code block widget and page furniture, to markdown.
 * @see {@link ../docs/module.md#sending-and-reading | The Google Search module: sending and reading}
 */
import { describe, expect, it } from 'vitest';
import { replyHtmlToMarkdown } from '../src/gs/markdown.ts';

// The shape of a reply as the page draws it (class names shortened): text, a heading div, a code block
// widget, then the row of buttons and the follow-up suggestions.
const REPLY = `
<div data-container-id="5">
  <div class="n6owBd">You can <strong>trim</strong> it.<span class="notranslate"><span>source chip</span></span></div>
  <div class="ZLzG0d" role="heading" aria-level="4">The change</div>
  <div class="BpxUDf aiModeUiCodeBlock__Container"><div><div class="rq1a2">
    <div class="a2TNg"><div class="GlO4G">javascript</div></div>
    <div class="PGvq2d"><pre><code><span>export function</span><span> slug(t) {
  return t.trim();
}
</span></code></pre></div></div>
    <div class="iMHp6c"><div class="ZIumpf">Use code with caution.</div>
      <button aria-label="Copy code text to clipboard."></button><div>Copy code text to clipboard.</div></div>
  </div></div>
  <div data-xid="Gd7Hsc"><div role="status" aria-live="polite">Copied</div><div>Good response</div></div>
  <div data-subtree="aimba"><div>Ask a follow-up</div></div>
  <img src="data:image/png;base64,AAAA">
</div>`;

describe('replyHtmlToMarkdown', () => {
  const markdown = replyHtmlToMarkdown(REPLY);

  it('turns a code block widget into a fenced block with its language and indentation', () => {
    expect(markdown).toContain('```javascript\nexport function slug(t) {\n  return t.trim();\n}\n```');
  });

  it('keeps text and turns heading divs into headings', () => {
    expect(markdown).toContain('You can **trim** it.');
    expect(markdown).toContain('#### The change');
  });

  it('drops the page furniture', () => {
    for (const gone of ['source chip', 'Use code with caution', 'Copy code', 'Good response', 'follow-up']) {
      expect(markdown).not.toContain(gone);
    }
    expect(markdown).not.toContain('data:image');
  });

  it('gives nothing for an empty reply', () => {
    expect(replyHtmlToMarkdown('')).toBe('');
  });
});
