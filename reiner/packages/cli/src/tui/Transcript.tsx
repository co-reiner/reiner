/**
 * @file The printed transcript: its entries, adding one, clearing the screen, and the live reply below it.
 * @see {@link ../../../../docs/architecture/cli-ux.md#tui-layout | CLI and TUI: TUI layout}
 */
import { Box, Static } from 'ink';
import { useCallback, useRef, useState } from 'react';
import type { Session } from '../session.ts';
import { AssistantReply, EntryView } from './EntryView.tsx';
import type { Entry, KeyedEntry } from './entries.ts';

/** The printed transcript: entries, how to add one, and how to clear the screen. */
export function useTranscript() {
  const nextKey = useRef(1);
  const [entries, setEntries] = useState<KeyedEntry[]>([{ kind: 'banner', key: 0 }]);
  /** Bumped by clearScreen so Ink's Static list starts again. */
  const [staticKey, setStaticKey] = useState(0);
  const print = useCallback((entry: Entry) => {
    setEntries((prev) => [...prev, { ...entry, key: nextKey.current++ }]);
  }, []);
  const clearScreen = useCallback(() => {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    setEntries([]);
    setStaticKey((k) => k + 1);
  }, []);
  return { entries, staticKey, print, clearScreen };
}

export interface TranscriptProps {
  session: Session;
  entries: KeyedEntry[];
  staticKey: number;
  /** The reply being written right now, or null. */
  streaming: string | null;
  liveReplyLines: number;
}

/** Printed entries (never redrawn), then the reply being written, if any. */
export function Transcript({ session, entries, staticKey, streaming, liveReplyLines }: TranscriptProps) {
  return (
    <>
      <Static key={staticKey} items={entries}>
        {(entry) => (
          <Box key={entry.key}>
            <EntryView entry={entry} session={session} />
          </Box>
        )}
      </Static>
      {streaming !== null && session.module ? (
        <AssistantReply
          markdown={streaming}
          harness={session.module.displayName}
          streaming
          maxLines={liveReplyLines}
        />
      ) : null}
    </>
  );
}
