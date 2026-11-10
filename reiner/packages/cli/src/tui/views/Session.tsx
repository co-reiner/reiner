/**
 * @file Transcript views for the session: banner, sign-in badge, `/help`, `/harness` and `/status`.
 * @see {@link ../../../../../docs/architecture/cli-ux.md#global-commands | CLI and TUI: global commands}
 * @see {@link ../../../../../docs/architecture/cli-ux.md#harness-commands | CLI and TUI: harness commands}
 */
import { harnessIds, REINER_VERSION, type SignInState } from '@co-reiner/core';
import { Box, Text } from 'ink';
import type { Session } from '../../session.ts';
import { timeAgo } from '../../time.ts';
import { commandsFor } from '../commands.ts';
import { hasCommand } from '../hints.ts';
import { ACCENT } from './theme.ts';

export function SignInBadge({ state }: { state: SignInState | undefined }) {
  if (!state) return <Text color="gray">○ sign-in not checked</Text>;
  return state.signedIn ? (
    <Text color="green">
      ● signed in <Text color="gray">({timeAgo(state.checkedAt)})</Text>
    </Text>
  ) : (
    <Text color="yellow">● not signed in</Text>
  );
}

export function Banner({ session }: { session: Session }) {
  return (
    <Box borderStyle="round" borderColor={ACCENT} paddingX={1} flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={ACCENT} bold>
          ✻ Reiner
        </Text>{' '}
        <Text color="gray">v{REINER_VERSION}</Text>
      </Text>
      <Text color="gray">
        Harness <Text color="white">{session.harness?.displayName ?? 'not picked yet'}</Text>
      </Text>
      <Text color="gray">
        Project <Text color="white">{session.root}</Text>
      </Text>
      <Text> </Text>
      <Text color="gray">
        The harness opens in its own browser window.{' '}
        {hasCommand(session.module, 'models') && hasCommand(session.module, 'model') ? (
          <>
            Try <Text color="white">/models</Text> and <Text color="white">/model</Text>.{' '}
          </>
        ) : null}
        <Text color="white">/help</Text> lists everything.
      </Text>
      {session.notices.map((n) => (
        <Text key={n} color="gray">
          · {n}
        </Text>
      ))}
    </Box>
  );
}

/** /help: the active harness's commands first, global ones last, then the keys. */
export function HelpView({ session }: { session: Session }) {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {(['harness', 'global'] as const).map((scope) => {
        const list = commandsFor(session.module).filter((c) => c.scope === scope);
        if (list.length === 0) return null;
        return (
          <Box key={scope} flexDirection="column" marginBottom={scope === 'harness' ? 1 : 0}>
            <Text bold>
              {scope === 'harness'
                ? `${session.harness?.displayName ?? 'Harness'} commands`
                : 'Global commands'}
            </Text>
            {list.map((c) => (
              <Text key={c.name}>
                <Text color={ACCENT}>/{c.name}</Text>
                {c.args ? <Text color="gray"> {c.args}</Text> : null}
                <Text color="gray"> · {c.description}</Text>
              </Text>
            ))}
          </Box>
        );
      })}
      <Text> </Text>
      <Text bold>Keys</Text>
      <Text color="gray">
        Suggestions: ↑/↓ choose · Enter run · Tab complete · Esc hide. Otherwise ↑/↓ browse history · Ctrl+C
        quits
      </Text>
      <Text color="gray">
        Editing: Home/End · Ctrl+←/→ by word · Shift selects · Ctrl+W deletes a word · Ctrl+U/K to start/end
      </Text>
    </Box>
  );
}

export function HarnessesView({ session }: { session: Session }) {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text bold>Harnesses</Text>
      {session.available.map((h) => {
        const active = h.id === session.harness?.id;
        const inProject = h.id in session.config.harnesses;
        return (
          <Text key={h.id}>
            <Text color={active ? 'green' : ACCENT}>{active ? '● ' : '○ '}</Text>
            {h.displayName} <Text color="gray">({h.id})</Text>
            <Text color="gray">
              {active ? ' · active' : inProject ? ' · in this project' : ' · installed'} · {h.description}
            </Text>
          </Text>
        );
      })}
      <Text color="gray">
        Switch with /harness &lt;name&gt;. Each harness keeps its own sign-in and model.
      </Text>
    </Box>
  );
}

export function StatusView({ session, signIn }: { session: Session; signIn: SignInState | undefined }) {
  const ids = harnessIds(session.config);
  const browser = session.config.browser;
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color="gray">
        Project <Text color="white">{session.root}</Text>
      </Text>
      <Text color="gray">
        Harness <Text color="white">{session.harness?.displayName ?? 'none'}</Text>
        {session.harness ? ` (${session.harness.id})` : ''}
        {ids.length > 1 ? ` · project has ${ids.join(', ')}` : ''}
      </Text>
      <Text color="gray">
        Browser <Text color="white">{browser.channel}</Text>
        {browser.headless ? ', headless' : ', visible'}
        {session.module?.isOpen() ? ', open' : ', closed'}
      </Text>
      <Text color="gray">
        Profile <Text color="white">{session.paths.profilesDir}</Text>
      </Text>
      <Text color="gray">
        Sign-in <SignInBadge state={signIn} />
      </Text>
      {signIn && !signIn.signedIn ? <Text color="gray"> {signIn.reason}</Text> : null}
    </Box>
  );
}
