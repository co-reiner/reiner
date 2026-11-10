/**
 * @file The harnesses this run of the CLI knows. The CLI ships none: whoever starts it (the `@co-reiner/reiner`
 * package, or `bin/run.js` with a loader) hands them in before the first command runs.
 * @see {@link ../../../docs/architecture/modules.md#adding-a-harness | Harness modules: adding a harness}
 * @see {@link ../../../docs/architecture/tech-stack.md#distribution | Tech stack: distribution}
 */
import type { HarnessEntry } from '@co-reiner/core';

let installed: HarnessEntry[] = [];

/** Set the installed harnesses, in the order the first-run picker shows them. */
export function setHarnesses(entries: HarnessEntry[]): void {
  installed = [...entries];
}

/** The installed harnesses; empty for the bare CLI. */
export const installedHarnesses = (): HarnessEntry[] => installed;
