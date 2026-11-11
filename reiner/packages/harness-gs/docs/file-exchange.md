# Google Search file exchange

Status: **Built** (2026-11-12), as an experiment. Code: `src/exchange/`.

The module sets `HarnessModule.exchange` to its own exchange (`createGsExchange`). The common rules are
in [file-exchange.md](../../../docs/architecture/file-exchange.md): what leaves the machine goes through
the share rules, and what comes back is a change set the host shows and applies after a "y".

It does not use `@co-reiner/exchange-packs`. Packs are archives, and AI mode cannot read inside one (it
sees a ZIP's file names and nothing else). It also has no saved instructions to hold a pack protocol.

## How files travel

Only what the user queues with `/share`, or what the model asks for, is sent. Both go through
`checkShareable`; binary files and files over 200,000 characters are refused. Two modes (`/transfer`):

| Mode             | How                                                                                                                                       | Limit                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `text` (default) | Each file quoted in the prompt under `File <path>:`, in a fence longer than any run of backticks inside                                   | 24,000 characters per message |
| `upload`         | All files in one plain text file, `project-files-<n>.txt`, each under a line `===== <path> =====`, attached through the page's "+" button | 1,000,000 characters          |

The upload file is written to the module's `outbox/` folder in its state. Over the limit, the prompt is
not sent and the user is told to share fewer files or switch mode.

## The briefing

AI mode keeps nothing between conversations, so the first prompt of each one ends with a few notes
(`brief.ts`): the project is not on the web, its file names (up to 150), how to ask for files, how to
write a changed file, how to list files to delete.

The notes are short, in plain words, and come after the user's text. That is forced by the page: a
prompt that opens with rules, or that describes a JSON tool call, gets web results instead of a reply
([page lessons](module.md#page-lessons)). So the tool-call format is not taught here. Decided 2026-11-12
after live tries.

Nothing in the briefing, the tool answers or the upload's name carries the product's name.

## What comes back

`collect` reads a reply three ways (`reply-files.ts` and core):

- **Whole files.** A line `File: <path>` directly before a code block: the block is the file's complete
  new content. This is what the briefing asks for; a search-grounded model writes whole files far more
  reliably than a diff that applies. They become one `files` change set.
- **A diff.** A diff block in the reply is read as for any harness.
- **Files to delete.** The block that starts with `#To delete (only to a bin):`.

Two more things are noticed:

- **"Files needed:"** followed by paths. Those files are queued, through the share rules, for the next
  prompt, and the user is told. They go when the user sends the next prompt; nothing is sent on the
  model's word alone.
- **Web results only.** The user is told that the page took the prompt for a search, and to share the
  file and ask again.

## Tools

The JSON tool calls of the [tool protocol](../../../docs/architecture/tool-protocol.md) are still
answered when a reply holds one (`tools.ts`), though the briefing does not teach them:

| Tool            | Answer                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `glob`, `grep`  | Core's (`answerSearchCall`)                                                                                                     |
| `run_task`      | The host's (`answerTaskCall`): the project's named tasks, after the user's y/N                                                  |
| `share_files`   | The named files, through the share rules, quoted or uploaded with the answer. `all` sends again what this conversation has had. |
| `share_project` | After a y/N: the file list, and the content when it fits the mode's limit                                                       |

Project tasks marked `afterApply` run after an apply as for every harness, and a failing one can be sent
back as the next prompt. The once-per-chat line that names the tasks is the host's, and it describes a
JSON call; whether that line makes AI mode fall back to web results has not been tried.
