/**
 * @file The `.reiner/config.jsonc` schema: loading project and global config, and adding harnesses.
 * @see {@link ../../../docs/architecture/project-config.md | Project configuration and the .reiner/ folder}
 * @see {@link ../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: harnesses and the live browser}
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyEdits, modify, type ParseError, parse, printParseErrorCode } from 'jsonc-parser';
import { z } from 'zod';
import type { TaskConfig } from './tools/tasks.ts';

const BrowserSchema = z.object({
  channel: z.enum(['auto', 'msedge', 'chrome', 'chromium']).default('auto'),
  // Visible by default: the harness runs in one browser window the user can watch.
  headless: z.boolean().default(false),
  keepOpen: z.boolean().default(false),
  // Off by default: keeps a sign-in that would otherwise end when the browser closes (see the security notes).
  keepSession: z.boolean().default(false),
});

/** A task name: short, and safe to show and to type. */
const TASK_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

/** A task is a command line, or a command with options. */
const TaskSchema = z
  .union([
    z.string().min(1),
    z.object({
      command: z.string().min(1),
      afterApply: z.boolean().optional(),
      timeoutSeconds: z.number().positive().max(3600).optional(),
    }),
  ])
  .transform((task): TaskConfig => {
    const given = typeof task === 'string' ? { command: task } : task;
    return {
      command: given.command,
      afterApply: given.afterApply ?? false,
      timeoutSeconds: given.timeoutSeconds ?? 600,
    };
  });

export const ConfigSchema = z.object({
  /**
   * Harnesses this project uses, keyed by harness id, in the order the user added them. Each value is
   * that harness's settings (its module reads them; search `include`/`exclude` live here too).
   */
  harnesses: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  /** The harness a new session starts with. */
  defaultHarness: z.string().optional(),
  browser: BrowserSchema.default({ channel: 'auto', headless: false, keepOpen: false, keepSession: false }),
  /**
   * Commands of this project that Reiner may run by name (its tests, its linter): after the user applies a
   * change, or when the model asks for one with `run_task`. Read from the project's own config only.
   */
  tasks: z.record(z.string().regex(TASK_NAME), TaskSchema).default({}),
});

export type ReinerConfig = z.infer<typeof ConfigSchema>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Ids of the harnesses the project uses, in the order they were added. */
export const harnessIds = (config: ReinerConfig): string[] => Object.keys(config.harnesses);

/** The harness a session should start with: the default, else the first configured one. */
export function activeHarness(config: ReinerConfig): string | undefined {
  return config.defaultHarness ?? harnessIds(config)[0];
}

function projectConfigText(harnessId: string, settings: Record<string, unknown> = {}): string {
  const nl = String.fromCharCode(10);
  const settingsJson = JSON.stringify(settings, null, 2).split(nl).join(`${nl}    `);
  return `// Reiner project config. See reiner/docs/architecture/project-config.md
{
  // Harnesses this project uses, each with its settings. Switch with /harness <id> in the TUI.
  "harnesses": {
    "${harnessId}": ${settingsJson}
  },
  "defaultHarness": "${harnessId}",
  "browser": {
    // auto | msedge | chrome | chromium
    "channel": "auto",
    // false shows the harness's browser window (recommended); true runs it in the background
    "headless": false,
    // one-shot commands only: keep the visible window open until you close it
    "keepOpen": false,
    // true keeps a sign-in that would end when the browser closes; see the security notes
    "keepSession": false
  }
}
`;
}

export function globalConfigFile(): string {
  return path.join(os.homedir(), '.reiner', 'config.jsonc');
}

async function readJsonc(file: string): Promise<Record<string, unknown>> {
  if (!existsSync(file)) return {};
  const errors: ParseError[] = [];
  const value = parse(await readFile(file, 'utf8'), errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(`Cannot parse ${file}: ${first ? printParseErrorCode(first.error) : 'unknown error'}`);
  }
  return (value ?? {}) as Record<string, unknown>;
}

function merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const prev = out[key];
    out[key] =
      prev && value && typeof prev === 'object' && typeof value === 'object' && !Array.isArray(value)
        ? merge(prev as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return out;
}

/** Global config, then project config. Later layers win. */
export async function loadConfig(
  projectConfigFile: string,
  globalFile: string = globalConfigFile(),
): Promise<ReinerConfig> {
  // Tasks are commands to run in this project, so only the project's own file may name them: a global
  // config must not make every project runnable.
  const { tasks: _notFromGlobal, ...global } = await readJsonc(globalFile);
  const project = await readJsonc(projectConfigFile);
  return ConfigSchema.parse(merge(global, project));
}

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

/**
 * Record that the project uses `harnessId` and make it the default. Creates the config file if needed,
 * keeps the user's comments and other settings. A harness new to the
 * project gets `defaults` as its settings; one already there keeps its own.
 */
export async function addHarnessToConfig(
  file: string,
  harnessId: string,
  defaults: Record<string, unknown> = {},
): Promise<void> {
  if (!existsSync(file)) {
    await writeFile(file, projectConfigText(harnessId, defaults), 'utf8');
    return;
  }
  let text = await readFile(file, 'utf8');
  const raw = (parse(text, [], { allowTrailingComma: true }) ?? {}) as Record<string, unknown>;
  const edit = (p: string[], value: unknown) => {
    text = applyEdits(text, modify(text, p, value, FORMAT));
  };
  const harnesses = isObject(raw.harnesses) ? raw.harnesses : undefined;
  if (!harnesses) edit(['harnesses'], { [harnessId]: defaults });
  else if (!(harnessId in harnesses)) edit(['harnesses', harnessId], defaults);
  edit(['defaultHarness'], harnessId);
  await writeFile(file, text, 'utf8');
}
