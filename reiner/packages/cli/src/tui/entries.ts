/**
 * @file The kinds of entry the TUI's transcript shows.
 * @see {@link ../../../../docs/architecture/modules.md#harness-commands | Harness modules: harness commands}
 */
import type { OutputEntry, SignInState } from '@co-reiner/core';

/**
 * What the transcript shows: everything a harness command can print (`OutputEntry` in core), plus the
 * TUI's own entries.
 */
export type Entry =
  | OutputEntry
  | { kind: 'banner' }
  | { kind: 'user'; text: string }
  | { kind: 'help' }
  | {
      kind: 'assistant';
      markdown: string;
      harness: string;
      model?: string;
      elapsedMs: number;
      stopped: boolean;
    }
  | { kind: 'harnesses' }
  | { kind: 'status'; signIn: SignInState | undefined };

export type KeyedEntry = Entry & { key: number };
