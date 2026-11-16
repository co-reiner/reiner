/**
 * @file The plugin contract: what a plugin adds to a session (tools the model may call, a line for the prompt,
 * slash commands, a status badge) and what it may ask of the host. The host knows plugins only through it.
 * @see {@link ../../../docs/architecture/plugins.md | Plugins}
 */
import type { CommandChoice, OutputEntry, PickOption } from './commands.ts';
import type { ToolAnswer } from './tools/protocol.ts';

/** What a plugin knows of the project it runs in. */
export interface PluginContext {
  projectRoot: string;
  /** The project's `.reiner/` folder. */
  reinerDir: string;
  /** The project's own config file, which a plugin's commands may write its settings to. */
  configFile: string;
  /** Reiner's version. */
  version: string;
  /**
   * The project's config merged over the global one, read fresh, with every key: a plugin reads its own block
   * (`mcp` for the MCP plugin) and checks it itself.
   */
  readConfig(): Promise<Record<string, unknown>>;
}

/** What a plugin may ask of the host while a chat turn runs. */
export interface PluginHost {
  /** The active harness's name, for questions and lines ("Copilot asks to …"). */
  harnessName: string;
  print(entry: OutputEntry): void;
  /** Show a spinner with this label, or clear it with null. */
  busy(label: string | null): void;
  /** Ask the user a yes/no question. Resolves true only for an explicit "y". */
  confirm(question: string): Promise<boolean>;
}

/** What a plugin's command may ask of the host. */
export interface PluginCommandHost extends PluginHost {
  /**
   * Let the user tick rows (a tree when rows have an `indent`), starting from `ticked`. Resolves the ticked
   * indexes, or undefined when the user cancels.
   */
  choose(question: string, options: PickOption[], ticked: number[]): Promise<number[] | undefined>;
}

/** A plugin's state for one session. */
export interface PluginSession {
  /**
   * The tool names the model may call through this plugin, for reading a reply's calls. May start what the
   * plugin needs (servers) the first time.
   */
  toolNames(host: PluginHost): Promise<string[]>;
  /** Text added to the next prompt in this chat (`''` for none); a plugin says each thing once per chat. */
  promptLine(chatId: string | undefined, host: PluginHost): Promise<string>;
  /** The prompt with the line went to this chat. */
  promptSent(chatId: string | undefined): void;
  /** Answer a call to one of its tools, asking the user first where it needs to. */
  call(name: string, args: Record<string, unknown>, host: PluginHost): Promise<ToolAnswer>;
  /** A few words for the status line, or undefined for nothing; `warn` shows them in yellow. */
  status(): { text: string; warn?: boolean } | undefined;
  close(): Promise<void>;
}

/** A slash command a plugin adds. It runs with the plugin's session for this run. */
export interface PluginCommand {
  name: string;
  /** Argument hint shown in /help. */
  args?: string;
  description: string;
  /** Fixed values the argument can take, suggested as the user types. */
  choices?(): CommandChoice[];
  run(session: PluginSession, host: PluginCommandHost, args: string[]): Promise<void> | void;
}

/** A plugin, handed to the host by whoever starts it (the `@co-reiner/reiner` package bundles its plugins). */
export interface ReinerPlugin {
  id: string;
  /** Its commands, listed with the host's global ones. A name the host already has is not taken. */
  commands?: PluginCommand[];
  /** Its state for a session; nothing should start until a method needs it. */
  start(ctx: PluginContext): PluginSession;
}
