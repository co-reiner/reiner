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
    'Pack the whole project and attach it to the next prompt; after that, changes go automatically as part packs',
  async run(host) {
    host.busy('Packing the project…');
    const pack = await self.exchange.pack();
    host.print({
      kind: 'success',
      text: `Packed ${pack.files.length} file${pack.files.length === 1 ? '' : 's'} (${(pack.bytes / 1024).toFixed(0)} KB${pack.indexed ? `, ${pack.indexed} indexed` : ''}). It goes with your next prompt.`,
    });
  },
});
