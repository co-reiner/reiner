/**
 * @file Public entry point of `@co-reiner/core`: re-exports every module and the Reiner version.
 * @see {@link ../../../docs/architecture/overview.md#layers | Architecture overview: layers}
 */
export * from './chats.ts';
export * from './commands.ts';
export * from './config.ts';
export * from './exchange.ts';
export * from './harness.ts';
export * from './models.ts';
export * from './project.ts';
export * from './state.ts';
export * from './tools/protocol.ts';
export * from './tools/run.ts';
export * from './tools/search.ts';
export * from './tools/tasks.ts';
export * from './tools/text.ts';
export * from './transfer/apply.ts';
export * from './transfer/share.ts';
export * from './transfer/trash.ts';

export const REINER_VERSION = '0.0.1';
