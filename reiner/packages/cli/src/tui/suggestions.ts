/**
 * @file The suggestion list under the prompt: commands, and model or chat names for commands that ask.
 * @see {@link ../../../../docs/architecture/cli-ux.md#keys | CLI and TUI: keys}
 * @see {@link ../../../../docs/architecture/cli-ux.md#harness-commands | CLI and TUI: harness commands}
 */
import {
  type ChatInfo,
  type HarnessModule,
  type ModelInfo,
  type ModelPreference,
  matchChats,
  matchModels,
} from '@co-reiner/core';
import { commandsFor, matchCommands, type SlashCommand } from './commands.ts';

/** One row in the list under the prompt. */
export interface Suggestion {
  key: string;
  /** Put in the prompt by Tab, for further editing. */
  complete: string;
  /** Submitted by Enter. */
  run: string;
  label: string;
  detail?: string;
  current?: boolean;
}

export interface SuggestionSources {
  input: string;
  models: ModelInfo[];
  preference: ModelPreference | undefined;
  chats: ChatInfo[];
  openChat: ChatInfo | undefined;
  module: HarnessModule | null;
}

/** Suggestions under the prompt: argument values for commands that declare them, or command names. */
export function buildSuggestions(src: SuggestionSources): Suggestion[] {
  const typed = /^\/(\S+)\s+(.*)$/.exec(src.input);
  if (typed) {
    const name = typed[1]?.toLowerCase() ?? '';
    const query = typed[2] ?? '';
    const command = commandsFor(src.module).find((c) => c.name === name);
    if (command?.complete === 'chat') return chatSuggestions(src, name, query);
    if (command?.complete === 'model') return modelSuggestions(src, name, query);
    if (command?.choices) return choiceSuggestions(command, query);
    return [];
  }
  return matchCommands(src.input, src.module).map((c) => ({
    key: c.name,
    complete: `/${c.name} `,
    run: `/${c.name}`,
    label: `/${c.name}`,
    detail: c.scope === 'harness' ? c.description : `${c.description} (global)`,
  }));
}

/**
 * A command's fixed argument values that start with what is typed (e.g. /transfer's modes). With nothing
 * typed yet, the bare command comes first, so Enter still runs it as it is instead of picking a value.
 */
function choiceSuggestions(command: SlashCommand, query: string): Suggestion[] {
  const typed = query.trimStart().toLowerCase();
  const values = (command.choices?.() ?? [])
    .filter((c) => c.value.toLowerCase().startsWith(typed))
    .map((c) => ({
      key: `${command.name}:${c.value}`,
      complete: `/${command.name} ${c.value}`,
      run: `/${command.name} ${c.value}`,
      label: c.value,
      ...(c.detail ? { detail: c.detail } : {}),
    }));
  if (typed || values.length === 0) return values;
  const bare = {
    key: command.name,
    complete: `/${command.name} `,
    run: `/${command.name}`,
    label: `/${command.name}`,
  };
  return [{ ...bare, detail: command.description }, ...values];
}

/** Chat titles, for commands whose argument is a chat (e.g. /chat, /delete). */
function chatSuggestions(
  { chats, openChat }: SuggestionSources,
  command: string,
  query: string,
): Suggestion[] {
  const found = (query.trim() ? matchChats(chats, query) : chats).slice(0, 8);
  return found.map((c) => ({
    key: c.id,
    complete: `/${command} ${c.title}`,
    run: `/${command} ${c.id}`,
    label: c.title || c.id,
    ...(c.id === openChat?.id ? { current: true } : {}),
  }));
}

/** Model names, for commands whose argument is a model (e.g. /model). */
function modelSuggestions(
  { models, preference }: SuggestionSources,
  command: string,
  query: string,
): Suggestion[] {
  const found = (query.trim() ? matchModels(models, query) : models).slice(0, 8);
  return found.map((m) => ({
    key: m.id,
    complete: `/${command} ${m.label}`,
    run: `/${command} ${m.label}`,
    label: m.label,
    ...(m.group ? { detail: m.group } : {}),
    // The project's saved model is what the harness gets re-set to, so it counts as current.
    // The cached `selected` flag can be out of date; use it only when no model was chosen.
    ...((preference ? preference.id === m.id : m.selected) ? { current: true } : {}),
  }));
}
