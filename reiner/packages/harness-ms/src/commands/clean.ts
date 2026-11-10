/**
 * @file `/transfer clean`: tick this project's old packs in Copilot's uploads and move them to the
 * OneDrive recycle bin.
 * @see {@link ../../docs/commands.md#transfer-clean | Copilot's slash commands: /transfer clean}
 * @see {@link ../../docs/file-exchange.md#packs-zipdocx | Copilot file exchange: packs}
 */
import path from 'node:path';
import type { CommandHost } from '@co-reiner/core';
import { status } from './shared.ts';
import type { ChatHarness } from './types.ts';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What a file in the uploads is, if it is one of this project's packs. */
export function packKind(project: string, name: string): string | undefined {
  const p = escapeRegExp(project);
  if (new RegExp(`^${p}\\.zip\\.docx$`, 'i').test(name)) return 'the current full pack';
  if (new RegExp(`^${p}\\.zip \\d+\\.docx$`, 'i').test(name)) return 'a renamed duplicate upload';
  if (new RegExp(`^${p}\\.\\d{8}-\\d{6}\\.zip\\.docx$`, 'i').test(name)) return 'an older full pack';
  if (new RegExp(`^${p}\\.part\\.zip\\.docx$`, 'i').test(name)) return 'the current part pack';
  if (new RegExp(`^${p}\\.part(\\.\\d{3})?\\.zip( \\d+)?\\.docx$`, 'i').test(name))
    return 'an older part pack';
  return undefined;
}

/** List this project's packs in the uploads, let the user tick them, and move the ticked ones. */
export async function cleanUploads(host: CommandHost, self: ChatHarness): Promise<void> {
  if (!self.uploads) {
    host.print({ kind: 'info', text: `${self.displayName} keeps no uploads to clean.` });
    return;
  }
  const project = path.basename(path.resolve(host.projectRoot));
  const ours = (await self.uploads.list({ onStatus: status(host) }))
    .filter((n) => packKind(project, n))
    .sort();
  if (ours.length === 0) {
    host.print({ kind: 'info', text: `No packs of ${project} in Copilot's uploads.` });
    return;
  }
  host.busy(null);
  const chosen = await host.pick(
    `Move which of ${project}'s packs to the OneDrive recycle bin?`,
    ours.map((n) => ({ label: n, detail: packKind(project, n) ?? '' })),
  );
  if (chosen.length === 0) {
    host.print({ kind: 'info', text: 'Nothing removed.' });
    return;
  }
  const names = chosen.map((i) => ours[i]).filter((n): n is string => n !== undefined);
  const result = await self.uploads.remove(names, { onStatus: status(host) });
  host.log(`uploads removed: ${result.removed.join(', ') || 'none'}`);
  host.print({
    kind: 'success',
    text: `Moved ${result.removed.length} file${result.removed.length === 1 ? '' : 's'} to the OneDrive recycle bin (recoverable there until OneDrive empties it).`,
  });
  if (result.notFound.length)
    host.print({ kind: 'info', text: `Not found any more: ${result.notFound.join(', ')}.` });
}
