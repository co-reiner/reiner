/**
 * @file Transcript views for the harness's replies and for `/history` turns.
 * @see {@link ../../../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 */
import { Box, Text } from 'ink';
import { renderMarkdown } from '../markdown.ts';

/** A reply from the harness: a short header line, then the markdown rendered for the terminal. */
export function AssistantReply(props: {
  markdown: string;
  harness: string;
  model?: string;
  elapsedMs?: number;
  stopped?: boolean;
  streaming?: boolean;
  /**
   * Show at most this many lines, the newest ones. Used while a reply streams: Ink redraws the live area
   * on every update and cannot erase lines that have scrolled above the window, so a live area taller
   * than the terminal leaves a copy behind on each redraw.
   */
  maxLines?: number;
}) {
  const seconds = props.elapsedMs === undefined ? '' : ` · ${(props.elapsedMs / 1000).toFixed(1)}s`;
  let body = props.markdown ? renderMarkdown(props.markdown) : '…';
  let hidden = 0;
  if (props.maxLines !== undefined) {
    const lines = body.split('\n');
    if (lines.length > props.maxLines) {
      hidden = lines.length - props.maxLines;
      body = lines.slice(hidden).join('\n');
    }
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="magenta">
        ● {props.harness}
        <Text color="gray">
          {props.model ? ` · ${props.model}` : ''}
          {seconds}
          {props.stopped ? ' · stopped' : ''}
          {props.streaming ? ' · writing…' : ''}
        </Text>
      </Text>
      {hidden > 0 ? (
        <Text color="gray">
          {'  '}… {hidden} line{hidden === 1 ? '' : 's'} above, the full reply shows when it is done
        </Text>
      ) : null}
      <Box paddingLeft={2}>
        {/* While limited, one source line must stay one screen line, so long lines are cut, not wrapped. */}
        <Text wrap={props.maxLines !== undefined ? 'truncate-end' : 'wrap'}>{body}</Text>
      </Box>
    </Box>
  );
}

/** Replies longer than this are shortened in history views. */
const HISTORY_REPLY_LINES = 15;

/** Earlier turns of a chat, read back from the harness: prompts in full, long replies shortened. */
export function HistoryView(props: {
  turns: { prompt: string; reply: string }[];
  title: string;
  harness: string;
}) {
  const count = props.turns.length;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">
        ── Last {count} turn{count === 1 ? '' : 's'}
        {props.title ? ` of "${props.title}"` : ''} ──
      </Text>
      {props.turns.map((turn, i) => {
        const lines = turn.reply ? renderMarkdown(turn.reply).split('\n') : [];
        const hidden = Math.max(0, lines.length - HISTORY_REPLY_LINES);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: turns have no id and never reorder
          <Box key={i} flexDirection="column">
            <Box marginTop={1}>
              <Text color="gray">{'> '}</Text>
              <Text>{turn.prompt}</Text>
            </Box>
            <Text color="magenta">● {props.harness}</Text>
            <Box paddingLeft={2} flexDirection="column">
              <Text>{lines.length ? lines.slice(0, HISTORY_REPLY_LINES).join('\n') : '(no reply)'}</Text>
              {hidden > 0 ? (
                <Text color="gray">
                  … {hidden} more line{hidden === 1 ? '' : 's'} (the full reply is in the chat in the browser)
                </Text>
              ) : null}
            </Box>
          </Box>
        );
      })}
      <Text color="gray">── end of history ──</Text>
    </Box>
  );
}
