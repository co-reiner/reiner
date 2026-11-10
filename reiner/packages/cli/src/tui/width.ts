/**
 * @file Text as the terminal shows it: the characters a person sees (a flag or a family emoji is one, though
 * it is several code points) and how many columns they take (CJK and emoji take two, accents none).
 * @see {@link ../../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 * @see {@link ../../../../docs/architecture/cli-ux.md#tui-layout | CLI and TUI: TUI layout}
 */

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The text split into the characters a person sees, so a cursor never lands inside one. */
export const graphemes = (text: string): string[] => [...segmenter.segment(text)].map((s) => s.segment);

/** A range for a regular expression's character class, written from code points so the source stays readable. */
const range = ([from, to]: readonly [number, number]) =>
  `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;

/** East Asian wide and full-width characters, and the emoji blocks: two columns each. */
const WIDE_RANGES = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, punctuation
  [0x3041, 0xa4cf], // Hiragana to Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // Full-width forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff], // Emoji
  [0x20000, 0x3fffd], // CJK extensions
] as const;
const WIDE = new RegExp(`[${WIDE_RANGES.map(range).join('')}]`, 'u');

/** The variation selector that asks for the emoji form of the character before it. */
const EMOJI_SELECTOR = String.fromCodePoint(0xfe0f);
/** Shown as an emoji by default. */
const EMOJI = /\p{Emoji_Presentation}/u;

/** Nothing on its own: zero-width characters and variation selectors (combining marks are tested apart). */
const INVISIBLE = new RegExp(`[${range([0x200b, 0x200d])}${range([0xfe00, 0xfe0f])}]`, 'gu');
const MARKS = /\p{M}/gu;

/** The columns one visible character takes. */
function width(grapheme: string): number {
  if (grapheme.replace(MARKS, '').replace(INVISIBLE, '') === '') return 0;
  return WIDE.test(grapheme) || EMOJI.test(grapheme) || grapheme.includes(EMOJI_SELECTOR) ? 2 : 1;
}

/** The columns a string takes in a terminal. Colour codes must be taken out first. */
export function columns(text: string): number {
  let total = 0;
  for (const g of graphemes(text)) total += width(g);
  return total;
}
