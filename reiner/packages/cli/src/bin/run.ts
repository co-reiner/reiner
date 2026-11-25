/**
 * @file `reiner <command> [args]`: runs one of the active harness's commands, or a plugin's (`reiner mcp`),
 * once, as text or `--json`, asking y/N on the terminal.
 * @see {@link ../../../../docs/architecture/cli-ux.md#one-shot-reiner-command | CLI and TUI: one-shot commands}
 * @see {@link ../../../../docs/architecture/modules.md#harness-commands | Harness modules: harness commands}
 */
import { createInterface } from 'node:readline/promises';
import type { HarnessModule, OutputEntry, PickOption, PluginCommandHost } from '@co-reiner/core';
import type { Session } from '../session.ts';
import { newChecksState } from '../tui/checks.ts';
import { commandHost } from '../tui/commands/host.ts';
import { type GlobalFlags, oneShot, program, status } from './context.ts';
import { formatEntry } from './print.ts';

/** Ask y/N on the terminal; without one (piped, scripted) the answer is no. */
async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y$/i.test((await rl.question(`? ${question} (y/N) `)).trim());
  } finally {
    rl.close();
  }
}

/**
 * Let the user tick options on the terminal: a numbered list, then "1,3", "all", "none", or Enter. Enter keeps
 * the rows in `ticked` (none when it is not given). Without a terminal nothing is picked.
 */
async function askPick(question: string, options: PickOption[], ticked: number[] = []): Promise<number[]> {
  if (!process.stdin.isTTY || options.length === 0) return ticked;
  options.forEach((o, i) => {
    const mark = ticked.includes(i) ? '[x]' : '[ ]';
    console.error(`  ${String(i + 1).padStart(2)}. ${mark} ${o.label}${o.detail ? `  · ${o.detail}` : ''}`);
  });
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (
      await rl.question(`? ${question} Numbers (e.g. 1,3), "all", "none", or Enter to keep: `)
    ).trim();
    if (answer === '') return ticked;
    if (/^all$/i.test(answer)) return options.map((_, i) => i);
    const picked = answer
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length);
    return [...new Set(picked.map((n) => n - 1))].sort((a, b) => a - b);
  } finally {
    rl.close();
  }
}

/**
 * `reiner <command> [args]`: run one of the active harness's slash commands once, e.g. `reiner login`,
 * `reiner models --debug` or `reiner model sol quick`, then close the browser. `--json` prints the output
 * as data instead of text. The commands come from the harness module, so what exists depends on it.
 */
export async function runHarnessCommand(words: string[]): Promise<void> {
  // `--json` is one of Reiner's own flags, so commander has already taken it out of `words`.
  const json = program.opts<GlobalFlags>().json === true;
  const [name = '', ...args] = words;
  await oneShot(async (module, session) => {
    const command = module.commands?.find((c) => c.name === name.toLowerCase());
    const plugin = command ? undefined : pluginCommand(session, name.toLowerCase());
    if (!command && !plugin) {
      const names = [...(module.commands ?? []), ...pluginCommands(session)].map((c) => c.name).join(', ');
      throw new Error(`${module.displayName} has no command "${name}". Its commands: ${names || 'none'}.`);
    }
    const out: OutputEntry[] = [];
    const print = (entry: OutputEntry) => {
      out.push(entry);
      if (!json) for (const line of formatEntry(entry)) console.log(line);
    };
    if (command) await command.run(oneShotHost(session, module, print), args);
    else if (plugin) {
      await plugin.command.run(plugin.session, oneShotPluginHost(module, print), args);
    }
    if (json) console.log(JSON.stringify(out, null, 2));
    if (out.some((e) => e.kind === 'error')) process.exitCode = 1;
  });
}

/** The commands the plugins bring (`reiner mcp`), with the plugin session that runs each. */
function pluginCommands(session: Session) {
  return session.plugins.flatMap((p) =>
    (p.plugin.commands ?? []).map((command) => ({ ...command, session: p.session })),
  );
}

function pluginCommand(session: Session, name: string) {
  const found = pluginCommands(session).find((c) => c.name === name);
  return found ? { command: found, session: found.session } : undefined;
}

function oneShotPluginHost(module: HarnessModule, print: (entry: OutputEntry) => void): PluginCommandHost {
  return {
    harnessName: module.displayName,
    print: (entry) => print(entry as OutputEntry),
    busy: (label) => {
      if (label) status(label);
    },
    confirm: askYesNo,
    choose: async (question, options, ticked) =>
      process.stdin.isTTY ? askPick(question, options, ticked) : undefined,
  };
}

function oneShotHost(session: Session, module: HarnessModule, print: (entry: OutputEntry) => void) {
  return commandHost(
    {
      session,
      checks: newChecksState(),
      // The CLI's own entry kinds never come from a harness command; print the harness's ones as text.
      print: (entry) => print(entry as OutputEntry),
      busy: (label) => {
        if (label) status(label);
      },
      confirm: askYesNo,
      pick: askPick,
      setSignIn: () => {},
      setChat: (chat) => void session.rememberOpenChat(chat),
    },
    module,
  );
}
