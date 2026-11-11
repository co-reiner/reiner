/**
 * @file The Google Search harness's slash commands: /login, /new, /share, /transfer and /apply.
 * @see {@link ../docs/commands.md | Google Search's slash commands}
 * @see {@link ../../../docs/architecture/modules.md#harness-commands | Harness modules: harness commands}
 */
import type { CommandHost, HarnessCommand, HarnessModule } from '@co-reiner/core';
import { SHARE_MODES, type ShareMode } from './exchange/context.ts';
import type { GsExchange } from './exchange/exchange.ts';
import { refusedLine } from './exchange/files.ts';

/** The module as these commands use it: sign-in, new conversations, and its own exchange. */
export type GsHarness = Omit<HarnessModule, 'exchange'> &
  Required<Pick<HarnessModule, 'login' | 'newChat'>> & { exchange: GsExchange };

const status = (host: CommandHost) => (s: string) => host.busy(s);

const loginCommand = (self: GsHarness): HarnessCommand => ({
  name: 'login',
  description: "Show the browser window to answer Google's robot check (or to sign in by hand)",
  async run(host) {
    const result = await self.login({ onStatus: status(host) });
    host.setSignIn(result.signIn);
    host.print({ kind: 'started', result, harness: self.displayName });
  },
});

const newCommand = (self: GsHarness): HarnessCommand => ({
  name: 'new',
  description: 'Start a new conversation',
  async run(host) {
    await self.newChat({ onStatus: status(host) });
    host.setChat(undefined);
    void host.log('new chat');
    host.print({ kind: 'success', text: `New conversation started in ${self.displayName}.` });
  },
});

const shareCommand = (self: GsHarness): HarnessCommand => ({
  name: 'share',
  args: '[paths or globs | clear]',
  description: 'Queue project files to go with your next prompt',
  async run(host, args) {
    const { exchange } = self;
    if (args[0] === 'clear') {
      exchange.clearPending();
      host.print({ kind: 'info', text: 'Nothing is queued to share.' });
      return;
    }
    if (args.length) {
      const { refused } = await exchange.queue(args);
      for (const line of refusedLine(refused)) host.print({ kind: 'warning', text: line });
    }
    const queued = exchange.pending();
    const how = (await exchange.mode()) === 'upload' ? 'as one uploaded text file' : 'quoted in the prompt';
    host.print({
      kind: 'info',
      text: queued.length
        ? `Going with your next prompt, ${how}: ${queued.join(', ')}.`
        : 'Nothing is queued to share. Use /share <paths or globs>, e.g. /share src/*.js',
    });
  },
});

const transferCommand = (self: GsHarness): HarnessCommand => ({
  name: 'transfer',
  args: '[text | upload]',
  description: 'How shared files travel: quoted in the prompt, or uploaded',
  choices: () => SHARE_MODES.map((m) => ({ value: m.id, detail: m.detail })),
  async run(host, args) {
    const wanted = SHARE_MODES.find((m) => m.id === args[0]);
    if (args[0] && !wanted) {
      host.print({ kind: 'error', text: `Unknown mode "${args[0]}". Use text or upload.` });
      return;
    }
    if (wanted) await self.exchange.setMode(wanted.id as ShareMode);
    const current = await self.exchange.mode();
    host.print({
      kind: 'transfer',
      lines: SHARE_MODES.map((m) => `${m.id === current ? '●' : '○'} ${m.id}: ${m.detail}`),
    });
  },
});

const applyCommand = (self: GsHarness): HarnessCommand => ({
  name: 'apply',
  description: 'Offer the file changes from the last reply again',
  async run(host) {
    const found = await self.exchange.recollect();
    if (found.sets.length === 0 && found.notes.length === 0) {
      host.print({ kind: 'info', text: 'The last reply has no file changes.' });
      return;
    }
    await host.offerChanges(found.sets, found.notes);
  },
});

/** The harness's commands, in the order /help lists them. */
export function gsCommands(self: GsHarness): HarnessCommand[] {
  return [loginCommand, newCommand, shareCommand, transferCommand, applyCommand].map((make) => make(self));
}
