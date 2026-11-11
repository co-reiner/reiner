/**
 * @file The reply mode, search index setting, patch numbers and custom-instructions sync marker.
 * @see {@link ../../docs/packs.md#inbound-reply-modes | File exchange: reply modes}
 * @see {@link ../../docs/packs.md#where-the-sections-live | File exchange: where the sections live}
 * @see {@link ../../docs/packs.md#why-it-works-this-way | File exchange: why it works this way}
 */
import {
  projectName,
  readTransferState,
  saveTransferState,
  sectionsFor,
  signature,
  support,
  type TransferContext,
  type TransferState,
} from './store.ts';

/** The reply mode, index setting, patch numbers and the custom-instructions sync marker. */
export function settingsMethods(ctx: TransferContext) {
  const state = () => readTransferState(ctx);
  const update = async (change: (s: TransferState) => TransferState): Promise<TransferState> => {
    const next = change(await state());
    await saveTransferState(ctx, next);
    return next;
  };
  return {
    state,

    /** Switch the reply mode, by the id of one the harness offers. */
    async setMode(mode: string): Promise<TransferState> {
      if (!support(ctx).modes.some((m) => m.id === mode))
        throw new Error(`${ctx.host.displayName} has no reply mode "${mode}".`);
      return update((s) => ({ ...s, mode }));
    },

    async setIndex(on: boolean): Promise<TransferState> {
      if (on && !support(ctx).index)
        throw new Error(`${ctx.host.displayName} packs cannot carry a search index.`);
      return update((s) => ({ ...s, index: on }));
    },

    /**
     * Skip patch numbers already used by files in the harness's folder, so an old patch with the same
     * name is never fetched in place of the new one.
     */
    async skipUsedSequences(names: string[]): Promise<TransferState> {
      const s = await state();
      const prefix = `${projectName(ctx).toLowerCase()}.patch.`;
      const used = names
        .map((n) => n.toLowerCase())
        .filter((n) => n.startsWith(prefix))
        .map((n) => Number(/^(\d{3})/.exec(n.slice(prefix.length))?.[1] ?? 0));
      const next = Math.max(s.sequence, ...used.map((u) => u + 1));
      if (next === s.sequence) return s;
      return update((current) => ({ ...current, sequence: next }));
    },

    /** The marker for the current settings and section text (stored per chat and for the saved sections). */
    signature: async () => signature(ctx, await state()),

    /** The sections for the current mode and index setting. */
    sections: async () => sectionsFor(ctx, await state()),

    /** Record what is saved in the harness's custom instructions: the current sections, or none. */
    async markSynced(on: boolean): Promise<void> {
      await update(({ synced: _old, ...rest }) =>
        on ? { ...rest, synced: signature(ctx, { ...rest }) } : rest,
      );
    },

    /** Saved sections that no longer match the current mode or index setting. */
    async syncStale(): Promise<boolean> {
      const s = await state();
      return s.synced !== undefined && s.synced !== signature(ctx, s);
    },

    /** After applying: the next patch gets a new number. */
    async advance(): Promise<void> {
      await update((s) => ({ ...s, sequence: s.sequence + 1 }));
    },
  };
}
