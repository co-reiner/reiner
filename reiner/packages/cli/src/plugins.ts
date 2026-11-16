/**
 * @file The plugins this run of the CLI has, and their sessions. The CLI ships none: whoever starts it (the
 * `@co-reiner/reiner` package, or `bin/run.js` with a loader) hands them in, as it hands in the harnesses.
 * @see {@link ../../../docs/architecture/plugins.md | Plugins}
 * @see {@link ../../../docs/architecture/tech-stack.md#distribution | Tech stack: distribution}
 */
import type { PluginContext, PluginSession, ReinerPlugin } from '@co-reiner/core';

let installed: ReinerPlugin[] = [];

/** Set the plugins this run has. */
export function setPlugins(plugins: ReinerPlugin[]): void {
  installed = [...plugins];
}

/** The plugins this run has; empty for the bare CLI. */
export const installedPlugins = (): ReinerPlugin[] => installed;

/** A plugin with its session for this project. */
export interface ActivePlugin {
  plugin: ReinerPlugin;
  session: PluginSession;
}

/** Start each plugin's session; a plugin starts nothing until a method needs it. */
export const startPlugins = (plugins: ReinerPlugin[], ctx: PluginContext): ActivePlugin[] =>
  plugins.map((plugin) => ({ plugin, session: plugin.start(ctx) }));
