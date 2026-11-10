#!/usr/bin/env node
/**
 * @file Proxy entry point: hands straight over to the real CLI in @co-reiner/reiner, whose package must
 * export "./cli" for this to resolve.
 * @see {@link ../../../docs/architecture/tech-stack.md#distribution | Tech stack: distribution}
 */
import '@co-reiner/reiner/cli';
