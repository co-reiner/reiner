/**
 * @file Tests the logo: Unicode detection per terminal, and the banner's Unicode and ASCII forms.
 * @see {@link ../../../docs/architecture/cli-ux.md#logo | CLI and TUI: logo}
 */
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { LOGO_MARK, LOGO_MARK_ASCII, logoMark, supportsUnicode } from '../src/logo.ts';
import { Banner } from '../src/tui/views/Session.tsx';
import { setup } from './support/tui.ts';

describe('logo', () => {
  it('uses Unicode on Unix terminals, but not the Linux console', () => {
    expect(supportsUnicode({ TERM: 'xterm-256color' }, 'darwin')).toBe(true);
    expect(supportsUnicode({ TERM: 'linux' }, 'linux')).toBe(false);
  });

  it('uses Unicode on Windows only in newer terminals', () => {
    expect(supportsUnicode({}, 'win32')).toBe(false);
    expect(supportsUnicode({ WT_SESSION: 'x' }, 'win32')).toBe(true);
    expect(supportsUnicode({ TERM_PROGRAM: 'vscode' }, 'win32')).toBe(true);
  });

  it('picks the one-line mark for the terminal', () => {
    expect(logoMark(true)).toBe(LOGO_MARK);
    expect(logoMark(false)).toBe(LOGO_MARK_ASCII);
  });

  it('shows the block banner on Unicode terminals and the ASCII mark elsewhere', async () => {
    const { session } = await setup(1);
    const unicode = render(<Banner session={session} unicode />).lastFrame() ?? '';
    expect(unicode).toContain('█▀▀▄━━━◆━━━❯');
    expect(unicode).toMatch(/▀ {2}▀ {2}reiner v/);
    const ascii = render(<Banner session={session} unicode={false} />).lastFrame() ?? '';
    expect(ascii).toContain('R-o-># reiner v');
    expect(ascii).not.toContain('█');
  });
});
