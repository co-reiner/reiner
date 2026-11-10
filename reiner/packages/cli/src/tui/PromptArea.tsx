/**
 * @file The area under the transcript: spinner, y/N question, prompt, suggestion list and status line.
 * @see {@link ../../../../docs/architecture/cli-ux.md#tui-layout | CLI and TUI: TUI layout}
 * @see {@link ../../../../docs/architecture/cli-ux.md#startup | CLI and TUI: startup}
 */
import type { ChatInfo, ModelPreference, SignInState } from '@co-reiner/core';
import { Box, Text, useAnimation } from 'ink';
import type { Session } from '../session.ts';
import type { Question } from './command-api.ts';
import { SignInBadge } from './EntryView.tsx';
import { PromptInput } from './PromptInput.tsx';
import type { PickQuestion } from './pick.ts';
import type { Suggestion } from './suggestions.ts';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function Spinner({ label }: { label: string }) {
  const { frame } = useAnimation({ interval: 80 });
  return (
    <Text color="cyan">
      {SPINNER[frame % SPINNER.length]} <Text color="gray">{label}</Text>
    </Text>
  );
}

/** A pick list: "(Select all)", then each option with a tick box; the cursor row is highlighted. */
function PickBox({ question }: { question: PickQuestion }) {
  const all = question.options.length > 0 && question.ticked.length === question.options.length;
  const rows = [
    { key: '-all', label: '(Select all)', ticked: all, detail: undefined as string | undefined },
    ...question.options.map((o, i) => ({
      key: `${i}`,
      label: o.label,
      ticked: question.ticked.includes(i),
      detail: o.detail,
    })),
  ];
  return (
    <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
      <Text>
        <Text color="yellow">? </Text>
        {question.text}
      </Text>
      {rows.map((r, i) => (
        <Text key={r.key}>
          <Text color="cyan">{i === question.cursor ? '❯ ' : '  '}</Text>
          <Text color={r.ticked ? 'green' : 'gray'}>{r.ticked ? '[x] ' : '[ ] '}</Text>
          <Text bold={i === question.cursor}>{r.label}</Text>
          {r.detail ? <Text color="gray"> · {r.detail}</Text> : null}
        </Text>
      ))}
      <Text color="gray">
        ↑/↓ move · Space tick · a all · Enter confirm ({question.ticked.length} ticked) · Esc cancel
      </Text>
    </Box>
  );
}

export function QuestionBox({ question }: { question: Question }) {
  if (question.kind === 'pick') return <PickBox question={question} />;
  return (
    <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text>
        <Text color="yellow">? </Text>
        {question.text} <Text color="gray">(y/N)</Text>
      </Text>
    </Box>
  );
}

function SuggestionList({ menu, highlighted }: { menu: Suggestion[]; highlighted: number }) {
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {menu.map((s, i) => (
        <Text key={s.key}>
          <Text color="cyan">{i === highlighted ? '❯ ' : '  '}</Text>
          <Text color={i === highlighted ? 'cyan' : 'white'} bold={i === highlighted}>
            {s.label}
          </Text>
          {s.detail ? <Text color="gray"> · {s.detail}</Text> : null}
          {s.current ? <Text color="green"> (current)</Text> : null}
        </Text>
      ))}
      <Text color="gray"> ↑/↓ choose · Enter run · Tab complete · Esc hide</Text>
    </Box>
  );
}

export interface StatusInfo {
  session: Session;
  browserOpen: boolean;
  signIn: SignInState | undefined;
  preference: ModelPreference | undefined;
  openChat: ChatInfo | undefined;
}

function StatusLine({ session, browserOpen, signIn, preference, openChat }: StatusInfo) {
  return (
    <Box paddingLeft={2}>
      <Text color="gray">
        {session.harness?.displayName ?? 'No harness'} ·{' '}
        {browserOpen ? <Text color="green">● browser open</Text> : '○ browser closed'} ·{' '}
        <SignInBadge state={signIn} />
        {preference ? ` · model: ${preference.label}` : ''}
        {openChat ? ` · chat: ${openChat.title || 'untitled'}` : ''} · /help
      </Text>
    </Box>
  );
}

export interface PromptAreaProps {
  busy: string | null;
  input: string;
  onChange(value: string): void;
  onSubmit(value: string): void;
  menu: Suggestion[];
  highlighted: number;
  status: StatusInfo;
}

/** The prompt box (or the spinner while busy), with the suggestion list or the status line under it. */
export function PromptArea({ busy, input, onChange, onSubmit, menu, highlighted, status }: PromptAreaProps) {
  return (
    <>
      <Box marginTop={1} borderStyle="round" borderColor={busy ? 'gray' : 'cyan'} paddingX={1}>
        {busy ? (
          <Spinner label={busy} />
        ) : (
          <>
            <Text color="cyan">{'> '}</Text>
            <PromptInput
              value={input}
              onChange={onChange}
              onSubmit={(value) => onSubmit(menu[highlighted]?.run ?? value)}
              placeholder="Ask anything, or type / for commands"
            />
          </>
        )}
      </Box>
      {menu.length > 0 ? (
        <SuggestionList menu={menu} highlighted={highlighted} />
      ) : (
        <StatusLine {...status} />
      )}
    </>
  );
}
