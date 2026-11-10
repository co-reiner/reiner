/**
 * @file `/harness [name]`: lists the project's harnesses, or switches to one and makes it the default.
 * @see {@link ../../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 * @see {@link ../../../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: harnesses and the live browser}
 */
import type { SlashCommand } from './types.ts';

export const harnessCommand: SlashCommand = {
  name: 'harness',
  scope: 'global',
  args: '[name]',
  description: "List this project's harnesses, or switch to one (adds it if new)",
  async run(api, args) {
    const query = args.join(' ').trim().toLowerCase();
    if (!query) {
      api.print({ kind: 'harnesses' });
      return;
    }
    const entry =
      api.session.available.find((h) => h.id === query) ??
      api.session.available.find((h) => `${h.id} ${h.displayName}`.toLowerCase().includes(query));
    if (!entry) {
      api.print({ kind: 'error', text: `No installed harness matches "${query}".` });
      api.print({ kind: 'harnesses' });
      return;
    }
    if (entry.id === api.session.harness?.id) {
      api.print({ kind: 'info', text: `${entry.displayName} is already the active harness.` });
      if (!api.session.module?.isOpen()) await api.startHarness();
      return;
    }
    await api.switchHarness(entry.id);
  },
};
