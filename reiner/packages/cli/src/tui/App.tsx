/**
 * @file The Ink TUI's root component: transcript, prompt area, harness picker and the wiring between them.
 * @see {@link ../../../../docs/architecture/cli-ux.md#tui-layout | CLI and TUI: TUI layout}
 * @see {@link ../../../../docs/architecture/cli-ux.md#startup | CLI and TUI: startup}
 */
import { Box, useApp, useWindowSize } from 'ink';
import { useEffect, useState } from 'react';
import type { Session } from '../session.ts';
import { type Question, runSlashCommand } from './command-api.ts';
import { HarnessPicker } from './HarnessPicker.tsx';
import { PromptArea, QuestionBox } from './PromptArea.tsx';
import { buildSuggestions } from './suggestions.ts';
import { Transcript, useTranscript } from './Transcript.tsx';
import { useAppKeys } from './useAppKeys.ts';
import { useCommands } from './useCommands.ts';
import { useHarness } from './useHarness.ts';
import { usePromptState } from './usePromptState.ts';

export interface AppProps {
  session: Session;
  /** Open the harness's browser as soon as the TUI starts. Tests turn this off. */
  autoStart?: boolean;
}

export function App({ session, autoStart = true }: AppProps) {
  const { exit } = useApp();
  const { rows } = useWindowSize();
  // Room for the live reply: the window minus its header, the "lines above" note, the prompt box, the
  // status line and some margin. Keeping the live area shorter than the window stops Ink leaving copies.
  const liveReplyLines = Math.max(4, (rows || 24) - 12);
  const { entries, staticKey, print, clearScreen } = useTranscript();
  const [busy, setBusy] = useState<string | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [choosing, setChoosing] = useState(session.needsHarnessChoice);
  const [streaming, setStreaming] = useState<string | null>(null);
  const prompt = usePromptState();
  const harness = useHarness(session, print, setBusy);

  // Open the browser on the harness once one is picked.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per pick, not on every render
  useEffect(() => {
    if (autoStart && !choosing && session.module) void harness.start();
  }, [choosing]);

  const { api, cancel, chat } = useCommands({
    session,
    harness,
    print,
    setBusy,
    setQuestion,
    clearScreen,
    exit,
    setStreaming,
  });

  const submit = async (raw: string) => {
    const text = raw.trim();
    prompt.changeInput('');
    if (!text || busy) return;
    prompt.remember(text);
    print({ kind: 'user', text });
    if (text.startsWith('/')) return runSlashCommand(api, text, harness.refreshCache);
    await chat(text);
  };

  const menu =
    busy || choosing || prompt.dismissed || question
      ? []
      : buildSuggestions({ ...harness, input: prompt.input, module: session.module });
  const highlighted = menu.length > 0 ? Math.min(prompt.selected, menu.length - 1) : 0;
  useAppKeys({
    session,
    streaming,
    cancel,
    question,
    busy,
    choosing,
    menu,
    highlighted,
    prompt,
    setBusy,
    setQuestion,
  });

  const pick = async (id: string) => {
    await session.chooseHarness(id);
    harness.chosen();
    setChoosing(false);
  };

  return (
    <Box flexDirection="column">
      <Transcript {...{ session, entries, staticKey, streaming, liveReplyLines }} />
      {question ? <QuestionBox question={question} /> : null}
      {choosing ? (
        <HarnessPicker harnesses={session.available} onPick={pick} />
      ) : question ? null : (
        // While a yes/no question is open the prompt is hidden, so the answer key is not typed into it.
        <PromptArea
          busy={busy}
          input={prompt.input}
          onChange={prompt.changeInput}
          onSubmit={submit}
          menu={menu}
          highlighted={highlighted}
          status={{ session, ...harness }}
        />
      )}
    </Box>
  );
}
