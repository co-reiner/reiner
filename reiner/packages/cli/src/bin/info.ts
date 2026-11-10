/**
 * @file `reiner status`: prints the project, harness, browser and sign-in, checking sign-in on request.
 * @see {@link ../../../../docs/architecture/cli-ux.md#entry-points | CLI and TUI: entry points}
 * @see {@link ../../../../docs/architecture/modules.md#required-and-optional | Harness modules: required and optional}
 */
import { type HarnessModule, harnessIds } from '@co-reiner/core';
import type { Session } from '../session.ts';
import { timeAgo } from '../time.ts';
import { oneShot, openSessionWithFlags, program, status } from './context.ts';

/** `reiner status`. */
export function registerInfo(): void {
  program
    .command('status')
    .description('Show project, harness and sign-in status')
    .option('--check', 'open the browser to verify the sign-in')
    .action(async (opts: { check?: boolean }) => {
      const print = async (session: Session, module: HarnessModule | null) => {
        const signIn =
          opts.check && module?.checkSignIn
            ? await module.checkSignIn({ onStatus: status })
            : await session.lastSignIn();
        console.log(`Project   ${session.root}`);
        console.log(
          `Harness   ${session.harness ? `${session.harness.displayName} (${session.harness.id})` : 'none picked'}` +
            (harnessIds(session.config).length > 1
              ? `  · project has ${harnessIds(session.config).join(', ')}`
              : ''),
        );
        console.log(
          `Browser   ${session.config.browser.channel}${session.config.browser.headless ? ', headless' : ', visible'}`,
        );
        console.log(
          `Sign-in   ${
            !signIn
              ? 'not checked (use --check)'
              : signIn.signedIn
                ? `signed in (${timeAgo(signIn.checkedAt)})`
                : `not signed in: ${signIn.reason}`
          }`,
        );
      };
      if (opts.check) await oneShot((module, session) => print(session, module));
      else {
        const session = await openSessionWithFlags();
        for (const n of session.notices) console.log(`· ${n}`);
        await print(session, null);
      }
    });
}
