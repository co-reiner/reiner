# File exchange

How Reiner sends a project to a harness and brings the model's changes back.

**Who owns what (2026-11-11).** How files travel is the harness's business, not core's and not the CLI's:
one harness takes uploads, another may only be able to quote files into the prompt, a third has no way at
all. So the host (the CLI) knows only a small hook, `HarnessModule.exchange`
([modules.md](modules.md#file-exchange)), and calls it at fixed points of a chat turn. Three layers:

| Layer | Package | Holds |
| --- | --- | --- |
| Rules every exchange obeys | `core` | What may leave the machine (share rules), where a change may land (`safeTarget`, `checkDiff`), the recycle bin, change sets and applying them, `glob` and `grep` |
| One way of exchanging: packs | `exchange-packs` | Packs and part packs, the search index, per-chat state, reply modes, instruction sections, patch numbers, the pack tools `share_files` and `share_project` |
| A harness that uses it | e.g. `harness-ms` | The page work (upload, download links), its own modes (Copilot's `onedrive`), the commands `/transfer`, `/pack`, `/apply`, `/instructions` |

Why a package of its own: the pack exchange is about 1,500 lines that a second harness with uploads would
otherwise copy or pull out of the Microsoft package, and the repository's rule is that shared code is
reused, not copied. A harness that exchanges files differently writes its own, smaller `exchange` on the
same core rules and does not depend on `exchange-packs` at all.

This doc covers the first layer: the rules, and the search tools every harness can have. The pack
exchange has its own doc, [packs.md](../../packages/exchange-packs/docs/packs.md), and a harness documents
its own specifics in its package (Copilot:
[packages/harness-ms/docs/file-exchange.md](../../packages/harness-ms/docs/file-exchange.md)).

## Share rules

Everything that leaves the machine, in a pack or through a tool, passes `checkShareable` (core,
`transfer/share.ts`):

1. **Folder rule:** the path is a regular file inside the project, not under `.git/` or `.reiner/`, and
   reached without any symbolic link or junction: a link is refused, and so is a file whose real path
   differs from the path asked for (a linked folder on the way). Otherwise an innocent-looking link could
   point at an ignored or protected file, while the rules are checked against the link's name.
2. **Git rule:** nothing that `.gitignore` or other git excludes match, even a file that is tracked
   (`git check-ignore --no-index`).

The project must be in a git repository; outside one every path is refused. `gitRepo` fails closed: only
git's "not a git repository" counts as no repository, and any other git error (git missing, a broken repo)
is reported instead of being read as "no git".

Refused files are listed with the reason when packing. A project can be a folder inside a larger repo
(like `test-projects/test01`): git commands run in the project folder, and `git apply` runs at the repo
top with `--directory=<prefix>`, because from a sub-folder it silently skips paths.

## Applying changes

**Applying is always confirmed.** Reiner lists the files (`+` write, `−` delete, `~` patch) and asks
y/N. Every path goes through `safeTarget` (`core/src/transfer/safe-path.ts`), which fails closed: no
absolute paths, no `..` segments, not the project root, never `.git/` or `.reiner/` in any spelling or at
any depth (case, trailing dots or spaces, `:` streams and `~1` short names are refused; a nested
repository's `.git/` counts too), no link at the target, and
no linked folder on the way (the real path of the deepest existing folder must match). A link swapped in
between the check and the write is not covered.

A diff is also checked against the way `git apply` reads names (`checkDiff` in
`core/src/transfer/diff.ts`, 2026-11-11), because git takes a file's name from several places and the
paths shown to the user must be the paths that change. Every name in a section (`diff --git`, `---`,
`+++`) must agree; `rename` and `copy` headers are refused, since their source file would never be
checked (a copy from an ignored file would leak it into a shareable one); quoted names are refused; and a
plain header must start with `a/` and `b/`, because git drops the first folder of one that does not. A
plain deletion needs no prefix: Reiner does it itself. A refused diff says why, so the model can send the
file in full instead.

`/apply`
offers the last reply's changes again, for example after a "no" or when a file arrives late. After a
restart, before any reply has arrived in this run, it reads the open chat's newest reply from the page (as
`/history` does). After an apply, the patch number goes up by one.

**Reading received files** (`core/src/transfer/read-change.ts`, since 2026-11-11). A file is a ZIP when it
starts with `PK`, whatever its name; otherwise it must be a unified diff.

- A ZIP named `*.zip.docx` (also a renamed duplicate such as `x.zip 2.docx`) is a patch the harness saved
  as a document: Word's wrapper entries (`[Content_Types].xml`, `_rels/`, `package/`, `docProps/`) are
  dropped. A plain `.zip` keeps every entry, because a project can have such folders of its own.
- Office files are ZIPs too. An Office-named file (`.docx`, `.xlsx`, `.pptx` and their macro forms) whose
  main part is there (`word/document.xml`, `xl/workbook.xml`, `ppt/presentation.xml`) is a real document,
  not a patch. So is a file that is neither a ZIP nor a diff. Such a file comes back as a `document`: it
  is never applied and adds nothing to the y/N list. It stays where it was saved (`.reiner/incoming/`),
  the user is told what it is and where, and asked whether to copy it to the project root, under a free
  name (`report (2).docx`) so nothing is overwritten. The patch number does not move. Why: in `download`
  mode every file the reply links is read, so a report the user asked for, or a document the model saved
  by mistake instead of a patch, used to show up as `word/…` files to write into the project.
- `.search/` (the pack index) and other `.reiner/` entries are never project files, in any ZIP.

**The model can delete files, only to the recycle bin.** A reply lists them in a code block that starts
with `#To delete (only to a bin):`, one relative path per line (`extractDeletions`; this is what the
pack exchange asks for, see [packs.md](../../packages/exchange-packs/docs/packs.md#instructions-and-sections)).
A patch may also list deletions in `.reiner/deleted.txt` (one path per line, the same format Reiner sends; `DELETED.txt` and `Remove-Item` paths in a
`*delete*.ps1` script, older conventions, are read too), and a diff deletes with `deleted file mode` or
`+++ /dev/null`, in a `git diff` or a plain unified diff.
Deleted files show as `−` in the y/N list, and the question says they go to the recycle bin. Reiner then
moves them to the system's recycle bin (`core/src/transfer/trash.ts`: the Windows Recycle Bin through the
shell, the macOS Trash through Finder, `gio trash` on Linux, or `trash-put` when `gio` is not installed;
a Linux command that ran and failed is reported with the files still in place), never deleting for good; a
diff's deletions are split off before `git apply` (a deleted binary or empty file has no `---` line, so
its name comes from the `diff --git` line), and recycled only after the rest has passed
`git apply --check`, so a diff that does not apply changes nothing. If no recycle bin is available, the
deletion fails and says so. Files a change overwrites are not backed up.

On Windows the same holds where there is no Recycle Bin to go to (2026-11-11). Every path is checked
before any is touched: a network share has none and a removable drive may have none, so those are
refused and nothing is deleted. The shell is called so that Windows itself asks before it would delete
for good (a file too big for the Recycle Bin), and a no is an error. A deleted folder goes to the
Recycle Bin as a folder. Why: the earlier call answered yes to every shell question, so in those cases
it could delete permanently.

A real path and the path asked for are compared without regard to the Unicode form of a name (and, on
Windows and macOS, its case): macOS stores an accented letter as two code points where git writes one,
and such a file used to be refused as "reached through a link".

## Tools

The model can ask Reiner for things with tool calls ([tool-protocol.md](tool-protocol.md)). Two tools
search the project and belong to core, so any harness can have them; the tools that send files belong to
an exchange ([pack tools](../../packages/exchange-packs/docs/packs.md#pack-tools)).

**`glob`**: `"name":"glob","arguments":{"pattern":"src/**/*.ts"}` and **`grep`**:
`"name":"grep","arguments":{"pattern":"<regex>","glob":"*.ts","ignoreCase":true}`. Results come back
inline in the `output` of the tool-result message, no pack: `glob` lists paths, `grep` lists `path:line: text`.

- **Git-ignored files are never named or read.** Both tools start from `shareableFiles(root)` in
  `core/src/transfer/share.ts`, never from the disk:
  - in a git repo, `git ls-files --cached --others --exclude-standard` (tracked files, and untracked files
    no `.gitignore`, `.git/info/exclude` or global excludes file matches), then `checkShareable`, which also
    drops tracked files an ignore rule matches now (`git check-ignore --no-index`) and applies the folder
    rule (regular files inside the project, never through a link, never `.git/` or `.reiner/`);
  - without git, an error saying so: nothing is listed.

  The list is built on every call, so an edited `.gitignore` counts at once.
- The user can widen or narrow that list per harness with `include` and `exclude` patterns in
  `.reiner/config.jsonc` ([project-config.md](project-config.md#search-include-and-exclude)). `include`
  adds back git-ignored files (never past the folder rule); `exclude` hides files and wins. Packs and
  `share_files` do not read them.
- Results never mention hidden files, not even as a count: a pattern that only matches ignored files gets
  the same "no files match" as one that matches nothing.
- Globs: `**` spans folders, `*` and `?` stay in one name, `{a,b}` and `[abc]` work; a pattern without
  `/` matches the file name in any folder (`*.ts`), as in `.gitignore`. Matching ignores case. A run of
  `**/` counts as one, and a tool call with more than three `**`, or more than four `*` in one name, is
  refused (2026-11-11): each wildcard multiplies the work of testing a path, and a model's pattern must
  not stall the TUI.
- Limits: `glob` lists 200 paths, `grep` 100 lines (each cut at 200 characters), and says how many there
  were in all. `grep` skips files over 1 MB, binary files and lines over 2,000 characters, and stops after
  5 seconds. A bad regular expression gets the error back. One expression that backtracks badly on one
  line can still stall the search; it runs in the TUI process.
- They need no y/N: they only read files the share rules would let `share_project` send. They do widen
  what the chat knows (names and matching lines), which is why the share rules are applied in full.

## Where the code is

- Core rules (`packages/core/src/transfer/`): `share.ts` (share rules), `apply.ts` (change sets),
  `read-change.ts` (reading a received file), `diff.ts` (reading and checking diffs), `safe-path.ts`
  (where a change may land), `trash.ts` (the recycle bin). The hook is `ProjectExchange` in
  `packages/core/src/harness.ts`. The search tools are in `packages/core/src/tools/` (`search.ts`,
  `glob.ts`, `run.ts`).
- The pack exchange: `packages/exchange-packs/src/`
  ([packs.md](../../packages/exchange-packs/docs/packs.md#where-the-code-is)).
- A harness: it creates the exchange with its modes, sets it as `HarnessModule.exchange`, and its commands
  (`/pack`, `/transfer`, `/apply`, `/instructions`) work on it directly
  ([modules.md](modules.md#file-exchange)). Copilot's is in `packages/harness-ms/src/copilot/module.ts`.
- The host: the CLI's chat loop (`packages/cli/src/tui/chat-loop.ts`) calls the hook, and shows, asks about
  and applies change sets (`tui/commands/shared.ts`). It has no exchange code of its own.
- Harness side: `send(prompt, { attachments })`, `ChatReply.downloads` and
  `customInstructions` ([modules.md](modules.md#file-exchange)).
