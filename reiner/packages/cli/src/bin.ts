/**
 * @file Entry point for the `reiner` command: registers the shell commands, runs commander and exits.
 * @see {@link ../../../docs/architecture/cli-ux.md#entry-points | CLI and TUI: entry points}
 */
import { program } from './bin/context.ts';
import { registerInfo } from './bin/info.ts';
import { registerMain } from './bin/main.ts';
import { registerSetup } from './bin/setup.ts';

registerMain();
registerSetup();
registerInfo();

// Exit explicitly: a browser may still be closing in the background, and that can take a minute.
// Playwright stops it when the process exits.
program
  .parseAsync()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
