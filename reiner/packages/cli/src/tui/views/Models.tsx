/**
 * @file Transcript views for models (`/models`, `/model`, the saved model) and the harness start report.
 * @see {@link ../../../../../docs/architecture/modules.md#contract | Harness modules: contract}
 * @see {@link ../../../../../docs/architecture/cli-ux.md#startup | CLI and TUI: startup}
 */
import { Box, Text } from 'ink';
import { timeAgo } from '../../time.ts';
import type { Entry } from '../entries.ts';
import { groupModels } from '../group.ts';
import { describeSelection } from '../model-text.ts';
import { ACCENT } from './theme.ts';

type Of<K extends Entry['kind']> = Extract<Entry, { kind: K }>;

/** /models: the picker's models, grouped as in the harness. */
export function ModelsView({ entry }: { entry: Of<'models'> }) {
  const { result } = entry;
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {result.models.length > 0 ? (
        <>
          <Text bold>
            Models available <Text color="gray">(from the model picker)</Text>
          </Text>
          {groupModels(result.models).map((g) => (
            <Box key={g.group ?? '-'} flexDirection="column">
              {g.group ? <Text color="gray">▸ {g.group}</Text> : null}
              {g.models.map((m) => (
                <Text key={m.id}>
                  {g.group ? '  ' : ''}
                  <Text color={m.selected ? 'green' : ACCENT}>{m.selected ? '● ' : '○ '}</Text>
                  {m.label}
                  {m.description ? <Text color="gray"> · {m.description}</Text> : null}
                </Text>
              ))}
            </Box>
          ))}
        </>
      ) : (
        <Text color="yellow">No models found.</Text>
      )}
      {result.notes.map((n) => (
        <Text key={n} color="gray">
          {n}
        </Text>
      ))}
      {result.debugFile ? <Text color="gray">Debug dump: {result.debugFile}</Text> : null}
    </Box>
  );
}

/** /model <name>: what was picked, or why not. */
export function ModelView({ entry }: { entry: Of<'model'> }) {
  const { tone, lines } = describeSelection(entry.result, entry.query);
  const color = tone === 'success' ? 'green' : tone === 'warn' ? 'yellow' : 'red';
  const mark = tone === 'success' ? '✓' : tone === 'warn' ? '?' : '✗';
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {lines.map((line, i) => (
        <Text key={line} color={i === 0 ? color : 'gray'}>
          {i === 0 ? `${mark} ` : '  '}
          {line}
        </Text>
      ))}
    </Box>
  );
}

/** /model with no name: the project's saved choice. */
export function ModelCurrentView({ entry }: { entry: Of<'model-current'> }) {
  const p = entry.preference;
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {p ? (
        <Text>
          Model for this project:{' '}
          <Text color={ACCENT}>
            {p.group ? `${p.group} › ` : ''}
            {p.label}
          </Text>{' '}
          <Text color="gray">(chosen {timeAgo(p.chosenAt)})</Text>
        </Text>
      ) : (
        <Text color="gray">No model chosen for this project yet.</Text>
      )}
      <Text color="gray">Use /model &lt;name&gt; to pick one, /models to list them.</Text>
    </Box>
  );
}

/** After opening the harness: sign-in, the re-applied model, and notes. */
export function StartedView({ entry, canLogin }: { entry: Of<'started'>; canLogin: boolean }) {
  const { result } = entry;
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {result.signIn.signedIn ? (
        <Text color="green">✓ {entry.harness} is open and signed in.</Text>
      ) : (
        <Text color="yellow">
          ● {entry.harness} is open but not signed in. Sign in in the browser window
          {canLogin ? ', then run /login.' : '.'}
        </Text>
      )}
      {result.appliedModel ? (
        <Text color="gray">
          Model: {result.appliedModel.group ? `${result.appliedModel.group} › ` : ''}
          {result.appliedModel.label} (this project's choice, re-applied)
        </Text>
      ) : null}
      {result.notes
        .filter((n) => result.signIn.signedIn || n !== result.signIn.reason)
        .map((n) => (
          // Start notes are things to act on, such as a model that is not available: shown in yellow.
          <Text key={n} color="yellow">
            {n}
          </Text>
        ))}
    </Box>
  );
}
