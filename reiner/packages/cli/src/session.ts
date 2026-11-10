/**
 * @file Opens a project session: `.reiner/`, config, the active harness, its remembered state and the transcript.
 * @see {@link ../../../docs/architecture/project-config.md | Project configuration and the `.reiner/` folder}
 * @see {@link ../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: harnesses and the live browser}
 */
import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  activeHarness,
  addHarnessToConfig,
  type ChatInfo,
  ensureReinerDir,
  findProjectRoot,
  type HarnessEntry,
  type HarnessModule,
  harnessIds,
  loadConfig,
  type ModelInfo,
  type ModelPreference,
  type ProjectPaths,
  type ReinerConfig,
  readState,
  type SignInState,
  type TaskConfig,
  writeState,
} from '@co-reiner/core';
import { installedHarnesses } from './harnesses.ts';

export interface Session {
  root: string;
  paths: ProjectPaths;
  config: ReinerConfig;
  /** Things worth telling the user once, e.g. "created .reiner/". */
  notices: string[];
  /** Harnesses installed with the CLI. */
  available: HarnessEntry[];
  /** The active harness, or null until the user picks one on first run. */
  harness: HarnessEntry | null;
  /** The active harness's module. It owns the one live browser window. */
  module: HarnessModule | null;
  /** True on first run when several harnesses are installed and nothing says which to use; never without any. */
  needsHarnessChoice: boolean;
  /**
   * Make `id` the active harness: add it to the project config, make it the default, and close the
   * previous harness's browser. The new module is created but not started.
   */
  chooseHarness(id: string): Promise<void>;
  lastSignIn(): Promise<SignInState | undefined>;
  /** Models seen the last time the active harness's picker was read. */
  lastModels(): Promise<ModelInfo[]>;
  /** The model chosen with /model for this project and harness. */
  modelPreference(): Promise<ModelPreference | undefined>;
  /** The harness's recent chats, as last read from its history list (for /chat suggestions). */
  lastChats(): Promise<ChatInfo[]>;
  /** The chat that was open when the TUI was last used, to reopen on start. */
  lastOpenChat(): Promise<ChatInfo | undefined>;
  /** Record the open chat (undefined for a new, unsaved chat). */
  rememberOpenChat(chat: ChatInfo | undefined): Promise<void>;
  /**
   * The active harness's settings, read fresh from `.reiner/config.jsonc` (and the global config), so an edit
   * counts without restarting. Used for settings read at the time of use, such as search `include`/`exclude`.
   */
  harnessSettings(): Promise<Record<string, unknown>>;
  /** The project's named tasks, read fresh from its own `.reiner/config.jsonc`. */
  tasks(): Promise<Record<string, TaskConfig>>;
  /** This run's transcript, `.reiner/sessions/<started>/transcript.jsonl`. Local only. */
  transcript: Transcript;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'event';
  text: string;
  harness?: string;
  model?: string;
  stopped?: boolean;
  elapsedMs?: number;
}

export interface Transcript {
  file: string;
  append(entry: TranscriptEntry): Promise<void>;
}

function createTranscript(sessionsDir: string): Transcript {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(sessionsDir, id);
  const file = path.join(dir, 'transcript.jsonl');
  return {
    file,
    // Never rejects: callers do not wait for it, and an unwritable transcript must not end the session.
    async append(entry) {
      try {
        await mkdir(dir, { recursive: true });
        await appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
      } catch {}
    },
  };
}

export interface OpenSessionOptions {
  /** Use this harness for this run, e.g. from `--harness`. */
  harness?: string;
  /** Installed harnesses. Tests pass fakes. */
  registry?: HarnessEntry[];
  globalConfigFile?: string;
}

/** The project folder, its `.reiner/` paths, a config loader, and what to tell the user about setting up. */
async function prepareProject(start: string, opts: OpenSessionOptions) {
  const root = findProjectRoot(start);
  const ensured = await ensureReinerDir(root);
  const { paths } = ensured;
  const notices: string[] = [];
  if (ensured.created) notices.push(`Created ${path.join(root, '.reiner')} for this project.`);
  if (ensured.gitExcluded) notices.push('Added .reiner/ to .git/info/exclude so it is never committed.');
  if (ensured.gitignoreWritten && !ensured.created)
    notices.push('Added .reiner/.gitignore, so profiles, transferred files and logs stay out of git.');
  const load = () => loadConfig(paths.configFile, opts.globalConfigFile);
  return { root, paths, notices, load, config: await load() };
}

/** What the bare CLI says: it runs, but has nothing to drive. */
export const NO_HARNESSES =
  'No harnesses installed: this is the bare CLI. Install @co-reiner/reiner for the CLI with its harnesses.';

