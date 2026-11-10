/**
 * @file React state for the active harness: sign-in, cached models and chats, the open chat and the browser.
 * @see {@link ../../../../docs/architecture/cli-ux.md#startup | CLI and TUI: startup}
 * @see {@link ../../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: harnesses and the live browser}
 */
import type { ChatInfo, ModelInfo, ModelPreference, SignInState } from '@co-reiner/core';
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '../session.ts';
import type { Entry } from './entries.ts';
import { startHarness } from './startHarness.ts';

/**
 * What the TUI knows about the active harness: sign-in, cached models and chats, the open chat and the
 * browser window, plus starting and switching harnesses.
 */
export function useHarness(
  session: Session,
  print: (entry: Entry) => void,
  setBusy: (s: string | null) => void,
) {
  const [signIn, setSignIn] = useState<SignInState | undefined>();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [preference, setPreference] = useState<ModelPreference | undefined>();
  const [chats, setChats] = useState<ChatInfo[]>([]);
  /** The chat open in the harness, for the status line. Undefined for a new, unsaved chat. */
  const [openChat, setOpenChat] = useState<ChatInfo | undefined>();
  const [browserOpen, setBrowserOpen] = useState(false);
  /** Bumped when the active harness changes, so harness-specific state is reloaded. */
  const [version, setVersion] = useState(0);

  /** Show the open chat in the status line and remember it, so the next start reopens it. */
  const trackChat = useCallback(
    (chat: ChatInfo | undefined) => {
      setOpenChat(chat);
      void session.rememberOpenChat(chat);
    },
    [session],
  );

  // Re-read after every command and turn: each harness call checks sign-in again and saves the result, so
  // a sign-in that finished after start (or one that lapsed) shows in the status line.
  const refreshCache = useCallback(() => {
    session.lastSignIn().then(setSignIn);
    session.lastModels().then(setModels);
    session.modelPreference().then(setPreference);
    session.lastChats().then(setChats);
    setBrowserOpen(session.module?.isOpen() ?? false);
  }, [session]);

  // Reload harness state, and watch for the user closing the browser window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the trigger
  useEffect(() => {
    refreshCache();
    return session.module?.onClosed(() => {
      setBrowserOpen(false);
      print({ kind: 'info', text: 'The browser window closed. The next command opens it again.' });
    });
  }, [session, refreshCache, print, version]);

  const start = useCallback(
    () => startHarness({ session, print, setBusy, setSignIn, trackChat, refreshCache }),
    [session, print, setBusy, trackChat, refreshCache],
  );

  /** The harness was chosen or changed: reload its state and say so. */
  const chosen = useCallback(() => {
    setVersion((v) => v + 1);
    print({ kind: 'success', text: `${session.harness?.displayName} is now this project's harness.` });
  }, [session, print]);

  const switchHarness = useCallback(
    async (id: string) => {
      setBusy('Switching harness…');
      await session.chooseHarness(id);
      chosen();
      await start();
    },
    [session, setBusy, chosen, start],
  );

  return {
    signIn,
    setSignIn,
    models,
    preference,
    chats,
    openChat,
    trackChat,
    browserOpen,
    refreshCache,
    start,
    switchHarness,
    chosen,
  };
}

export type HarnessState = ReturnType<typeof useHarness>;
