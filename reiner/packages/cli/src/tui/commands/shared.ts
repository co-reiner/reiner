/**
 * @file Helpers several commands share: the active harness, a status callback, and offering changes.
 * @see {@link ../../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import { applyChangeSet, type ChangeSet, changedPaths, type HarnessModule } from '@co-reiner/core';
import { checksAfterApply } from '../checks.ts';
import { hasCommand } from '../hints.ts';
import { offerDocument } from './documents.ts';
import { type Outcome, outcomeMessage } from './outcome.ts';
import type { CommandApi } from './types.ts';

/**
 * What applying changes needs: the TUI's command API, or the one-shot runner's stand-in. Without `ask` (one
 * shot), a "no" asks no reason.
 */
export type ChangeDeps = Pick<CommandApi, 'session' | 'print' | 'busy' | 'confirm' | 'checks'> &
  Partial<Pick<CommandApi, 'ask'>>;

/** The active harness module, or a clear error when none has been picked yet. */
export function harness(api: CommandApi): HarnessModule {
  if (!api.session.module) throw new Error('No harness picked yet. Use /harness <name>.');
  return api.session.module;
}

export const status = (api: CommandApi) => (s: string) => api.busy(s);

/**
 * Show what each change set touches, ask, and apply it to the project. Used after every reply and by
 * /apply. Nothing is written without an explicit "y"; after a "no" the user may say why. A received file
 * that is not a patch is reported and offered for copying instead (`offerDocument`). After an apply the
 * project's checks run (`checksAfterApply`). Returned: the message that tells the model what became of its
 * changes (and of the checks, when one failed and the user wants it seen), or undefined when none was offered.
 */
export async function offerChanges(
  api: ChangeDeps,
  sets: ChangeSet[],
  notes: string[],
): Promise<string | undefined> {
  for (const note of notes) api.print({ kind: 'info', text: note });
  let applied = 0;
  const changed: string[] = [];
  const outcomes: Outcome[] = [];
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
    const files = items.map((i) => i.path);
    if (!yes) {
      const again = hasCommand(api.session.module, 'apply')
        ? ' /apply offers the changes from the last reply again.'
        : '';
      api.print({ kind: 'info', text: `Not applied.${again}` });
      const reason = api.ask
        ? await api.ask(`Why not? ${modelName(api)} gets your reason (Enter for none).`)
        : '';
      outcomes.push({ kind: 'declined', files, reason });
      continue;
    }
    try {
      const done = await applyChangeSet(api.session.root, set);
      applied++;
      changed.push(...done);
      outcomes.push({ kind: 'applied', files: done });
      api.print({
        kind: 'success',
        text: `Applied ${done.length} change${done.length === 1 ? '' : 's'} from ${set.source}.`,
      });
      void api.session.transcript.append({
        role: 'event',
        text: `applied ${set.source}: ${done.join(', ')}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      api.print({ kind: 'error', text: `Could not apply ${set.source}: ${message}` });
      outcomes.push({ kind: 'failed', files, error: message });
    }
  }
  // The harness's exchange hears about it (a pack exchange moves on to the next patch number).
  const checks = applied > 0 ? await afterApply(api, changed) : undefined;
  const told = outcomeMessage(outcomes);
  return told && checks ? `${told}\n\n${checks}` : (told ?? checks);
}

async function afterApply(api: ChangeDeps, changed: string[]): Promise<string | undefined> {
  await api.session.module?.exchange?.applied();
  return checksAfterApply(api, changed);
}

const modelName = (api: ChangeDeps) => api.session.module?.displayName ?? 'The model';
