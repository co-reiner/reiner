/**
 * @file The `/instructions` command: show, sync or remove Reiner's sections in the custom instructions.
 * @see {@link ../../../exchange-packs/docs/packs.md#where-the-sections-live | File exchange: where the sections live}
 * @see {@link ../../docs/commands.md#yn-questions-and-keep | Copilot's slash commands: y/N questions and (Keep)}
 * @see {@link ../../docs/file-exchange.md#custom-instructions | Copilot file exchange: custom instructions}
 * @see {@link ../../docs/commands.md#argument-completion | Copilot's slash commands: argument completion}
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HarnessCommand } from '@co-reiner/core';
import { sectionIds, setSections } from '@co-reiner/exchange-packs';
import { status } from './shared.ts';
import type { ChatHarness } from './types.ts';

export const instructionsCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'instructions',
  choices: () => [
    { value: 'sync', detail: "save Reiner's sections into the custom instructions" },
    { value: 'remove', detail: "take Reiner's sections out, keep your own text" },
  ],
  args: '[sync | remove]',
  description: "Show, save or remove Reiner's sections in the harness's custom instructions",
  async run(host, args) {
    const custom = self.customInstructions;
    if (!custom) {
      host.print({
        kind: 'info',
        text: `${self.displayName} has no custom instructions to manage.`,
      });
      return;
    }
    const action = (args[0] ?? 'show').toLowerCase();
    const current = await custom.read({ onStatus: status(host), signal: host.signal });
    const present = sectionIds(current);
    const wanted = action === 'remove' ? [] : await self.exchange.sections();
    const next = setSections(current, wanted);
    const own = setSections(current, []).trim().length;
    if (action === 'show' || (action !== 'sync' && action !== 'remove')) {
      const upToDate = next === current;
      host.print({
        kind: 'transfer',
        lines: [
          `Custom instructions: ${current.length} characters (${own} of them yours).`,
          present.length ? `Reiner sections saved: ${present.join(', ')}` : 'No Reiner sections saved.',
          upToDate
            ? '● Up to date with this project’s mode and index setting.'
            : `○ Differs from this project's settings (wants ${wanted.map((w) => w.id).join(', ')}). /instructions sync saves them.`,
          '/instructions remove takes Reiner’s sections out and keeps your own text.',
        ],
      });
      if (upToDate && present.length) await self.exchange.markSynced(true);
      return;
    }
    if (next === current) {
      host.print({ kind: 'info', text: 'The custom instructions are already up to date. Nothing to save.' });
      await self.exchange.markSynced(action === 'sync');
      return;
    }
    // Keep the text as it was before every change, in case Copilot or a bug loses something.
    const backupDir = path.join(host.stateDir, 'instructions-backups');
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(backupDir, `${stamp}.txt`);
    await writeFile(backup, current, 'utf8');
    host.print({
      kind: 'transfer',
      lines: [
        action === 'sync'
          ? `Will save sections: ${wanted.map((w) => w.id).join(', ')}${present.length ? ` (replacing ${present.join(', ')})` : ''}.`
          : `Will remove sections: ${present.join(', ')}.`,
        `Your own ${own} characters stay exactly as they are. ${current.length} → ${next.length} characters in total.`,
        `Backup of the current text: ${backup}`,
      ],
    });
    host.busy(null);
    const yes = await host.confirm(`Save this to your ${self.displayName} custom instructions?`);
    if (!yes) {
      host.print({ kind: 'info', text: 'Not saved.' });
      return;
    }
    host.busy('Saving…');
    await custom.write(next, { onStatus: status(host), signal: host.signal });
    await self.exchange.markSynced(action === 'sync');
    host.log(`instructions ${action}: ${sectionIds(next).join(', ') || 'none'}`);
    host.print({
      kind: 'success',
      text:
        action === 'sync'
          ? 'Saved and checked. Prompts now carry only the one-line facts, not the sections.'
          : "Removed Reiner's sections. Prompts carry the sections again when needed.",
    });
  },
});
