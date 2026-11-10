/**
 * @file Groups models by the harness picker's submenus, for the TUI and one-shot output.
 * @see {@link ../../../../docs/architecture/modules.md#contract | Harness modules: contract}
 */
import type { ModelInfo } from '@co-reiner/core';

export interface ModelGroup {
  group?: string;
  models: ModelInfo[];
}

/** Bundle models by submenu, keeping the order they appear in the picker. */
export function groupModels(models: ModelInfo[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const model of models) {
    const last = groups.at(-1);
    if (last && last.group === model.group) last.models.push(model);
    else groups.push({ ...(model.group ? { group: model.group } : {}), models: [model] });
  }
  return groups;
}
