#!/usr/bin/env node
/**
 * @file The bare CLI with no harness: `reiner-cli`. Install `@co-reiner/reiner` for the CLI with its harnesses.
 * @see {@link ../../../docs/architecture/tech-stack.md#distribution | Tech stack: distribution}
 */
import { run } from './run.js';

await run();
