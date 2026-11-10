/**
 * @file Formats a harness command's `OutputEntry` items as plain text for `reiner <command>`.
 * @see {@link ../../../../docs/architecture/cli-ux.md#one-shot-reiner-command | CLI and TUI: one-shot commands}
 * @see {@link ../../../../docs/architecture/modules.md#harness-commands | Harness modules: harness commands}
 */
import type { OutputEntry } from '@co-reiner/core';
import { timeAgo } from '../time.ts';
import { groupModels } from '../tui/group.ts';
import { describeSelection } from '../tui/model-text.ts';

/** A harness command's output as plain text lines, for one-shot runs (`reiner <command>`). */
export function formatEntry(entry: OutputEntry): string[] {
  switch (entry.kind) {
    case 'info':
      return [entry.text];
    case 'success':
      return [`✓ ${entry.text}`];
    case 'warning':
      return [`⚠ ${entry.text}`];
    case 'error':
      return [`✗ ${entry.text}`];
    case 'models':
      return formatModels(entry);
    case 'model': {
      const { tone, lines } = describeSelection(entry.result, entry.query);
      const mark = tone === 'success' ? '✓' : tone === 'warn' ? '?' : '✗';
      return lines.map((line, i) => (i === 0 ? `${mark} ${line}` : `  ${line}`));
    }
    case 'model-current': {
      const p = entry.preference;
      return [
        p
          ? `Model for this project: ${p.group ? `${p.group} › ` : ''}${p.label} (chosen ${timeAgo(p.chosenAt)})`
          : 'No model chosen for this project yet.',
      ];
    }
    case 'started':
      return [
        entry.result.signIn.signedIn
          ? `✓ ${entry.harness} is open and signed in.`
          : `● ${entry.harness} is open but not signed in: ${entry.result.signIn.reason}`,
        ...entry.result.notes.map((n) => `  ${n}`),
      ];
    case 'chats':
      return entry.chats.map(
        (c, i) => `${String(i + 1).padStart(2)}. ${c.title || c.id}${c.current ? ' (open)' : ''}`,
      );
    case 'history':
      return entry.turns.flatMap((t) => [`> ${t.prompt}`, t.reply || '(no reply)', '']);
    case 'changes':
      return [`Changes in ${entry.source}:`, ...entry.items.map((i) => `  ${i.action} ${i.path}`)];
    case 'transfer':
      return entry.lines;
  }
}

function formatModels(entry: Extract<OutputEntry, { kind: 'models' }>): string[] {
  const { result } = entry;
  const lines = result.models.length === 0 ? ['No models found.'] : [];
  for (const g of groupModels(result.models)) {
    const indent = g.group ? '  ' : '';
    if (g.group) lines.push(`▸ ${g.group}`);
    for (const m of g.models) {
      lines.push(
        `${indent}${m.selected ? '●' : '○'} ${m.label}${m.description ? `  · ${m.description}` : ''}`,
      );
    }
  }
  lines.push(...result.notes.map((n) => `  ${n}`));
  if (result.debugFile) lines.push(`  Debug dump: ${result.debugFile}`);
  return lines;
}
