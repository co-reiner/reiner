/**
 * @file The `/apply` command: offer the last reply's file changes again.
 * @see {@link ../../docs/commands.md#yn-questions-and-keep | Copilot's slash commands: y/N questions and (Keep)}
 * @see {@link ../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import type { HarnessCommand } from '@co-reiner/core';
import { status } from './shared.ts';
import type { ChatHarness } from './types.ts';

export const applyCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'apply',
  description: 'Offer the file changes from the last reply again',
  async run(host) {
    const onStatus = status(host);
    // After a restart this run has no reply yet: take the newest one in the open chat, as /history reads it.
    const latest = async () => {
      const [turn] = await self.readHistory({ turns: 1, onStatus });
      return turn?.reply || undefined;
    };
    const found = await self.exchange.recollect(onStatus, latest);
    if (found.sets.length === 0 && found.notes.length === 0) {
      host.print({ kind: 'info', text: 'The last reply has no file changes.' });
      return;
    }
    await host.offerChanges(found.sets, found.notes);
  },
});
