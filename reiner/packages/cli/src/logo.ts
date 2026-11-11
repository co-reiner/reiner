/**
 * @file The Reiner logo in its three forms (block banner, one-line mark, ASCII mark) and the check that
 * picks Unicode or ASCII for the current terminal.
 * @see {@link ../../../docs/architecture/cli-ux.md#logo | CLI and TUI: logo}
 */

/** The block banner: an R whose leg runs out as a rein, through the bit, to the prompt. */
export const LOGO_BANNER = ['█▀▀▄', '█▀▀▄━━━◆━━━❯', '▀  ▀  reiner'] as const;

/** The one-line mark for Unicode terminals. */
export const LOGO_MARK = 'R━◆━❯█';

/** The one-line mark for terminals without Unicode. */
export const LOGO_MARK_ASCII = 'R-o->#';

/**
 * Whether the terminal can draw the Unicode logo. Unix terminals can, except the Linux console; on
 * Windows only the newer terminals can (Windows Terminal, VS Code, ConEmu, Alacritty and similar), not
 * the legacy console host.
 */
export function supportsUnicode(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
  if (platform !== 'win32') return env.TERM !== 'linux';
  return (
    Boolean(env.WT_SESSION) ||
    Boolean(env.TERMINUS_SUBLIME) ||
    env.ConEmuTask === '{cmd::Cmder}' ||
    env.TERM_PROGRAM === 'vscode' ||
    env.TERM === 'xterm-256color' ||
    env.TERM === 'alacritty' ||
    env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
  );
}

/** The one-line mark for this terminal. */
export function logoMark(unicode = supportsUnicode()): string {
  return unicode ? LOGO_MARK : LOGO_MARK_ASCII;
}
