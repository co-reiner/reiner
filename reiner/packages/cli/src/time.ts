/**
 * @file How long ago something happened, in words, for the status line and the views.
 * @see {@link ../../../docs/architecture/cli-ux.md#tui-layout | CLI and TUI: TUI layout}
 */

export function timeAgo(iso: string): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return 'at an unknown time';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
