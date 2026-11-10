/**
 * @file The fake harness's uploads folder, for the `/transfer clean` tests.
 * @see {@link ../../../harness-ms/docs/commands.md#transfer-clean | Copilot's slash commands: /transfer clean}
 */
import type { PackHarness } from '@co-reiner/harness-ms';

/** Uploads like Copilot's after some runs: this project's packs of each kind, and another project's file. */
export const uploadNames = (p: string) => [
  `${p}.20261110-095636.zip.docx`,
  `${p}.part.001.zip.docx`,
  `${p}.zip 2.docx`,
  `${p}.zip.docx`,
  'other-project.zip.docx',
];

export function fakeUploads(names: string[], calls: string[]): NonNullable<PackHarness['uploads']> {
  return {
    list: async () => [...names],
    remove: async (remove) => {
      calls.push(`remove-uploads:${remove.join('|')}`);
      const removed = remove.filter((n) => names.includes(n));
      for (const n of removed) names.splice(names.indexOf(n), 1);
      return { removed, notFound: remove.filter((n) => !removed.includes(n)) };
    },
  };
}
