/**
 * @file Tests which patch files a Copilot reply names, for the `onedrive` reply mode.
 * @see {@link ../docs/file-exchange.md#reply-modes | Copilot file exchange: reply modes}
 */
import { describe, expect, it } from 'vitest';
import { namedPatches } from '../src/copilot/transfer.ts';

describe('namedPatches', () => {
  it('finds the patch a reply names, once each', () => {
    const reply = 'Saved **test01.patch.002.zip.docx**. Apply test01.patch.002.zip.docx when ready.';
    expect(namedPatches(reply, 'test01')).toEqual(['test01.patch.002.zip.docx']);
  });

  it('finds a patch OneDrive renamed because the name was taken', () => {
    const reply = '### my-project.patch.001.zip 3.docx\n\nThe comments now document state ownership.';
    expect(namedPatches(reply, 'my-project')).toEqual(['my-project.patch.001.zip 3.docx']);
  });

  it("ignores other projects' patches and other files", () => {
    const reply = 'other.patch.001.zip.docx, test01.zip.docx, test01.patch.1.zip.docx, test01.patch.001.zip';
    expect(namedPatches(reply, 'test01')).toEqual([]);
  });
});
