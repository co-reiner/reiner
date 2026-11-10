/**
 * @file Tests for converting a captured Copilot reply, with its code block widgets, to markdown.
 * @see {@link ../docs/module.md#sending-and-reading | Copilot module: sending and reading}
 * @see {@link ../../../docs/architecture/modules.md#reading-replies | Harness modules: reading replies}
 */
import { describe, expect, it } from 'vitest';
import { replyHtmlToMarkdown } from '../src/copilot/markdown.ts';

// Shape of a real reply captured from Copilot (icons and class names trimmed).
const REPLY = `<div><h1>Heading</h1>
<ul><li>Item 1</li><li>Item 2</li></ul>
<div><div id="code-block-host-x" role="group" aria-label="Code Preview" tabindex="-1"><div><div role="presentation">
<div aria-live="assertive"></div><div role="status" aria-live="polite">Copied</div>
<div data-testid="one-copilot-code-identity"><svg></svg><span>Python</span></div>
<button type="button" aria-label="Copy code"><span><svg></svg></span></button>
<button type="button" aria-label="More options"></button>
<div tabindex="0" role="textbox" aria-label="Code editor">
<div data-line-number="1"></div><div data-line-index="0">def hi():</div>
<div data-line-number="2"></div><div data-line-index="1">    print("hello")</div>
</div></div></div></div></div>
<p>Done with <strong>bold</strong> and <code>inline</code>.</p></div>`;

describe('replyHtmlToMarkdown', () => {
  it('rebuilds headings, lists, code fences and inline formatting', () => {
    expect(replyHtmlToMarkdown(REPLY)).toBe(
      [
        '# Heading',
        '',
        '-   Item 1',
        '-   Item 2',
        '',
        '```python',
        'def hi():',
        '    print("hello")',
        '```',
        '',
        'Done with **bold** and `inline`.',
      ].join('\n'),
    );
  });

  it('keeps consecutive blank lines inside a code block, and collapses them outside', () => {
    const html = `<div><p>Before</p><p></p><p></p>
<div role="group" aria-label="Code Preview"><div data-testid="one-copilot-code-identity"><span>Diff</span></div>
<div data-line-index="0">first</div><div data-line-index="1"></div><div data-line-index="2"></div>
<div data-line-index="3"></div><div data-line-index="4">last</div></div>
<p>After</p></div>`;
    const markdown = replyHtmlToMarkdown(html);
    expect(markdown).toContain(['```diff', 'first', '', '', '', 'last', '```'].join('\n'));
    expect(markdown.replace(/```[\s\S]*?```/, 'CODE')).not.toMatch(/\n{3,}/);
    expect(markdown.startsWith('Before')).toBe(true);
    expect(markdown.endsWith('After')).toBe(true);
  });

  it('keeps plain paragraphs as they are', () => {
    expect(replyHtmlToMarkdown('<div><p>pong</p></div>')).toBe('pong');
  });
});
