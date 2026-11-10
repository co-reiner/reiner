/**
 * @file The TUI's command API and chat starter, with what they keep for the whole session: the Esc flag
 * and the project checks' approvals.
 * @see {@link ../../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 * @see {@link ../../../../docs/architecture/tool-protocol.md#project-tasks | Tool protocol: project tasks}
 */
import { useRef } from 'react';
import { runChat } from './chat-loop.ts';
import { newChecksState } from './checks.ts';
import { type CommandApiDeps, createCommandApi } from './command-api.ts';

export interface CommandsDeps extends Omit<CommandApiDeps, 'checks' | 'chat'> {
  /** The reply being written right now (markdown so far), or null when no chat is in progress. */
  setStreaming(markdown: string | null): void;
}

/** The command API for this render, the Esc flag, and a way to start a chat turn. */
export function useCommands(d: CommandsDeps) {
  // Esc during a turn: the key handler raises it, the chat loop reads it between its steps.
  const cancel = useRef(false);
  // The project's checks keep their approvals for the whole session.
  const checks = useRef(newChecksState());
  // A chat turn can also be started by something other than the prompt (a failing check's output), so the
  // API needs to reach the chat, and the chat needs the API: the ref ties the two together.
  const chatRef = useRef<(text: string) => Promise<void>>(async () => {});
  const chat = (text: string) => chatRef.current(text);
  const { setStreaming, ...rest } = d;
  const api = createCommandApi({ ...rest, checks: checks.current, chat });
  chatRef.current = (text) => {
    const { trackChat, refreshCache, openChat } = d.harness;
    return runChat(
      { api, setBusy: d.setBusy, setStreaming, trackChat, refreshCache, openChatId: openChat?.id, cancel },
      text,
    );
  };
  return { api, cancel, chat };
}
