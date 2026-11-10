# CLI and TUI

Status: **Proposed** (2026-11-07)

This doc covers what Reiner does the same for every harness. Commands that depend on a harness come from
that harness's package; see [Harness commands](#harness-commands).

## Entry points

```bash
reiner                     # interactive TUI in the current folder
reiner -p "explain src/"   # one-shot: sends the prompt, prints the reply as markdown to stdout (built)
                           # add --new-chat to start a fresh chat first; status lines go to stderr
reiner <command> [args]    # one-shot: runs one of the active harness's commands (built)
                           # add --json to print the output as data instead of text
reiner status [--check]    # project, harness, browser and sign-in; --check opens the browser (built)
# global flags, before or after the command: --harness <id>, --show-browser, --hide-browser,
# --keep-browser, --json
reiner init --harness <id> # create .reiner/, pick the harness, write config (built)
reiner harness [id]        # list harnesses, or make one the project default (built)
reiner doctor              # check browser, sign-in, selectors, instruction sync (planned)
```

`reiner` comes from `@co-reiner/reiner`, the CLI with its harnesses. `reiner-cli` from `@co-reiner/cli`
is the same CLI with no harness: it starts, shows no harness picker, and its one-shot commands say to
install `@co-reiner/reiner` ([distribution](../architecture/tech-stack.md#distribution)).

`reiner init`, `reiner harness` and `reiner status` are Reiner's own (`packages/cli/src/bin/`) and take
precedence over a harness command of the same name. One-shot harness commands are described under
[Harness commands](#harness-commands).

## TUI layout

```
┌ Reiner · <harness> · signed in · my-project ─────────────────┐
│ > user prompt                                                  │
│ assistant reply, streamed, rendered markdown                   │
│ ● read_file src/index.ts                       ✓ 120 lines     │
│ ● edit_file src/index.ts                       ? approve [y/n/a]│
├────────────────────────────────────────────────────────────────┤
│ > _                                                            │
│ /help for commands · esc to stop · msgs 7/30 in this chat      │
└────────────────────────────────────────────────────────────────┘
```

## Startup

1. First run in a folder: if several harnesses are installed and no `defaultHarness` is set globally, a
   picker asks "Which harness should this project use?" (↑/↓, Enter). With one harness installed it is
   used without asking.
2. The active harness's browser window opens on the harness and **stays open** for the session. The TUI
   checks sign-in and reopens the chat that was open last time (remembered per project and harness in
   `last-chat.json`) as part of `start({ chatId })`, then shows its last 3 turns. An existing chat keeps
   the model it shows; when it differs from the project's saved model the TUI says so in yellow, and
   nothing is switched. The saved model is only re-applied when no chat is reopened (a new chat). A
   harness without chat history (no `openChat` and `currentChat`) skips the chat part.
3. The status line shows harness · browser open/closed · sign-in · model.

## Global commands

Built into the CLI (`packages/cli/src/tui/commands/`), the same for every harness. Their names are
reserved: a harness command with one of these names is dropped.

| Command | Does |
| --- | --- |
| `/help` | List commands and keys (built) |
| `/harness [name]` | List harnesses, or switch: closes the current window, opens the new harness, makes it the project default (built) |
| `/status [--check]` | Project, harness, browser and sign-in (built) |
| `/browser show\|hide` | Show the window or run it in the background; restarts the browser (built) |
| `/clear` | Clear the screen (built) |
| `/exit` | Quit and close the browser (built) |

Planned global commands:

| Command | Does |
| --- | --- |
| `/compact` | Summarise and continue in a fresh chat |
| `/permissions` | View and change tool permissions for this session |

## Harness commands

Built ([harness commands](../architecture/modules.md#harness-commands)). Everything that depends on what a harness can
do (sign-in, models, chats, file exchange, custom instructions) is a command the harness brings. This is
the extension point; the contract is in [modules.md](modules.md#harness-commands).

- **Where they come from.** A harness lists its commands in `HarnessModule.commands`. A harness without
  file transfer or custom instructions simply has no `/pack`, `/transfer` or `/instructions`.
- **How they show.** `/help` and the suggestion list show the harness's commands first, under
  "<Harness> commands" (the harness's display name), and the global ones last.
- **Names are reserved.** A harness command never hides a global one; one with a global name is dropped
  (`tui/commands.ts`).
- **Argument hints.** `args` is the hint `/help` shows (`[--debug]`, `<name or number>`). Two optional
  fields make the TUI suggest values after the command name and a space:
  - `complete` (`'model'` or `'chat'`): the argument names a model or a chat, suggested from the last
    model or chat list.
  - `choices()`: fixed values the argument can take, each with a short description (`CommandChoice`).
    Values that start with what is typed are listed. With nothing typed yet the bare command comes
    first, so `Enter` still runs it as it is rather than picking a value. Global commands use the same
    field (`/browser show|hide`, `/status --check`).
- **Output.** Commands print `OutputEntry` data (`info`, `success`, `error`, and structured entries such
  as `models`, `chats`, `history`, `changes`, `transfer`). The TUI renders them.
- **Questions.** `host.confirm(question)` asks y/N; only an explicit "y" counts. `host.pick(question,
  options)` shows a list to tick under the prompt (keys below) and resolves the ticked rows.
- **Planned:** `/mode <name>` for a harness's own modes (for example work or web grounding).

### One-shot: `reiner <command>`

`reiner <command> [args]` (`packages/cli/src/bin/run.ts`) opens the harness's window, runs that harness
command once and closes the window (or keeps it with `--keep-browser`). There are no hard-coded `login`
or `models` subcommands: what exists depends on the harness, and an unknown name lists the harness's
commands. Reiner's own flags count before or after the command name (`reiner models --hide-browser`,
`reiner status --keep-browser`, `reiner --json models`); any other option belongs to the command
(`reiner models --debug`), and everything after `--` is passed to it as it is. Why (2026-11-11): commander's
`passThroughOptions` stopped reading Reiner's flags at the command name, so `--hide-browser` after it was
handed to the harness command and ignored.

- Output is printed as text (`bin/print.ts`), or with `--json` as the command's `OutputEntry` items in one
  JSON array. The exit code is 1 if any entry is an error.
- y/N questions are asked on the terminal. Without one (piped, scripted) the answer is "no". A pick list
  is numbered, and the answer is `1,3`, `all`, or nothing; without a terminal nothing is picked.

**Example:** Microsoft 365 Copilot's commands are in
[packages/harness-ms/docs/commands.md](../../packages/harness-ms/docs/commands.md).

## Permissions

- Each tool call that needs approval shows the call and its arguments (a diff for edits).
- Answers: `y` once, `a` always for this session, `n` deny (the model receives a "denied" result).
- `--yolo` style blanket approval is deliberately not planned for the first release.

## Keys

- `Enter` sends (built). The prompt is one line. `Shift+Enter` or `\` + `Enter` for a new line is not
  built (terminal support varies, Windows Terminal included); it is listed in [plan.md](../plan.md)
- Anything that does not start with `/` is sent to the harness as a prompt. The reply streams in below
  the transcript, rendered as markdown, then stays in the transcript with harness, model and time (built)
- `Esc` during a turn stops it wherever it is (built): before the prompt is sent it cancels the turn, and
  the TUI says what was left behind (e.g. a file already uploaded); while a reply is being written it
  calls the harness's `stopGenerating`
- `Esc` while a slash command runs asks it to stop (built): the command gets a signal
  (`CommandHost.signal`) and a module call that takes it stops at its next safe step, saying what was and
  was not done. Copilot's `/instructions` does; a command that does not take it runs to the end
- While a suggestion list shows (after `/`, or after a command that has `complete` or `choices`): `Up`/`Down` move the highlight (wrapping), `Enter` runs the highlighted row, `Tab` puts it in the
  prompt to edit, `Esc` hides the list (built)
- Otherwise `Up` / `Down` browse history; a recalled command keeps the list hidden. `Up` keeps what was
  typed and `Down` past the newest entry brings it back; `Down` with no walk in progress does nothing (built)
- In a pick list (`host.pick`, e.g. `/transfer clean`): `Up`/`Down` move (wrapping), `Space` ticks the row
  (on the first row, **(Select all)**, every row), `a` ticks or unticks all, `Enter` confirms the ticked
  rows, `Esc` cancels with none (built)
- Editing the prompt (our own `PromptInput`, built): `Left`/`Right`, `Ctrl+Left`/`Ctrl+Right` by word,
  `Home`/`End` (or `Ctrl+A`/`Ctrl+E`). `Shift` with any of these selects; typing replaces the selection,
  `Backspace`/`Delete` remove it. `Ctrl+W` or `Ctrl+Backspace` deletes a word, `Ctrl+U` to the start,
  `Ctrl+K` to the end. The cursor moves by the characters a person sees: an emoji, a flag or a letter
  with a combining accent is one step and one delete, though it is several code points. Tables and
  wrapped lines count columns the way the terminal does (CJK and emoji take two; `tui/width.ts`).
  There is no copy yet, because `Ctrl+C` quits