/**
 * The harness to start with. A project without one gets the requested harness, or the only one installed,
 * written into its config.
 */
async function initialHarness(
  project: Awaited<ReturnType<typeof prepareProject>>,
  registry: HarnessEntry[],
  requested: string | undefined,
  refresh: () => Promise<void>,
): Promise<HarnessEntry | null> {
  const { paths, config, notices } = project;
  let wanted = requested ?? activeHarness(config);
  const projectHasHarness = existsSync(paths.configFile) && harnessIds(config).length > 0;
  if (registry.length === 0) {
    notices.push(NO_HARNESSES);
    return null;
  }
  if (!projectHasHarness) {
    if (!wanted && registry.length === 1) {
      wanted = registry[0]?.id;
      notices.push(`Using ${registry[0]?.displayName}, the only harness installed.`);
    }
    if (wanted) {
      const entry = findHarness(registry, wanted);
      await addHarnessToConfig(paths.configFile, entry.id, entry.defaultSettings);
      notices.push(`Wrote .reiner/config.jsonc with ${entry.displayName} as this project's harness.`);
      await refresh();
    }
  }
  return wanted ? findHarness(registry, wanted) : null;
}

function findHarness(registry: HarnessEntry[], id: string): HarnessEntry {
  const entry = registry.find((h) => h.id === id);
  if (!entry) throw new Error(`Unknown harness "${id}". Installed: ${registry.map((h) => h.id).join(', ')}`);
  return entry;
}

/**
 * What the active harness remembers (sign-in, models, chats), asked of its module: where it keeps them is
 * the module's own business. The open chat is the CLI's own note, kept in the harness's state folder.
 */
function harnessMemory(session: () => Session, paths: ProjectPaths) {
  const dir = () => {
    const harness = session().harness;
    return harness ? path.join(paths.modulesDir, harness.id) : undefined;
  };
  const memory = () => session().module?.remembered;
  return {
    lastSignIn: async () => memory()?.signIn?.(),
    lastModels: async () => (await memory()?.models?.()) ?? [],
    modelPreference: async () => memory()?.modelPreference?.(),
    lastChats: async () => (await memory()?.chats?.()) ?? [],
    lastOpenChat: async () => {
      const d = dir();
      return d ? (await readState<{ chat?: ChatInfo }>(d, 'last-chat'))?.chat : undefined;
    },
    rememberOpenChat: async (chat: ChatInfo | undefined) => {
      const d = dir();
      if (!d) return;
      await writeState(d, 'last-chat', chat ? { chat: { id: chat.id, title: chat.title } } : {}).catch(
        () => {},
      );
    },
  };
}

export async function openSession(start: string, opts: OpenSessionOptions = {}): Promise<Session> {
  const registry = opts.registry ?? installedHarnesses();
  const project = await prepareProject(start, opts);
  const { root, paths, notices, load, config } = project;
  const refresh = async () => {
    const fresh = await load();
    // Keep runtime browser overrides (flags, /browser) by updating the existing objects in place.
    Object.assign(config, { ...fresh, browser: config.browser });
  };
  const initial = await initialHarness(project, registry, opts.harness, refresh);
  const createModule = (entry: HarnessEntry) =>
    entry.create({
      projectRoot: root,
      profileDir: path.join(paths.profilesDir, entry.id),
      stateDir: path.join(paths.modulesDir, entry.id),
      logDir: paths.logsDir,
      browser: config.browser,
      settings: config.harnesses[entry.id] ?? entry.defaultSettings ?? {},
      // Read from the config file each time, so an edit counts without a restart.
      readSettings: async () => (await load()).harnesses[entry.id] ?? entry.defaultSettings ?? {},
    });

  const session: Session = {
    root,
    paths,
    config,
    notices,
    available: registry,
    harness: initial,
    module: initial ? createModule(initial) : null,
    needsHarnessChoice: !initial && registry.length > 0,

    async chooseHarness(id) {
      const entry = findHarness(registry, id);
      const switching = session.harness?.id !== id || !session.module;
      if (switching && session.module) await session.module.stop();
      await addHarnessToConfig(paths.configFile, entry.id, entry.defaultSettings);
      await refresh();
      if (switching) {
        session.harness = entry;
        session.module = createModule(entry);
      }
      session.needsHarnessChoice = false;
    },
    ...harnessMemory(() => session, paths),
    harnessSettings: async () => {
      if (!session.harness) return {};
      const fresh = await load();
      return fresh.harnesses[session.harness.id] ?? session.harness.defaultSettings ?? {};
    },
    tasks: async () => (await load()).tasks,
    transcript: createTranscript(paths.sessionsDir),
  };
  return session;
}
