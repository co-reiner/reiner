/**
 * @file The `/transfer` command: show the file-exchange settings, switch the reply mode, or turn the index on or off.
 * @see {@link ../../../exchange-packs/docs/packs.md#inbound-reply-modes | File exchange: reply modes}
 * @see {@link ../../../exchange-packs/docs/packs.md#why-it-works-this-way | File exchange: why it works this way}
 * @see {@link ../../docs/file-exchange.md#missing-folders | Copilot file exchange: missing folders}
 * @see {@link ../../docs/commands.md#argument-completion | Copilot's slash commands: argument completion}
 */
import path from 'node:path';
import type { CommandHost, HarnessCommand } from '@co-reiner/core';
import { pad3 } from '@co-reiner/exchange-packs';
import { cleanUploads } from './clean.ts';
import { status } from './shared.ts';
import type { ChatHarness } from './types.ts';

/** The /transfer overview: modes, index setting, next patch number. */
async function transferLines(self: ChatHarness): Promise<string[]> {
  const support = self.transfer;
  const s = await self.exchange.state();
  const pending = self.exchange.pending();
  return [
    ...support.modes.map((m) => `${m.id === s.mode ? '●' : '○'} ${m.id.padEnd(9)} ${m.label}`),
    `Search index in packs: ${s.index ? 'on' : 'off'}${support.index ? '' : ' (not supported)'}`,
    `Next patch: ${pad3(s.sequence)}${pending ? ` · pack ready: ${path.basename(pending.file)}` : ''}`,
    support.modes.length > 1
      ? '/transfer <mode> switches · /transfer index on|off · /pack attaches the project'
      : '/pack attaches the project',
  ];
}

/**
 * After a mode or index change: the instructions describe only the current mode, so whatever is saved in
 * the harness's custom instructions now describes the old one. Always say so, in yellow; a chat that has
 * not had the new text gets it with its next prompt either way.
 */
async function warnSync(host: CommandHost, self: ChatHarness, what: string): Promise<void> {
  const saved = await self.exchange.syncStale();
  host.print({
    kind: 'warning',
    text: saved
      ? `${self.displayName}'s saved custom instructions describe the old setting. Run /instructions sync to update them for the ${what}.`
      : `If ${self.displayName}'s custom instructions hold Reiner's sections, run /instructions sync to update them for the ${what}.`,
  });
}

export const transferCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'transfer',
  args: '[mode] | index on|off | clean',
  description: 'How the model sends file changes back (modes depend on the harness)',
  choices: () => [
    ...self.transfer.modes.map((m) => ({ value: m.id, detail: m.label })),
    ...(self.transfer.index
      ? [
          { value: 'index on', detail: 'add the search index to packs' },
          { value: 'index off', detail: 'leave the search index out of packs' },
        ]
      : []),
    ...(self.uploads
      ? [{ value: 'clean', detail: "tick this project's old packs in the uploads to remove" }]
      : []),
  ],
  async run(host, args) {
    const support = self.transfer;
    const [first, second] = args.map((a) => a.toLowerCase());
    if (!first) {
      host.print({ kind: 'transfer', lines: await transferLines(self) });
      return;
    }
    if (first === 'clean') return cleanUploads(host, self);
    if (first === 'index') {
      if (second !== 'on' && second !== 'off') {
        host.print({ kind: 'error', text: 'Use /transfer index on or /transfer index off.' });
        return;
      }
      await self.exchange.setIndex(second === 'on');
      await warnSync(host, self, 'index setting');
      host.print({
        kind: 'success',
        text: `Search index ${second === 'on' ? 'added to' : 'left out of'} packs. The instructions change with the next prompt.`,
      });
      return;
    }
    const mode = support.modes.find((m) => m.id === first);
    if (!mode) {
      host.print({ kind: 'error', text: `No mode "${first}" for ${self.displayName}.` });
      host.print({ kind: 'transfer', lines: await transferLines(self) });
      return;
    }
    if (support.modes.length === 1) {
      host.print({
        kind: 'info',
        text: `${self.displayName} has only one mode: ${mode.id}.`,
      });
      return;
    }
    const ready = (await self.prepareTransfer?.(mode.id, {
      onStatus: status(host),
    })) ?? {
      ready: true,
      notes: [],
    };
    for (const n of ready.notes) host.print({ kind: 'info', text: n });
    await self.exchange.setMode(mode.id);
    if (ready.existing) await self.exchange.skipUsedSequences(ready.existing);
    await warnSync(host, self, `${mode.id} mode`);
    host.print({
      kind: ready.ready ? 'success' : 'error',
      text: `Changes now come back as: ${mode.label}.${ready.ready ? '' : ' The mode is set, but it is not ready yet.'}`,
    });
  },
});
