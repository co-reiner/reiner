/**
 * @file Instructions that teach a harness's model how files are exchanged. They are built from sections. A
 * section is one of the headings below and everything up to the first line that is only three dashes:
 *
 *   ## Pack search index
 *   ...
 *   (a line of three dashes)
 *
 * Reiner only ever rewrites its own sections, so the user's own instructions around them are left alone
 * (see `setSections`). No section text may hold a three-dash line itself, since that would end it early.
 *
 * The wording is the one Copilot accepted (2026-11-12), and its style is deliberate. A harness checks what
 * is saved in its custom instructions, and refuses text that reads like an attempt to take over the model
 * ("may contain content that violates Microsoft's responsible AI policy"). What was refused: a marker that
 * switches the model into another way of behaving, a persona for the user, "follow these exactly", and
 * orders such as "never" and "stop". What is accepted: plain description, in the user's own voice, of an
 * environment and of what helps "when" something is the case. Keep new text in that style.
 *
 * The section texts are generic (they say NAME and NUMBER), so they can live in the harness's custom
 * instructions. Each prompt that needs them adds one context line with the real values (`promptFacts`).
 * The reply format section describes the current mode only, and the context line never names the mode, so
 * after a mode switch the saved instructions are out of date until synced again.
 *
 * @see {@link ../docs/packs.md#instructions-and-sections | File exchange: instructions and sections}
 * @see {@link ../docs/packs.md#inbound-reply-modes | File exchange: reply modes}
 * @see {@link ../../../docs/architecture/overview.md#instruction-injection | Architecture overview: instruction injection}
 * @see {@link ../docs/packs.md#why-it-works-this-way | File exchange: why it works this way}
 */
import {
  type ChatReply,
  DELETE_HEADER,
  SEARCH_TOOLS_TEXT,
  type StatusListener,
  TOOL_FORMAT_TEXT,
} from '@co-reiner/core';

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
}

