/**
 * @file Inline Markdown for the terminal (bold, italics, code, links, images as text) and word wrapping
 * that ignores colour codes. Part of the reply renderer in `markdown.ts`.
 * @see {@link ../../../../docs/architecture/cli-ux.md#tui-layout | CLI and TUI: TUI layout}
 * @see {@link ../../../../docs/architecture/overview.md#key-risks | Architecture overview: key risks}
 */
import { styleText } from 'node:util';
import type { Token } from 'marked';
import { columns } from './width.ts';

type Format = Parameters<typeof styleText>[0];

/** Colour only where the terminal shows it (`styleText` checks stdout, NO_COLOR and FORCE_COLOR). */
export const paint = (format: Format, text: string) => (text ? styleText(format, text) : text);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? _);

/**
 * Inline tokens as one styled string. Model output is untrusted: an image is shown as `[image: text]` and
 * never loaded, raw HTML is shown as text, and a link shows its address next to its text.
 */
export function inline(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  return tokens.map(inlineToken).join('');
}

function inlineToken(t: Token): string {
  switch (t.type) {
    case 'strong':
      return paint('bold', inline(t.tokens));
    case 'em':
      return paint('italic', inline(t.tokens));
    case 'del':
      return paint(['dim', 'strikethrough'], inline(t.tokens));
    case 'codespan':
      return paint('yellow', decode(t.text));
    case 'br':
      return '\n';
    case 'link': {
      const text = inline(t.tokens);
      const href = String(t.href ?? '');
      return href && decode(text) !== href
        ? `${paint('blue', text)} ${paint('gray', `(${href})`)}`
        : paint('blue', href);
    }
    case 'image':
      return paint('gray', `[image: ${decode(String(t.text || t.href || ''))}]`);
    case 'checkbox':
      return t.checked ? '[x] ' : '[ ] ';
    case 'text':
      return 'tokens' in t && t.tokens ? inline(t.tokens) : decode(t.text);
    case 'escape':
    case 'html':
      return decode(t.text ?? t.raw);
    default:
      return decode(t.raw);
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: colour codes start with ESC
const ANSI = /\u001b\[[0-9;]*m/g;
/** Columns a string takes on screen, without colour codes (CJK and emoji take two). */
export const visible = (s: string) => columns(s.replace(ANSI, ''));

/**
 * Wrap styled text to `width` columns: the first line starts with `first`, the rest with `rest` (same
 * width), and explicit line breaks are kept. A word longer than the line is left whole.
 */
export function wrap(text: string, width: number, first = '', rest = first): string {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/ +/).filter(Boolean)) {
      const prefix = out.length === 0 ? first : rest;
      if (line && visible(prefix) + visible(line) + 1 + visible(word) > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out.map((l, i) => (i === 0 ? first : rest) + l).join('\n');
}
