/** The words of a text: runs of letters and digits. */
export function words(text) {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** How many words a text has. */
export function wordCount(text) {
  return words(text).length;
}