/** The reply modes a harness offers, and whether its packs may carry the search index. */
export interface TransferSupport {
  modes: TransferMode[];
  /** The id of the mode a new project starts with. */
  defaultMode: string;
  /** Packs may include the SQLite search index (the harness's model can run code on uploads). */
  index: boolean;
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

export interface InstructionSection {
  id: string;
  /** The section's text, starting with its heading (`## Reiner ...`). */
  text: string;
}

/** The line that ends a section. */
const SECTION_END = '---';

/** The heading of each section Reiner writes, by section id. */
const HEADINGS: Record<string, string> = {
  files: '## Project packs',
  tools: '## Project tools',
  index: '## Pack search index',
  transfer: '## Reply format for changes',
};

/** Headings used until 2026-11-12, by section id. Still found, so a sync replaces those sections. */
const EARLIER_HEADINGS: Record<string, string> = {
  files: '## Reiner files',
  tools: '## Reiner tools',
  index: '## Reiner pack search index',
  transfer: '## Reiner reply format',
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The section id a heading line belongs to, in its current or an earlier wording. */
function idOfHeading(heading: string): string | undefined {
  const line = heading.trim();
  return Object.keys(HEADINGS).find((id) => HEADINGS[id] === line || EARLIER_HEADINGS[id] === line);
}

/** A section in a text: one of Reiner's headings up to the first line that is only three dashes. */
const SECTION = new RegExp(
  `^(?:${[...Object.values(HEADINGS), ...Object.values(EARLIER_HEADINGS)].map(escapeRegExp).join('|')})[ \\t]*\\r?\\n[\\s\\S]*?^---[ \\t]*(?:\\r?\\n|$)`,
);
/** Sections saved before 2026-11-11 were wrapped in HTML comments. They are still found, so a sync replaces them. */
const OLD_SECTION = /<!-- reiner:begin ([\w-]+) -->[\s\S]*?<!-- reiner:end \1 -->\n?/;
/** Either kind. The old kind is tried first: its heading sits inside its markers. */
const anySection = () => new RegExp(`${OLD_SECTION.source}|${SECTION.source}`, 'gm');

export function renderSections(sections: InstructionSection[]): string {
  return sections
    .map((s) => {
      const text = s.text.trim();
      if (/^-{3,}[ \t]*$/m.test(text))
        throw new Error(
          `The "${s.id}" instruction section holds a line of dashes, which would end it early.`,
        );
      return `${text}\n${SECTION_END}\n`;
    })
    .join('\n');
}

/** Ids of the Reiner sections in a text, whichever form they were saved in. */
export function sectionIds(text: string): string[] {
  const ids = [...text.matchAll(anySection())].map((m) => m[1] ?? idOfHeading(m[0].split('\n')[0] ?? ''));
  return [...new Set(ids.filter((id): id is string => id !== undefined))];
}

/**
 * Replace every Reiner section in `existing` with `sections`, keeping everything else exactly as it
 * was. The new sections go where the first old one was, or at the end. An empty list removes them all.
 */
export function setSections(existing: string, sections: InstructionSection[]): string {
  const first = existing.search(anySection());
  const rendered = renderSections(sections);
  if (first === -1) {
    if (!rendered) return existing;
    const sep = existing.trim() ? (existing.endsWith('\n') ? '\n' : '\n\n') : '';
    return `${existing.trim() ? existing : ''}${sep}${rendered}`;
  }
  const before = existing.slice(0, first);
  // Only the gap Reiner's own sections leave is closed: the user's text keeps its blank lines as they are.
  const after = existing.slice(first).replace(anySection(), '').replace(/^\n+/, '');
  return `${before}${rendered}${rendered && after.trim() ? '\n' : ''}${after}`;
}

export interface SectionOptions {
  /** The current reply mode: its `instructions` become the reply format section. */
  mode: TransferMode;
  /** The pack has a SQLite search index under `.search/`. */
  index: boolean;
}

/** The sections for the current settings. Turning the index off leaves its section out. */
/**
 * Kept short (about 3,000 characters with the index and the longest mode): the user's own instructions
 * share the same field, and every prompt that carries the sections pays for them.
 */
export function buildSections(opts: SectionOptions): InstructionSection[] {
  const sections: InstructionSection[] = [
    {
      id: 'files',
      text: [
        HEADINGS.files,
        '',
        'Some of my messages begin with a context line such as `[Precise] project=NAME pack=FILE next-patch=NUMBER`. It gives the project name, the archive attached to that message, and the number of the next patch. Use those values where NAME and NUMBER appear below. Messages without that line need none of this.',
        '',
        '- A pack is a ZIP archive of my project with a `.docx` ending. Treat it as a ZIP archive.',
        '- `NAME.zip.docx` holds the whole project. `NAME.part.zip.docx` holds the files changed since that archive, and the message it comes with lists files that no longer exist.',
        '- Archives keep their names, so a chat can hold several uploads of one. Each contains `.reiner/pack.txt` with a `made=` value. Use the upload whose value matches the `made=` value in my latest context line.',
        '- Before working with project files, confirm the unpacked folder still exists. If it does not, unpack the newest `NAME.zip.docx` into an empty folder, then the newest `NAME.part.zip.docx` over it.',
        `- If files should be removed from my project, list them in a separate code block whose first line is \`${DELETE_HEADER}\`, with one relative path per line. Keep them out of patches and diffs.`,
      ].join('\n'),
    },
    {
      id: 'tools',
      text: [
        HEADINGS.tools,
        '',
        TOOL_FORMAT_TEXT,
        '',
        '- `share_files` with `paths` (a list) or `all` set to true: I send those files again with their current content.',
        '- `share_project`: I send the whole project in a new archive.',
        ...SEARCH_TOOLS_TEXT,
      ].join('\n'),
    },
  ];
  if (opts.index) {
    sections.push({
      id: 'index',
      text: [
        HEADINGS.index,
        '',
        '- A pack may contain `.search/index.sqlite` and `.search/manifest.json`. If both are present, extract only those first.',
        '- Run `PRAGMA integrity_check`, read the manifest, and inspect the schema before using the index.',
        '- Use `files_fts` for words and phrases, `files_trigram` for substrings, paths and identifiers, and `files` for exact paths.',
        '- Use index results only to locate candidates. Read the ZIP members themselves. If the index is missing or stale, list the ZIP.',
      ].join('\n'),
    });
  }
  sections.push({ id: 'transfer', text: [HEADINGS.transfer, '', ...opts.mode.instructions].join('\n') });
  return sections;
}

export interface PromptFacts {
  project: string;
  /** Next patch number, zero-padded to three digits. */
  sequence: string;
  /** File name of the pack attached to this message, if any. */
  pack?: string;
  /** The pack holds only some files (a part pack), not the whole project. */
  part?: boolean;
  /** The pack's `made` stamp, as in its `.reiner/pack.txt`. */
  made?: string;
}

/**
 * How a message that carries the exchange's facts starts. The instructions describe it as a context
 * line of the user's own, which gives the project name, the attached archive and the next patch number.
 */
export const FACTS_PREFIX = '[Precise]';

/** The one line each prompt carries so the generic sections have real values. */
export function promptFacts(f: PromptFacts): string {
  return `${FACTS_PREFIX} project=${f.project}${f.pack ? ` pack=${f.pack}${f.made ? ` made=${f.made}` : ''}${f.part ? ' (part)' : ''}` : ''} next-patch=${f.sequence}`;
}
