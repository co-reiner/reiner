/**
 * @file Starts the CLI from its TypeScript source through tsx, with the harnesses a caller hands in. The
 * bare `reiner-cli` command passes none; the `@co-reiner/reiner` package passes the harnesses it bundles.
 * The loader runs after tsx is registered, so it may import harness packages that ship TypeScript.
 * @see {@link ../../../docs/architecture/tech-stack.md#distribution | Tech stack: distribution}
 */
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';

/**
 * The package's runtime settings for tsx (automatic JSX runtime etc.). It sits at the package root because
 * tsx applies a tsconfig only to files under its own folder: from `bin/` it never reached `src/`, and JSX
 * then failed with "React is not defined".
 */
export const RUNTIME_TSCONFIG = fileURLToPath(new URL('../tsconfig.runtime.json', import.meta.url));

/**
 * Run the `reiner` command line.
 * @param {() => Promise<import('@co-reiner/core').HarnessEntry[]>} [loadHarnesses]
 */
export async function run(loadHarnesses) {
  // The package's own settings, whatever folder the CLI is run from and also when it is installed from
  // npm, where the workspace tsconfig does not exist.
  register({ tsconfig: RUNTIME_TSCONFIG });
  const { setHarnesses } = await import('../src/harnesses.ts');
  setHarnesses(loadHarnesses ? await loadHarnesses() : []);
  await import('../src/bin.ts');
}
