/**
 * @file Tests for reading a reply written in plain words: whole files, the files asked for, web results.
 * @see {@link ../docs/file-exchange.md#what-comes-back | Google Search file exchange: what comes back}
 */
import { describe, expect, it } from 'vitest';
import { extractNeededFiles, extractWholeFiles, isWebResults } from '../src/exchange/reply-files.ts';

const fence = '```';

describe('extractWholeFiles', () => {
  it('reads a file under a "File:" line, with blank lines before the block', () => {
    const reply = `Done.\n\nFile: src/words.js\n\n${fence}javascript\nexport const a = 1;\n${fence}\n\nAnything else?`;
    expect(extractWholeFiles(reply)).toEqual([{ path: 'src/words.js', text: 'export const a = 1;\n' }]);
  });

  it('reads a decorated line, and keeps the last block for a path', () => {
    const reply = [
      '**File: `./src/a.js`**',
      `${fence}js`,
      'one',
      fence,
      'File: src/a.js',
      fence,
      'two',
      fence,
    ].join('\n');
    expect(extractWholeFiles(reply)).toEqual([{ path: 'src/a.js', text: 'two\n' }]);
  });

  it('leaves diff blocks and unnamed blocks alone', () => {
    const reply = `File: a.js\n${fence}diff\n--- a/a.js\n${fence}\n\n${fence}js\nconst x = 1;\n${fence}`;
    expect(extractWholeFiles(reply)).toEqual([]);
  });
});

describe('extractNeededFiles', () => {
  it('reads a list of paths under "Files needed:"', () => {
    const reply =
      'I need a look first.\n\nFiles needed:\n\n- `src/slug.js`\n- tests/slug.test.js\n\nThen I can help.';
    expect(extractNeededFiles(reply)).toEqual(['src/slug.js', 'tests/slug.test.js']);
  });

  it('reads paths in a code block, and stops at prose', () => {
    const reply = `**Files needed:**\n${fence}\nsrc/a.js\n${fence}\nThanks for sharing these files`;
    expect(extractNeededFiles(reply)).toEqual(['src/a.js']);
  });

  it('gives nothing without the line', () => {
    expect(extractNeededFiles('Please share src/a.js')).toEqual([]);
  });
});

describe('isWebResults', () => {
  it('spots a reply that is only web results', () => {
    expect(isWebResults('10 sites\n\n#### Here are top web results for exploring this topic:\n\n…')).toBe(
      true,
    );
    expect(isWebResults('Here are top web results for exploring this topic:')).toBe(true);
  });

  it('does not flag an ordinary reply', () => {
    expect(isWebResults('You can update slug() like this.')).toBe(false);
  });
});
