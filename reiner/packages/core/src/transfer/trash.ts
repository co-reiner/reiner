/**
 * @file Moving files to the system's recycle bin (Windows Recycle Bin, macOS Trash, Linux trash): how a
 * model's deletions are applied, so nothing a model asks to delete is lost for good.
 * @see {@link ../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

export type Trash = (files: string[]) => Promise<void>;

function run(cmd: string, args: string[], env?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, env: { ...process.env, ...env } }, (err, _out, stderr) => {
      if (!err) return resolve();
      // `missing` tells "this command is not installed" from "it ran and failed".
      reject(Object.assign(new Error((stderr || err.message).trim()), { missing: err.code === 'ENOENT' }));
    });
  });
}

/**
 * The PowerShell that recycles on Windows. It never deletes for good:
 * - every path is checked before any is touched: a network share has no Recycle Bin, and a removable or
 *   other non-fixed drive may have none, so those are refused, and nothing is deleted at all;
 * - `AllDialogs`, not `OnlyErrorDialogs`: the latter answers yes to every shell question, including "this
 *   is too big for the Recycle Bin, delete it permanently?". With `AllDialogs` Windows asks the user, and
 *   a no (`ThrowException`) is an error here;
 * - any failure ends with a non-zero exit code, so it is never read as done;
 * - a folder goes to the Recycle Bin as a folder.
 */
const WINDOWS_RECYCLE = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName Microsoft.VisualBasic',
  'try {',
  '  $paths = @($env:REINER_TRASH -split "`n" | Where-Object { $_ })',
  '  foreach ($p in $paths) {',
  '    $root = [System.IO.Path]::GetPathRoot($p)',
  '    if ($root.StartsWith(\'\\\\\')) { throw "$p is on a network share, which has no Recycle Bin. Nothing was deleted." }',
  '    $type = ([System.IO.DriveInfo]::new($root)).DriveType',
  '    if ($type -ne \'Fixed\') { throw "$p is on a $type drive, which may have no Recycle Bin. Nothing was deleted." }',
  '  }',
  '  foreach ($p in $paths) {',
  '    if (Test-Path -LiteralPath $p -PathType Container) {',
  "      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'AllDialogs', 'SendToRecycleBin', 'ThrowException')",
  '    } else {',
  "      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'AllDialogs', 'SendToRecycleBin', 'ThrowException')",
  '    }',
  '  }',
  '} catch {',
  '  [Console]::Error.WriteLine($_.Exception.Message)',
  '  exit 1',
  '}',
].join('\n');

/** Windows: the shell's own "send to Recycle Bin", the same as deleting in Explorer. */
const windowsTrash: Trash = (files) =>
  run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_RECYCLE],
    // Paths go through the environment, one per line, so no quoting can break the command.
    { REINER_TRASH: files.join('\n') },
  );

/** macOS: Finder's own delete, which moves to the Trash. */
const macTrash: Trash = (files) =>
  run('osascript', [
    '-e',
    'on run argv',
    '-e',
    'repeat with p in argv',
    '-e',
    'tell application "Finder" to delete (POSIX file (p as text) as alias)',
    '-e',
    'end repeat',
    '-e',
    'end run',
    ...files,
  ]);

const isMissing = (error: unknown) => (error as { missing?: boolean }).missing === true;

/**
 * Linux: `gio trash` (GNOME and most desktops), else `trash-put` when `gio` is not installed. A command that
 * ran and failed is not retried with the other one: its error is reported with the files that are still
 * there, since it may have moved some of them already.
 */
const linuxTrash: Trash = async (files) => {
  const attempt = async (cmd: string, args: string[]): Promise<'done' | 'missing'> => {
    try {
      await run(cmd, args);
      return 'done';
    } catch (error) {
      if (isMissing(error)) return 'missing';
      const left = files.filter((f) => existsSync(f));
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${cmd} could not move everything to the trash: ${reason}. Still in place: ${left.join(', ') || 'none'}.`,
      );
    }
  };
  if ((await attempt('gio', ['trash', ...files])) === 'done') return;
  if ((await attempt('trash-put', files)) === 'done') return;
  throw new Error('No recycle bin found (`gio trash` or `trash-put`); nothing was deleted.');
};

/**
 * Move files to the recycle bin. Throws when it cannot: a file is never deleted for good instead.
 * Absolute paths only.
 */
export const moveToTrash: Trash = async (files) => {
  if (files.length === 0) return;
  if (process.platform === 'win32') return windowsTrash(files);
  if (process.platform === 'darwin') return macTrash(files);
  return linuxTrash(files);
};
