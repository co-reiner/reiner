/**
 * @file Public entry point of `@co-reiner/harness-gs`: the `google-search` harness entry.
 * @see {@link ../docs/module.md#settings | The Google Search module: settings}
 * @see {@link ../../../docs/architecture/modules.md#adding-a-harness | Harness modules: adding a harness}
 */
import type { HarnessEntry } from '@co-reiner/core';
import { createGoogleSearchModule, DISPLAY_NAME } from './gs/module.ts';
import { AI_MODE_URL } from './gs/selectors.ts';

export { createGoogleSearchModule } from './gs/module.ts';

/** AI mode of Google Search, driven through its web page. An experiment: see the package's README. */
export const googleSearchHarness: HarnessEntry = {
  id: 'google-search',
  displayName: DISPLAY_NAME,
  description: 'AI mode of Google Search in the browser, no account needed (experimental)',
  defaultSettings: { url: AI_MODE_URL, include: [], exclude: [] },
  create: createGoogleSearchModule,
};
