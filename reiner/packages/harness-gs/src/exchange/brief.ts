/**
 * @file What the model is told at the start of each conversation: how to ask for the project, and how to
 * write changes. AI mode has no saved instructions, so this travels in the first prompt. The product's
 * name is left out on purpose: nothing here, and nothing else this harness sends, names it.
 * @see {@link ../../docs/file-exchange.md#the-briefing | Google Search file exchange: the briefing}
 * @see {@link ../../../../docs/architecture/tool-protocol.md | Tool protocol}
 */
import { DELETE_HEADER } from '@co-reiner/core';

/** How many file names the first prompt lists at most. */
export const LIST_LIMIT = 150;

/**
 * The notes that close a conversation's first prompt, with the project's file list. The user's own text
 * comes first and the notes are short and in plain words: AI mode answers a prompt that reads like a
 * protocol (JSON tool calls, long rules) with plain web results instead of a reply.
 */
export function briefing(files: string[]): string {
  const shown = files.slice(0, LIST_LIMIT);
  const more = files.length > shown.length ? ` (and ${files.length - shown.length} more)` : '';
  return [
    'Notes: this is my own code project. It is on my machine, not on the web, so you only see the files I paste.',
    ...(shown.length ? [`Its files: ${shown.join(', ')}${more}.`] : []),
    'If you need to see files first, reply with a line "Files needed:" and their paths, one per line.',
    'When you change or create a file, give its complete new content in a code block, with a line "File: <path>" just before the block.',
    `To delete files, write a code block whose first line is "${DELETE_HEADER}" and then one path per line.`,
  ].join('\n');
}
