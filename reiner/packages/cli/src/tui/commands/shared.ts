/**
 * @file Helpers several commands share: the active harness, a status callback, and offering changes.
 * @see {@link ../../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import { applyChangeSet, type ChangeSet, changedPaths, type HarnessModule } from '@co-reiner/core';
import { checksAfterApply } from '../checks.ts';
import { hasCommand } from '../hints.ts';
import { offerDocument } from './documents.ts';
import type { CommandApi } from './types.ts';

/** What applying changes needs: the TUI's command API, or the one-shot runner's stand-in. */
export type ChangeDeps = Pick<CommandApi, 'session' | 'print' | 'busy' | 'confirm' | 'checks'>;

/** The active harness module, or a clear error when none has been picked yet. */
export function harness(api: CommandApi): HarnessModule {
  if (!api.session.module) throw new Error('No harness picked yet. Use /harness <name>.');
  return api.session.module;
}

export const status = (api: CommandApi) => (s: string) => api.busy(s);

/**
 * Show what each change set touches, ask, and apply it to the project. Used after every reply and by
 * /apply. Nothing is written without an explicit "y". A received file that is not a patch is reported and
 * offered for copying instead (`offerDocument`). After an apply the project's checks run (`checksAfterApply`);
 * when one fails and the user wants the model to see it, the text to send is returned.
 */
export async function offerChanges(
  api: ChangeDeps,
  sets: ChangeSet[],
  notes: string[],
): Promise<string | undefined> {
  for (const note of notes) api.print({ kind: 'info', text: note });
  let applied = 0;
  const changed: string[] = [];
  for (const set of sets) {
    if (set.kind === 'document') {
      await offerDocument(api, set);
      continue;
    }
    const items = changedPaths(set);
    if (items.length === 0) continue;
    api.print({ kind: 'changes', source: set.source, items });
    api.busy(null);
    const yes = await api.confirm(
      `Apply ${items.length} change${items.length === 1 ? '' : 's'} from ${set.source} to ${api.session.root}?${items.some((i) => i.action === 'delete') ? ' Deleted files go to the recycle bin.' : ''}`,
    );
    if (!yes) {
      const again = hasCommand(api.session.module, 'apply')
        ? ' /apply offers the changes from the last reply again.'
        : '';
      api.print({ kind: 'info', text: `Not applied.${again}` });
      continue;
    }
    try {
      const done = await applyChangeSet(api.session.root, set);
      applied++;
      changed.push(...done);
      api.print({
        kind: 'success',
        text: `Applied ${done.length} change${done.length === 1 ? '' : 's'} from ${set.source}.`,
      });
      void api.session.transcript.append({
        role: 'event',
        text: `applied ${set.source}: ${done.join(', ')}`,
      });
    } catch (error) {
      api.print({
        kind: 'error',
        text: `Could not apply ${set.source}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  // The harness's exchange hears about it (a pack exchange moves on to the next patch number).
  if (applied === 0) return undefined;
  await api.session.module?.exchange?.applied();
  return checksAfterApply(api, changed);
}
