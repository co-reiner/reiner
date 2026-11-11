# File exchange by packs

How a harness that takes uploads exchanges files with its model: the project goes up as one pack, the
model's changes come back as a diff or a patch file. This is the `@co-reiner/exchange-packs` package. A
harness creates one exchange (`createPackExchange`), offers its reply modes, and hands it to the host as
its `HarnessModule.exchange` ([modules.md](../../../docs/architecture/modules.md#file-exchange)).

It is one way of exchanging files, not the only one. What every exchange must obey (what may leave the
machine, where a change may land, applying after a y/N) is core's, in
[file-exchange.md](../../../docs/architecture/file-exchange.md); the search tools `glob` and `grep` are core's too.

Example: Microsoft 365 Copilot, the first harness that uses it, is in
[packages/harness-ms/docs/file-exchange.md](../../harness-ms/docs/file-exchange.md).

## Why it works this way

- The user's own workflow was to pack git's files into a `.zip.docx` with a search index and get patches
  back through a synced OneDrive folder. Reiner packs the project itself and uploads it through the
  harness's own control, so no OneDrive client or Python is needed.
- Harnesses return files in different ways, so each lists its reply modes and `/transfer` switches
  between them. For Copilot, OneDrive is one of three ways back, not a component of its own (this replaced
  an earlier idea of a separate OneDrive add-on).
- The instructions that teach the model must sit next to the user's own without clobbering them, hence
  marked sections that Reiner alone rewrites.
- Every change is listed and confirmed before it touches the project.
- Tools exist because after a sandbox reset the model asked in plain text for files again: with tools it
  recovers without the user. `share_files` and `glob`/`grep` need no prompt because they cannot widen what
  the chat may see (only files a pack could hold); `share_project` widens it, so it asks each time.

## Outbound: packs

`/pack` zips the project's files into `.reiner/outgoing/`, and the next prompt uploads the pack through
the harness's own upload control (`send(prompt, { attachments })`). The files are the ones git knows:
tracked files plus new files it does not ignore (`git ls-files --cached --others --exclude-standard`), so
a file not added yet still reaches the model. They pass the share rules below. **Outside a git repository
nothing is packed or searched** (since 2026-11-10; before, a folder walk sent every file, `.env`
included): the user is told to run `git init`.

There are two kinds of pack:

- **Full pack** `<project>.zip.docx`: the whole project, always under the same name, so a harness that
  keeps uploads can replace the earlier copy rather than keep one per refresh (see the next section).
- **Part pack** `<project>.part.zip.docx`: **every file changed since the chat's full pack** (full
  content, not diffs) and `.reiner/deleted.txt` listing files deleted since, one path per line
  (`.reiner/` is never a project file, so the name cannot collide). It is cumulative, so the newest part
  alone is enough on top of the full pack, and it keeps one name like the full pack. The facts line marks
  it `pack=<file> (part)`, and the prompt names what it builds on and the files that are gone (the model
  is not told about the list in the pack; see [the delete block](#instructions-and-sections)). (`share_files` in a
  chat without the whole project also sends a part pack, of files that chat has seen.)
- `.patch.` names are only for files the model creates (patches coming back), never for packs.
- The `.zip.docx` ending is core's default, chosen for Copilot's upload rules
  ([why](../../harness-ms/docs/file-exchange.md#packs-zipdocx)); the model is told packs are ZIPs.
- **Search index** (on by default where the harness allows it, `/transfer index on|off`, per harness):
  `.search/index.sqlite` with FTS5 tables `files_fts` (words) and `files_trigram` (substrings), plus
  `.search/manifest.json`. The layout matches `Pack-GitFiles.ps1 -AddIndex` (index schema 4, manifest
  schema 3). It is built with Node's own `node:sqlite`, so no Python is needed. A harness allows it with
  `TransferSupport.index` (its model can run code on uploads).
  The index does not hold every packed file (`exchange-packs/src/search-index.ts`); the pack itself always
  does. Left out of the index:
  - files that are not a known text type: only `.cs .cshtml .config .css .csv .graphql .htm .html .ini .js
    .json .jsx .md .mjs .cjs .props .ps1 .psd1 .psm1 .py .razor .scss .sln .sql .svg .targets .toml .ts
    .tsx .txt .xml .yaml .yml` are indexed, plus a few named files (`.editorconfig`, `.gitignore`,
    `.gitattributes`, `.npmrc`, `.eslintrc`, `.eslintignore`, `.prettierrc`, `.prettierignore`,
    `Dockerfile`, `Makefile`). So `.go`, `.rs`, `.java`, `.sh` or `.vue` files are packed but not indexed;
  - files over 10 MB;
  - anything with a folder named `.git`, `.next`, `bin`, `build`, `coverage`, `dist`, `node_modules`,
    `obj`, `packages` or `storybook-static` in its path. In a workspace that keeps its code under
    `packages/`, such as this repository, that is most of the code.
    These lists follow `Pack-GitFiles.ps1`. The model can still unpack the ZIP and search the files it
    holds, and `glob` and `grep` search the project itself, without the index.

### Keeping the project current

Like re-running a pack script before each question, Reiner keeps the project in a chat up to date once the
chat has it. A chat has the project after a full pack went to it (`/pack`, or an approved
`share_project`). Before each prompt you send in such a chat, Reiner compares the project with what the
chat has (`projectSnapshot`: each file's path, size and modified time) and sends one of these, saying why
in the TUI:

- **A full pack**, when the chat has been idle longer than `staleMinutes` (a harness setting, default 10:
  [project-config.md](../../../docs/architecture/project-config.md#harness-settings)), even if nothing changed, since the harness's
  sandbox may have dropped its unpacked files; also for a chat recorded before snapshots were kept.
- **A part pack**, when files were added, saved or deleted since what the chat has: everything changed
  since its full pack, plus the deleted list (see above).
- **Nothing**, when the chat already has the current project.

The model is told: unpack the newest full pack, then the newest part pack over it, and remove the files
the message says are gone. Packs keep their names, and a harness that keeps uploads replaces the earlier
copy so they do not pile up (`HarnessModule.uploads`; Copilot moves it to the OneDrive recycle bin first:
[why and how](../../harness-ms/docs/file-exchange.md#packs-zipdocx)).

- **Recorded per chat** in `transfer.json`: `primary` (the full pack's name, digest and snapshot, and
  `seen`, the digest of what the chat has now) and `lastSent` (when its last prompt went).
- Chats that never had a full pack are left alone: nothing is sent to them without a `/pack` or a y/N.

## Inbound: reply modes

A reply mode is how the model sends changes back. Each harness lists the modes it offers in a
`TransferSupport` (`modes`, `defaultMode`) that it hands to the pack exchange; `/transfer <mode>` switches
between them, and a harness with one mode has no switch.

A mode owns everything particular to it (`TransferMode` in `exchange-packs/src/instructions.ts`): its id
and label, the `instructions` lines that tell the model what to send, and an optional `collect` that
fetches its files for a reply. So a harness adds a mode of its own without changing this package.

`exchange-packs` brings two modes a harness that takes uploads can offer:

| Mode       | The model…                                                                                                                                                    | Reiner…                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diff`     | Replies with one fenced `diff` block in `git diff` format                                                                                                     | Runs `git apply --recount` (checks first)                                                                                                                             |
| `download` | Creates `<project>.patch.<NNN>.patch` (`git diff --binary`), or a plain ZIP of changed and new files, and links it; files to delete go in the To delete block | Has the harness save the reply's download links and applies the file. The harness makes the mode with `downloadMode(save)`, passing its own way of clicking the links |

Example of a harness's own mode: Copilot's `onedrive`, which reads the patch from OneDrive's page
([packages/harness-ms/docs/file-exchange.md](../../harness-ms/docs/file-exchange.md#reply-modes)).

A diff found in a reply is offered in every mode, because models sometimes answer that way anyway. For
the same reason, files a reply offers are taken in every mode: a mode that fetches nothing itself
(`diff`) uses the `download` mode's way, when the harness offers that mode (since 2026-11-12).

## Instructions and sections

The model learns the protocol from instruction sections. A section is one of Reiner's headings and
everything up to the first line that is only three dashes:

```markdown
## Pack search index

## ...
```

The headings are `## Project packs`, `## Project tools`, `## Pack search index` and
`## Reply format for changes`.

- **The wording is the one Copilot accepted (2026-11-12).** Copilot checks what is saved in its custom
  instructions and refuses some texts ("Your instructions may contain content that violates Microsoft's
  responsible AI policy"). Three earlier versions were refused: sections between HTML comment markers with
  `<project>` placeholders; a plain version that named the deleted-files list; and one that told the
  model the user was "writing as a precise person" whose instructions were to be followed exactly. The
  accepted one describes, in the user's own voice, what a context line means and what helps when something
  is the case, in the style of ordinary notes. Which words the check objects to is not known for certain
  (an unrelated one-line addition has also been refused), so the text is pinned by a test
  (`test/fixtures/accepted-instructions.txt`): change it only together with a live `/instructions sync`.
- **The context line.** The `files` section says that some of the user's messages begin with a context
  line such as `[Precise] project=NAME pack=FILE next-patch=NUMBER`, and what its values are. That is the
  facts line every exchange message starts with.
- **Files to delete come back in a block of their own.** The model is asked to list them in a separate
  code block whose first line is `#To delete (only to a bin):`, one relative path per line, and to keep
  them out of patches and diffs. The exchange reads that block from the reply (`extractDeletions` in core)
  and offers it as a change set of deletions, after the other changes; they only ever go to the recycle
  bin. A patch that still carries a deleted-files list, or a diff that deletes a file, is read as before.
- **The first line of three dashes ends a section**, so no section may hold one: `renderSections` refuses
  a text that does.
- **Earlier forms are still found**, so the next `/instructions sync` replaces them: sections under the
  `## Reiner …` headings, and sections between `<!-- reiner:begin … -->` comment markers.
- Sections: `files` (what packs are), `tools` (the tool call format and the four tools), `index` (only
  when the index is on), `transfer` (the reply format of the current mode only; the other modes are never
  described, so the model has nothing to choose between).
- The texts are generic (they say NAME for the project and NUMBER for the patch number). Each prompt that needs them starts with one facts line:
  `[Precise] project=test01 pack=test01.zip.docx made=20261110-134331 next-patch=004`. It never names the
  mode (since 2026-11-10): the `transfer` section the model has is the only reply format it knows.
- `setSections(text, sections)` replaces only Reiner's own sections and leaves the rest alone, blank lines
  included.
- Keep the sections short: near 3,000 characters together (with four tools and the index).

### Where the sections live

- **In the harness's custom instructions** (`/instructions sync`), when the harness has
  `customInstructions`. Sync reads the current text, writes a backup to
  `.reiner/modules/<harness>/instructions-backups/`, replaces only Reiner's sections, shows what will
  change, asks y/N, saves, then reads the stored text back and checks it matches. Prompts then carry only
  the facts line.
- **In the prompt**, when they are not synced in their current form: once per chat, and again whenever
  the mode or index setting changed (tracked per chat in `transfer.json`). Chats that never got a pack get
  no file-exchange text.
- **What counts as having had them (2026-11-11).** A chat is recorded as briefed only by a prompt that
  carried the sections, or one that carried the facts line while the sections were synced. A tool answer
  never counts, because it never carries the sections: before, answering any tool call marked the chat as
  briefed, so a chat could go on without ever being told the format. A chat that got its first pack from
  a tool answer (`share_project`) gets the sections with its next prompt. A chat briefed through synced
  instructions gets the sections in a prompt again once they are removed from the custom instructions.
- Changing the mode or index makes saved sections describe the old setting. `/transfer` always shows a
  yellow warning to run `/instructions sync` (firmer when Reiner knows it synced the old text), and sends
  the sections in prompts until then.
- `/instructions` shows what is saved; `/instructions remove` takes the sections out and keeps the user's
  own text.

How one harness's settings page behaves when saving (timing, read-back, retry) belongs in its docs.
Example: [Copilot's custom instructions](../../harness-ms/docs/file-exchange.md#custom-instructions).

## Pack tools

Two of the four tools send files, so they belong to the pack exchange (the call format is in
[tool-protocol.md](../../../docs/architecture/tool-protocol.md); `glob` and `grep` are in [file-exchange.md](../../../docs/architecture/file-exchange.md#tools)).

**`share_files`**: `"name":"share_files","arguments":{"paths":["src/a.ts"],"reason":"..."}` or
`"arguments":{"all":true}`.

- **In a chat that has the project:** Reiner answers with what the next prompt would carry
  ([above](#keeping-the-project-current)): a part pack of everything changed since the chat's full pack,
  or a full pack when the chat was idle. If nothing changed, it says the chat's newest full pack (and part
  pack) hold the files. Paths that are not in the project, or not shareable, are refused with a reason.
- **In any other chat:** only files **this chat has already seen** (recorded per chat in `transfer.json`
  when a pack goes with a prompt), re-read from disk, in a part pack, through the share rules. Anything
  else is refused, since sending it would widen what the chat has.
- Reiner answers automatically with
  `{"type":"function_call_output","call_id":"…","output":"attached <pack> with …"}`
  and the new pack, then handles the next reply as usual. At most 3 tool rounds in a row.
- It needs no y/N: either the chat already has the whole project, or only files it has seen go. The TUI
  prints what was asked for, what was sent and what was refused.

**`share_project`**: `"name":"share_project","arguments":{"reason":"..."}`. The whole project in a new full pack, the
same pack `/pack` makes (git's files; share rules; the search index
when it is on), so the model can start from nothing, as with Pack-GitFiles.ps1.

- It widens what the chat has seen, so the TUI asks "<harness> asks for the whole project (reason). Pack
  and upload it?" first. A no, or a caller with no way to ask (scripts), answers "the user declined".
  (`reiner -p` does not run tool calls at all yet.)
- After it the chat has the project, so Reiner keeps it current before each prompt
  ([above](#keeping-the-project-current)).
- One tool-result message carries at most one pack, and every result line is true about it (2026-11-11).
  `share_project` calls in a reply run first; once a full pack is attached, a `share_files` in the same
  reply makes no second pack and says the files are in that one, and a second `share_project` says it is
  already attached. Two `share_files` calls in a chat without the project go into one part pack.

The `files` section tells the model, step by step, to re-unpack the chat's packs after a sandbox reset and
to call `share_files` (or `share_project` when the chat has no pack at all) instead of guessing or asking
in plain text when a pack or file is missing.

## Live checks

File exchange is checked live against a real harness. Each harness documents its own live checks;
Copilot's (`pnpm live:transfer`, `live:instructions`, `live:tools`) are in
[packages/harness-ms/docs/module.md](../../harness-ms/docs/module.md#live-checks).

## Where the code is

`packages/exchange-packs/src/`: `pack.ts` (packs), `search-index.ts` (the SQLite index), `instructions.ts`
(sections, `TransferMode`, the `diff` and `download` modes), and `exchange/` (`store.ts`, `settings.ts`,
`prompt.ts`, `primary.ts`, `collect.ts`, `tools.ts`, `share-files.ts`), assembled by `exchange.ts`
(`createPackExchange`).
