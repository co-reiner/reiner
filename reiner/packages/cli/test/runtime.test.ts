/**
 * @file Tests that the CLI's own runtime settings for tsx compile its JSX, as `reiner` runs it from source.
 * @see {@link ../../../docs/architecture/tech-stack.md#distribution | Tech stack: distribution}
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error run.js is plain JavaScript without type declarations
import { RUNTIME_TSCONFIG } from '../bin/run.js';

describe('runtime tsconfig', () => {
  it('applies the automatic JSX runtime to src/, outside vitest', () => {
    const reply = new URL('../src/tui/views/Reply.tsx', import.meta.url).href;
    const script = [
      "import { register } from 'tsx/esm/api';",
      `register({ tsconfig: ${JSON.stringify(RUNTIME_TSCONFIG)} });`,
      `const { AssistantReply } = await import(${JSON.stringify(reply)});`,
      "const el = AssistantReply({ markdown: 'hi', harness: 'X' });",
      'console.log(typeof el.type);',
    ].join('\n');
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('object');
  });
});
