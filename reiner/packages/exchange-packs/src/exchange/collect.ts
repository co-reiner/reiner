/**
 * @file Collects the file changes in a reply: a diff written in it, and whatever the current reply mode
 * brings back (its own `collect`), read as change sets.
 * @see {@link ../../docs/packs.md#inbound-reply-modes | File exchange: reply modes}
 * @see {@link ../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import {
  type ChangeSet,
  type ChatReply,
  diffFiles,
  extractDeletions,
  extractDiffs,
  readChangeFile,
  type StatusListener,
} from '@co-reiner/core';
import {
  currentMode,
  incomingDir,
  projectName,
  readTransferState,
  support,
  type TransferContext,
} from './store.ts';

export interface Collected {
  sets: ChangeSet[];
  notes: string[];
}

/** Changes in a reply, by the current mode. Downloads files when the mode needs it. */
export async function collect(
  ctx: TransferContext,
  reply: ChatReply,
  onStatus?: StatusListener,
): Promise<Collected> {
  ctx.lastReply = reply;
  const s = await readTransferState(ctx);
  const found: Collected = { sets: [], notes: [] };
  // A diff in the reply is applied in any mode: models sometimes answer that way anyway.
  for (const diff of extractDiffs(reply.markdown)) {
    found.sets.push({ kind: 'diff', source: 'reply', diff, files: diffFiles(diff) });
  }
  // Files the reply offers are taken in any mode too, for the same reason: a mode that fetches nothing
  // itself (`diff`) uses the `download` mode's way, when the harness has one.
  const mode = currentMode(ctx, s);
  const fetching = mode.collect ? mode : support(ctx).modes.find((m) => m.id === 'download');
  const got = await fetching?.collect?.(reply, {
    project: projectName(ctx),
    incomingDir: incomingDir(ctx),
    ...(onStatus ? { onStatus } : {}),
  });
  if (got) {
    found.notes.push(...got.notes);
    await readFiles(got.files, found);
  }
  // Files the reply lists in its "To delete" block: offered last, after the changes, and only ever
  // moved to the recycle bin.
  const gone = extractDeletions(reply.markdown);
  if (gone.length) found.sets.push({ kind: 'files', source: 'reply (to delete)', writes: [], deletes: gone });
  return found;
}

/**
 * Changes from the last reply again, e.g. after declining or when a file arrived late. With no reply yet in
 * this run (Reiner was restarted on a chat that already has one), `latest` reads the open chat's newest reply
 * from the page instead.
 */
export async function recollect(
  ctx: TransferContext,
  onStatus?: StatusListener,
  latest?: () => Promise<string | undefined>,
): Promise<Collected> {
  const markdown = ctx.lastReply ? undefined : await latest?.();
  const reply = ctx.lastReply ?? (markdown ? { markdown, stopped: false, elapsedMs: 0 } : undefined);
  if (!reply) return { sets: [], notes: ['No reply to apply from yet: the open chat has no reply.'] };
  return collect(ctx, reply, onStatus);
}

async function readFiles(files: string[], found: Collected): Promise<void> {
  for (const f of files) {
    try {
      found.sets.push(await readChangeFile(f));
    } catch (e) {
      found.notes.push(e instanceof Error ? e.message : String(e));
    }
  }
}
