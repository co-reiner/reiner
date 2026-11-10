/**
 * @file Tests rendering markdown replies for the terminal.
 * @see {@link ../../../docs/architecture/cli-ux.md#tui-layout | CLI and TUI: TUI layout}
 * @see {@link ../../../docs/architecture/overview.md#key-risks | Architecture overview: key risks}
 */
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/tui/markdown.ts';
import { columns, graphemes } from '../src/tui/width.ts';

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI colour codes
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

describe('renderMarkdown', () => {
  it('renders headings, lists and code for the terminal', () => {
    const out = plain(renderMarkdown('# Title\n\n- one\n- two\n\n```python\nif x:\n    print(1)\n```', 80));
    expect(out).toContain('Title');
    expect(out).toMatch(/one/);
    expect(out).toContain('    print(1)');
  });

  it('never loads images, and shows raw HTML as text', () => {
    expect(plain(renderMarkdown('![secret](/etc/passwd)', 80))).toContain('[image: secret]');
    expect(plain(renderMarkdown('<script>alert(1)</script>', 80))).toContain('<script>alert(1)</script>');
  });

  it('shows a link with its address, and wraps paragraphs to the width', () => {
    expect(plain(renderMarkdown('see [docs](https://example.com/x)', 80))).toBe(
      'see docs (https://example.com/x)',
    );
    const lines = plain(renderMarkdown('word '.repeat(40), 40)).split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(40);
  });

  it('indents nested lists and puts task boxes on the item line', () => {
    const out = plain(renderMarkdown('- one\n  - nested\n- [x] done\n\n1. first\n2. second', 80));
    expect(out).toContain('• one\n  • nested');
    expect(out).toContain('• [x] done');
    expect(out).toContain('1. first\n2. second');
  });

  it('counts columns as the terminal shows them: CJK and emoji two, accents none', () => {
    const cp = (...points: number[]) => String.fromCodePoint(...points);
    expect(columns('abc')).toBe(3);
    expect(columns(cp(0x65e5, 0x672c))).toBe(4); // two CJK characters
    expect(columns(cp(0x1f600))).toBe(2); // one emoji
    expect(columns(`e${cp(0x301)}`)).toBe(1); // e with a combining accent
    // A family emoji: four people joined by zero-width joiners is one character, two columns.
    const family = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map((p) => cp(p)).join('');
    expect(graphemes(family)).toHaveLength(1);
    expect(columns(family)).toBe(2);
  });

  it('pads table columns, and lists rows when the table is too wide', () => {
    const md = '| Name | Value |\n| --- | --- |\n| a | 1 |\n| b &amp; c | 22 |';
    expect(plain(renderMarkdown(md, 80))).toContain('b & c │ 22');
    const wide = `| A | B |\n| --- | --- |\n| ${'x'.repeat(30)} | ${'y'.repeat(30)} |`;
    expect(plain(renderMarkdown(wide, 40))).toContain(`A: ${'x'.repeat(30)}`);
  });
});
