/**
 * @file Renders one transcript entry by its kind, using the views in `views/`.
 * @see {@link ../../../../docs/architecture/cli-ux.md#harness-commands | CLI and TUI: harness commands}
 */
import { Box, Text } from 'ink';
import type { Session } from '../session.ts';
import type { Entry } from './entries.ts';
import { hasCommand } from './hints.ts';
import { ChangesView, ChatsView, TransferView } from './views/Lists.tsx';
import { ModelCurrentView, ModelsView, ModelView, StartedView } from './views/Models.tsx';
import { AssistantReply, HistoryView } from './views/Reply.tsx';
import { Banner, HarnessesView, HelpView, SignInBadge, StatusView } from './views/Session.tsx';

export { AssistantReply, SignInBadge };

/** One printed transcript entry; each kind has its view in `views/`. */
export function EntryView({ entry, session }: { entry: Entry; session: Session }) {
  switch (entry.kind) {
    case 'banner':
      return <Banner session={session} />;
    case 'user':
      return (
        <Box marginTop={1}>
          <Text color="gray">{'> '}</Text>
          <Text>{entry.text}</Text>
        </Box>
      );
    case 'assistant':
      // Named props, not `{...entry}`: printed entries carry the transcript's React `key`, and spreading a
      // key into JSX makes React print a warning in the middle of the TUI.
      return (
        <AssistantReply
          markdown={entry.markdown}
          harness={entry.harness}
          elapsedMs={entry.elapsedMs}
          stopped={entry.stopped}
          {...(entry.model ? { model: entry.model } : {})}
        />
      );
    case 'info':
      return <Text color="gray"> {entry.text}</Text>;
    case 'success':
      return <Text color="green"> ✓ {entry.text}</Text>;
    case 'warning':
      return <Text color="yellow"> ⚠ {entry.text}</Text>;
    case 'error':
      return <Text color="red"> ✗ {entry.text}</Text>;
    case 'help':
      return <HelpView session={session} />;
    case 'models':
      return <ModelsView entry={entry} />;
    case 'model':
      return <ModelView entry={entry} />;
    case 'model-current':
      return <ModelCurrentView entry={entry} />;
    case 'started':
      return <StartedView entry={entry} canLogin={hasCommand(session.module, 'login')} />;
    case 'history':
      return <HistoryView turns={entry.turns} title={entry.title} harness={entry.harness} />;
    case 'chats':
      return <ChatsView entry={entry} module={session.module} />;
    case 'changes':
      return <ChangesView entry={entry} />;
    case 'transfer':
      return <TransferView entry={entry} />;
    case 'harnesses':
      return <HarnessesView session={session} />;
    case 'status':
      return <StatusView session={session} signIn={entry.signIn} />;
  }
}
