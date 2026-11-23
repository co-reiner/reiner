/**
 * @file The `messages` mode: replies as a diff, project files quoted in messages instead of uploaded packs,
 * and the instruction sections that say so.
 * @see {@link ../docs/packs.md#the-messages-mode | File exchange: the messages mode}
 */
import { SEARCH_TOOLS_TEXT, TOOL_FORMAT_TEXT } from '@co-reiner/core';

/** The heading of the files section when files come quoted in messages. */
export const TEXT_FILES_HEADING = '## Project files';

/** The files section for the `messages` mode: quoted files, no archives. */
export function textFilesSection(heading: string, deleteHeader: string): string {
  return [
    heading,
    '',
    'Some of my messages begin with a context line such as `[Precise] project=NAME next-patch=NUMBER`. It gives the project name and the number of the next patch. Messages without that line need none of this.',
    '',
    '- My project files come quoted in my messages, each as `File PATH:` followed by a code block. A later copy of a file replaces an earlier one.',
    '- Nothing is attached or uploaded. When you need a file you have not seen, ask for it with a tool call.',
    `- If files should be removed from my project, list them in a separate code block whose first line is \`${deleteHeader}\`, with one relative path per line. Keep them out of diffs.`,
  ].join('\n');
}

/** The tools section for the `messages` mode. */
export function textToolsSection(heading: string): string {
  return [
    heading,
    '',
    TOOL_FORMAT_TEXT,
    '',
    '- `share_files` with `paths` (a list): I quote those files with their current content.',
    '- `share_project`: I send the list of my project files (names only); ask for content with `share_files`.',
    ...SEARCH_TOOLS_TEXT,
  ].join('\n');
}
