/**
 * @file `/continue`: pick up the open chat's last reply again, as if it had just arrived: answer its tool
 * calls and carry on, or offer its file changes.
 * @see {@link ../../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 * @see {@link ../../../../../docs/architecture/tool-protocol.md#who-answers-a-call | Tool protocol: who answers a call}
 */
import type { SlashCommand } from './types.ts';

export const continueCommand: SlashCommand = {
  name: 'continue',
  scope: 'global',
  description: "Handle the open chat's last reply again: answer its tool calls, or offer its changes",
  async run(api) {
    if (!api.chat) {
      api.print({ kind: 'error', text: '/continue only works in the chat.' });
      return;
    }
    await api.chat({ lastReply: true });
  },
};
