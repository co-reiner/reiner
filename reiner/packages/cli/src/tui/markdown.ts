/**
 * @file Renders a model's markdown reply for the terminal, treating it as untrusted. Our own small renderer
 * on `marked`'s lexer: headings, paragraphs, lists, code, quotes, tables and rules. No images, no raw HTML,
 * nothing loaded from disk or the network.
 * @see {@link ../../../../docs/architecture/cli-ux.md#tui-layout | CLI and TUI: TUI layout}
 * @see {@link ../../../../docs/architecture/overview.md#key-risks | Architecture overview: key risks}
 */
import { lexer, type Token, type Tokens } from 'marked';
import { inline, paint, visible, wrap } from './markdown-inline.ts';

/** Render a model's markdown reply for the terminal, wrapped to `width` columns. */
export function renderMarkdown(markdown: string, width = (process.stdout.columns || 100) - 4): string {
  return blocks(lexer(markdown), Math.max(40, width)).replace(/\n+$/, '');
}

/** Block tokens, separated by blank lines (by plain line breaks inside a tight list item). */
function blocks(tokens: Token[], width: number, separator = '\n\n'): string {
  return tokens
    .map((t) => block(t, width))
    .filter((s) => s !== '')
    .join(separator);
}

function block(t: Token, width: number): string {
  switch (t.type) {
    case 'heading':
      return wrap(paint(['bold', 'green'], inline(t.tokens)), width);
    case 'paragraph':
      return wrap(inline(t.tokens), width);
    case 'text':
      return wrap('tokens' in t && t.tokens ? inline(t.tokens) : t.text, width);
    case 'code':
      return codeBlock(t as Tokens.Code);
    case 'blockquote':
      return blocks(t.tokens ?? [], width - 2)
        .split('\n')
        .map((l) => paint('gray', '│ ') + paint('italic', l))
        .join('\n');
    case 'list':
      return list(t as Tokens.List, width);
    case 'table':
      return table(t as Tokens.Table, width);
    case 'hr':
      return paint('gray', '─'.repeat(Math.min(width, 40)));
    case 'space':
    case 'def':
      return '';
    default:
      // Raw HTML and anything unknown: shown as text, never interpreted.
      return wrap(String(t.raw).trim(), width);
  }
}

function codeBlock(t: Tokens.Code): string {
  const label = t.lang ? `${paint('gray', t.lang)}\n` : '';
  return (
    label +
    t.text
      .split('\n')
      .map((l) => paint('yellow', `  ${l}`))
      .join('\n')
  );
}

/** A list: `•` or numbers, nested lists and paragraphs indented under their item. */
function list(t: Tokens.List, width: number): string {
  const start = typeof t.start === 'number' ? t.start : 1;
  const marks = t.items.map((_, i) => (t.ordered ? `${start + i}.` : '•'));
  const pad = Math.max(...marks.map((m) => m.length)) + 1;
  return t.items
    .map((item, i) => {
      // A task item starts with a checkbox token; it goes on the item's first line.
      const [first, ...after] = item.tokens;
      const checkbox = first?.type === 'checkbox';
      const task = checkbox ? (first.checked ? '[x] ' : '[ ] ') : '';
      const inner = checkbox ? after : item.tokens;
      const body = blocks(inner, width - pad, t.loose ? '\n\n' : '\n').split('\n');
      const mark = (marks[i] ?? '').padEnd(pad);
      return body.map((l, j) => (j === 0 ? mark + task + l : ' '.repeat(pad) + l)).join('\n');
    })
    .join(t.loose ? '\n\n' : '\n');
}

/** A table with padded columns, or one `header: value` block per row when it does not fit. */
function table(t: Tokens.Table, width: number): string {
  const head = t.header.map((c) => inline(c.tokens));
  const rows = t.rows.map((r) => r.map((c) => inline(c.tokens)));
  const cols = head.map((h, i) => Math.max(visible(h), ...rows.map((r) => visible(r[i] ?? ''))));
  if (cols.reduce((a, b) => a + b + 3, 1) > width) {
    return rows
      .map((r) =>
        r.map((cell, i) => wrap(`${paint('bold', head[i] ?? '')}: ${cell}`, width, '', '  ')).join('\n'),
      )
      .join('\n\n');
  }
  const line = (cells: string[]) =>
    cells.map((c, i) => c + ' '.repeat((cols[i] ?? 0) - visible(c))).join(paint('gray', ' │ '));
  const rule = paint('gray', cols.map((w) => '─'.repeat(w)).join('─┼─'));
  return [line(head.map((h) => paint('bold', h))), rule, ...rows.map(line)].join('\n');
}
