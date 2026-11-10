/**
 * @file The default `reiner` action: the TUI, one `-p` prompt, or one harness command.
 * @see {@link ../../../../docs/architecture/cli-ux.md#entry-points | CLI and TUI: entry points}
 * @see {@link ../../../../docs/architecture/modules.md#harness-commands | Harness modules: harness commands}
 */
import { createElement } from 'react';
import { oneShot, openSessionWithFlags, program, status, stopWithin } from './context.ts';
import { runHarnessCommand } from './run.ts';

/**
 * `reiner`: the TUI; with `-p` one prompt whose reply is printed as markdown; with a command name, that
 * harness command once (`reiner login`, `reiner models`, `reiner model sol quick`).
 */
export function registerMain(): void {
  program.option('-p, --prompt <text>', 'send one prompt, print the reply as markdown, and exit');
  program.option('--new-chat', 'with --prompt: start a new chat first');
  program
    .argument(
      '[command...]',
      "run one of the harness's slash commands once, e.g. login, models, model sol quick",
    )
    // Reiner's own flags count wherever they stand (`models --hide-browser`, `status --keep-browser`); an
    // option Reiner does not know (e.g. `models --debug`) is left for the command. No `passThroughOptions`:
    // it stops reading Reiner's flags at the command name.
    .allowUnknownOption();

  program.action(async (words: string[] = []) => {
    if (words.length) return runHarnessCommand(words);
    const { prompt, newChat } = program.opts<{ prompt?: string; newChat?: boolean }>();
    if (prompt !== undefined) {
      if (!prompt.trim()) program.error('-p needs a prompt: reiner -p "<prompt>"');
      await oneShot(async (module, session) => {
        if (newChat && !module.newChat)
          throw new Error(`${module.displayName} has no separate chats to start.`);
        if (newChat) {
          const started = await module.newChat?.({ onStatus: status });
          for (const note of started?.notes ?? []) status(note);
        }
        void session.transcript.append({ role: 'user', text: prompt, harness: module.id });
        const reply = await module.send(prompt, { onStatus: status });
        for (const note of reply.notes ?? []) status(note);
        void session.transcript.append({
          role: 'assistant',
          text: reply.markdown,
          harness: module.id,
          elapsedMs: reply.elapsedMs,
          stopped: reply.stopped,
          ...(reply.model ? { model: reply.model } : {}),
        });
        status(
          `${module.displayName}${reply.model ? ` · ${reply.model}` : ''} · ${(reply.elapsedMs / 1000).toFixed(1)}s`,
        );
        // The reply goes to stdout as plain markdown so it can be piped; status lines go to stderr.
        process.stdout.write(`${reply.markdown}\n`);
      });
      return;
    }
    if (!process.stdin.isTTY) {
      console.error('Interactive mode needs a terminal. Run `reiner --help` for one-shot commands.');
      process.exitCode = 1;
      return;
    }
    const session = await openSessionWithFlags();
    const { render } = await import('ink');
    const { App } = await import('../tui/App.tsx');
    const app = render(createElement(App, { session }), { exitOnCtrlC: true });
    await app.waitUntilExit();
    if (session.module?.isOpen()) {
      process.stdout.write('Closing the browser…\n');
      await stopWithin(session.module, 10_000);
    }
  });
}
