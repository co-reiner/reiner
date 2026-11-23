/**
 * @file The `/pack` command: pack the whole project and attach it to the next prompt.
 * @see {@link ../../../exchange-packs/docs/packs.md#outbound-packs | File exchange: packs}
 * @see {@link ../../docs/commands.md#argument-completion | Copilot's slash commands: argument completion}
 */
import type { HarnessCommand } from '@co-reiner/core';
import type { ChatHarness } from './types.ts';

export const packCommand = (self: ChatHarness): HarnessCommand => ({
  name: 'pack',
  description:
    'Pack the whole project and attach it to the next prompt (in the messages mode: list its files); after that, changes go automatically',
  async run(host) {
    if (await self.exchange.sendsText()) {
      host.busy('Reading the project…');
      const project = await self.exchange.listProject();
      host.print({
        kind: 'success',
        text: `Your next prompt lists the project's ${project.count} file${project.count === 1 ? '' : 's'} (names only, nothing is uploaded); the model asks for the ones it needs.`,
      });
      return;
    }
    host.busy('Packing the project…');
    const pack = await self.exchange.pack();
    host.print({
      kind: 'success',
      text: `Packed ${pack.files.length} file${pack.files.length === 1 ? '' : 's'} (${(pack.bytes / 1024).toFixed(0)} KB${pack.indexed ? `, ${pack.indexed} indexed` : ''}). It goes with your next prompt.`,
    });
  },
});
