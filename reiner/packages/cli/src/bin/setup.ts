/**
 * @file `reiner init` and `reiner harness`: set up the project, and list or pick its harness.
 * @see {@link ../../../../docs/architecture/cli-ux.md#entry-points | CLI and TUI: entry points}
 * @see {@link ../../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: harnesses and the live browser}
 */
import { NO_HARNESSES, openSession } from '../session.ts';
import { type GlobalFlags, program, startDir } from './context.ts';

/** `reiner init` and `reiner harness`. */
export function registerSetup(): void {
  program
    .command('init')
    .description('Set up this folder as a Reiner project and pick its harness')
    .option('--harness <id>', 'harness to use (required when more than one is installed)')
    .action(async (opts: { harness?: string }) => {
      const id = opts.harness ?? program.opts<GlobalFlags>().harness;
      const session = await openSession(startDir, id ? { harness: id } : {});
      // The bare CLI's "no harnesses" notice is the error below, so it is not printed twice.
      for (const n of session.notices) if (n !== NO_HARNESSES) console.log(`· ${n}`);
      if (session.available.length === 0) {
        console.error(`✗ ${NO_HARNESSES}`);
        process.exitCode = 1;
        return;
      }
      if (!session.harness) {
        console.log('Several harnesses are installed. Pick one with `reiner init --harness <id>`:');
        for (const h of session.available) console.log(`  ${h.id}  ${h.displayName} · ${h.description}`);
        process.exitCode = 1;
        return;
      }
      await session.chooseHarness(session.harness.id);
      console.log(`✓ ${session.root} uses ${session.harness.displayName}. Run \`reiner\` to start.`);
    });

  program
    .command('harness')
    .description("List this project's harnesses, or make one the default")
    .argument('[id]', 'harness to make the default (added to the project if new)')
    .action(async (id?: string) => {
      const session = await openSession(startDir);
      if (session.available.length === 0) {
        console.error(`✗ ${NO_HARNESSES}`);
        process.exitCode = 1;
        return;
      }
      if (id) {
        await session.chooseHarness(id);
        console.log(`✓ ${session.harness?.displayName} is now this project's harness.`);
        return;
      }
      for (const h of session.available) {
        const active = h.id === session.harness?.id;
        const inProject = h.id in session.config.harnesses;
        console.log(
          `${active ? '●' : '○'} ${h.id}  ${h.displayName}${active ? ' (active)' : inProject ? ' (in project)' : ''}`,
        );
      }
    });
}
