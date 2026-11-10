/**
 * @file Hints that name a slash command are only shown for a harness that has that command.
 * @see {@link ../../../../docs/architecture/cli-ux.md#harness-commands | CLI and TUI: harness commands}
 */
import type { HarnessModule } from '@co-reiner/core';

/** True when the harness brings a command of this name, so a hint may point at it. */
export const hasCommand = (module: HarnessModule | null, name: string): boolean =>
  module?.commands?.some((c) => c.name === name) ?? false;
