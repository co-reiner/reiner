/**
 * @file Model names and plain-text summaries of a model selection, shared by the TUI and one-shot output.
 * @see {@link ../../../../docs/architecture/modules.md#contract | Harness modules: contract}
 */
import type { ModelInfo, SelectModelResult } from '@co-reiner/core';

export const modelName = (m: ModelInfo) => (m.group ? `${m.group} › ${m.label}` : m.label);

/** Plain-text summary of a /model result, shared by the TUI and the one-shot command. */
export function describeSelection(
  result: SelectModelResult,
  query: string,
): { tone: 'success' | 'warn' | 'error'; lines: string[] } {
  const extra = result.notes;
  switch (result.status) {
    case 'selected':
      return {
        tone: 'success',
        lines: [`Selected ${modelName(result.model as ModelInfo)}. Saved as this project's model.`, ...extra],
      };
    case 'already':
      return {
        tone: 'success',
        lines: [
          `${modelName(result.model as ModelInfo)} is already selected. Saved as this project's model.`,
        ],
      };
    case 'ambiguous':
      return {
        tone: 'warn',
        lines: [
          `"${query}" matches ${result.candidates.length} models. Be more specific:`,
          ...result.candidates.map((m) => `  ${modelName(m)}`),
        ],
      };
    case 'not-found':
      return {
        tone: 'error',
        lines: [
          `No model matches "${query}".`,
          ...(result.models.length ? ['Available:', ...result.models.map((m) => `  ${modelName(m)}`)] : []),
          ...extra,
        ],
      };
    case 'signed-out':
    case 'failed':
      return { tone: 'error', lines: extra.length ? extra : ['Could not select the model.'] };
  }
}
