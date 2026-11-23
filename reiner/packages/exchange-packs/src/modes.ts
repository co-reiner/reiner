/**
 * @file Reply modes: how the model sends changes back (and, for the `messages` mode, how files go out), what
 * a harness offers, and the modes this package brings (`diff`, `messages`, `download`).
 * @see {@link ../docs/packs.md#inbound-reply-modes | File exchange: reply modes}
 * @see {@link ../docs/packs.md#the-messages-mode | File exchange: the messages mode}
 */
import type { ChatReply, StatusListener } from '@co-reiner/core';

/** What a reply mode is given to collect its changes from a reply. */
export interface CollectContext {
  /** The project's name, as in pack and patch file names. */
  project: string;
  /** Where received files are saved (`.reiner/incoming/`). */
  incomingDir: string;
  onStatus?: StatusListener;
}

/**
 * How the model sends file changes back. A harness lists the modes it offers; `/transfer` switches. A mode
 * owns everything that is particular to it: the text that tells the model what to do, and how its files
 * are fetched. So a harness adds a mode of its own without touching this package (Copilot's `onedrive`).
 */
export interface TransferMode {
  id: string;
  label: string;
  description: string;
  /**
   * The lines of the "Reiner reply format" section for this mode: plain text, generic (NAME for the
   * project, NUMBER for the patch number), and never a line of three dashes.
   */
  instructions: string[];
  /**
   * Fetch this mode's files for a reply: the saved local paths, read afterwards as change sets, and notes
   * for the user. Absent when the changes are in the reply text itself.
   */
  collect?(reply: ChatReply, ctx: CollectContext): Promise<{ files: string[]; notes: string[] }>;
  /**
   * How project files go to the model in this mode: in uploaded packs (the default), or quoted in the
   * messages themselves, with nothing uploaded (`text`, the `messages` mode).
   */
  outbound?: 'upload' | 'text';
}

/** The reply modes a harness offers, and whether its packs may carry the search index. */
export interface TransferSupport {
  modes: TransferMode[];
  /** The id of the mode a new project starts with. */
  defaultMode: string;
  /** Packs may include the SQLite search index (the harness's model can run code on uploads). */
  index: boolean;
  /** The most characters of quoted files one message carries in the `messages` mode. */
  textLimit?: number;
}

export const DIFF_MODE: TransferMode = {
  id: 'diff',
  label: 'git diff in the reply',
  description: 'The model replies with a unified git diff in a code block; Reiner applies it with git apply.',
  instructions: [
    'When I ask for changes to project files, provide them as one code block labelled `diff`, in `git diff` format.',
    '',
    '- Start each file with a `diff --git` header naming `a/PATH` and `b/PATH`, with paths relative to the project root, 3 context lines and correct `@@` hunk headers.',
    '- For a new file, use `new file mode 100644` with `/dev/null` as the old side.',
    '- Files to remove go in the `#To delete (only to a bin):` block, not in the diff.',
  ],
};

/**
 * The `messages` mode: nothing is uploaded. Project files go quoted in the messages, and changes come back
 * as a diff in the reply, as in `diff`. For accounts where uploads do not work.
 */
export const MESSAGES_MODE: TransferMode = {
  id: 'messages',
  label: 'files quoted in messages, git diff in the reply',
  description:
    'Nothing is uploaded: project files are quoted in the messages, and the model replies with a git diff that Reiner applies.',
  instructions: DIFF_MODE.instructions,
  outbound: 'text',
};

/** Saves the named download links of the newest reply into a folder; a harness's own page work. */
export type DownloadLinks = (
  dir: string,
  /** Without `names`: every file the newest reply offers. */
  opts: { names?: string[]; onStatus?: StatusListener },
) => Promise<string[]>;

/**
 * The `download` mode: the model links a patch file in its reply (`ChatReply.downloads`) and the harness
 * clicks the link. A harness that can do that offers the mode with its own `download`.
 */
export function downloadMode(download: DownloadLinks): TransferMode {
  return {
    id: 'download',
    label: 'patch file as a download link',
    description:
      'The model creates a .patch file (git diff --binary) or a ZIP of changed files and links it; Reiner clicks the link and applies the file.',
    instructions: [
      'When I ask for changes to project files, provide them as a patch file with a download link.',
      '',
      '- Preferred: `NAME.patch.NUMBER.patch`, made with `git diff --cached --binary HEAD` after committing the unpacked project and staging the changes.',
      '- Without git: a ZIP named `NAME.patch.NUMBER.zip` containing only changed and newly added files, with paths relative to the project root.',
      '- Files to remove go in the `#To delete (only to a bin):` block, not in the ZIP.',
    ],
    async collect(reply, ctx) {
      // No list (a reply read back from the history): take what the newest reply in the page offers.
      if (reply.downloads?.length === 0) return { files: [], notes: [] };
      const files = await download(ctx.incomingDir, {
        ...(reply.downloads ? { names: reply.downloads } : {}),
        ...(ctx.onStatus ? { onStatus: ctx.onStatus } : {}),
      });
      return { files, notes: [] };
    },
  };
}
