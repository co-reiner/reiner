/**
 * @file Copies the repository's one LICENSE into the package being packed. Each package runs it as its
 * `prepack` script, because npm only packs files inside the package's own folder. The copies are
 * git-ignored.
 * @see {@link ../AGENTS.md#conventions | Reiner AGENTS.md: conventions}
 */
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../LICENSE', import.meta.url));
// npm and pnpm run prepack in the package's folder.
copyFileSync(source, path.join(process.cwd(), 'LICENSE'));
