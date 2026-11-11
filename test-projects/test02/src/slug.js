import { words } from './words.js';

/** Turn a title into a URL slug: lower case, words joined by hyphens. */
export function slug(title) {
  return words(title)
    .map((w) => w.toLowerCase())
    .join('-');
}
