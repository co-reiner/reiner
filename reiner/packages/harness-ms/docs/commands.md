# Copilot's slash commands

Status: **Built**. Code: `src/commands/`, one file per command.

Copilot's module lists these in `HarnessModule.commands`. How harness commands reach the user (shown
first under "Microsoft 365 Copilot commands", global names reserved, suggestions, one-shot use) is in
[cli-ux.md](../../../docs/architecture/cli-ux.md#harness-commands).

`chatHarnessCommands(self)` (`src/commands/index.ts`) builds the list, in the order `/help` shows it,
for a `ChatHarness` (`src/commands/types.ts`): a `HarnessModule` with sign-in, models, chats, custom
instructions and file transfer all present. A harness that lacks some of these brings its own list.

## Commands

| Command                                      | Does                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`                                     | Sign in to Copilot in its window; relaunches visibly if the browser was hidden.                                                                                                                                                                                            |
| `/new`                                       | Start a new chat with Copilot's own "New chat" control, and select the project's model in it; if Copilot does not offer that model right now, a warning names it and points to `/model` or a buffer chat.                                                                  |
| `/chats`                                     | List the recent chats, numbered, with the open one marked. Which chat is open comes from the tab's address, not from the sidebar's highlight, which can lag; a chat that is open but not in the recent list is still reported as open. Chats with an agent show "(agent)". |
| `/chat <name or number>`                     | Switch to a chat and show its last 3 turns. No argument shows the open chat.                                                                                                                                                                                               |
| `/history [turns]`                           | Show the open chat's latest turns, read back from the page (default 5).                                                                                                                                                                                                    |
| `/rename <new title>`                        | Rename the open chat with Copilot's own Rename control.                                                                                                                                                                                                                    |
| `/delete [name or number]`                   | Delete a chat (the open one by default) after a y/N question. Deleting the open chat starts a new one, so the next prompt does not go into the deleted conversation.                                                                                                       |
| `/transfer [mode] \| index on\|off \| clean` | Show the file-exchange settings, switch the reply mode (`diff`, `download`, `onedrive`), turn the search index in packs on or off, or clean old packs out of the uploads ([below](#transfer-clean)).                                                                       |
| `/instructions [sync \| remove]`             | Show, save or remove Reiner's sections in Copilot's custom instructions.                                                                                                                                                                                                   |
| `/pack`                                      | Pack the whole project and attach it to the next prompt. After that, changes go automatically as part packs.                                                                                                                                                               |
| `/apply`                                     | Offer the last reply's file changes again (after a restart: the open chat's newest reply).                                                                                                                                                                                 |
| `/models [--debug]`                          | List the models Copilot offers to the account, grouped by submenu. `--debug` writes a dump to `.reiner/logs/`.                                                                                                                                                             |
| `/model <name>`                              | Pick a model by part of its name, e.g. `/model sol quick`: it switches the open chat at once and becomes the project's model for new chats. No name shows the project's choice.                                                                                            |

Details of `/transfer`, `/pack`, `/apply` and `/instructions` are in [file-exchange.md](file-exchange.md).

## Choosing a chat

`/chat` and `/delete` take a name or a number. They match against the last `/chats` list first, so
numbers mean what the user saw, then against a fresh read of the sidebar (`findChat` in
`src/commands/shared.ts`). Several matches are listed with their numbers, and nothing happens.

## Argument completion

The TUI suggests argument values while the user types (see
[CLI and TUI: harness commands](../../../docs/architecture/cli-ux.md#harness-commands)):

- `complete: 'model'`: `/model`. Names come from the last `/models`.
- `complete: 'chat'`: `/chat` and `/delete`. Names come from the last `/chats`.
- `choices()`, fixed values:
  - `/transfer`: the modes Copilot declares (`diff`, `download`, `onedrive`), then `index on`,
    `index off` and `clean`.
  - `/instructions`: `sync`, `remove`.
  - `/models`: `--debug`.

## y/N questions and `(Keep)`

These commands ask before they change anything outside the project (`host.confirm`, true only for an
explicit "y"):

- **`/delete`** asks "Delete "…" from Microsoft 365 Copilot? This cannot be undone." A chat with "(Keep)"
  in its title is refused before the question; rename it first to delete it. `deleteChat` in the module
  refuses "(Keep)" titles too, so the rule holds for any caller.
- **`/instructions sync` and `/instructions remove`** show what will change and where the backup went,
  then ask before saving.
- **`/apply`**, and the changes offered after each reply, list the files and ask before writing.

`/transfer onedrive` may send Copilot a prompt to create its folders (see
[file-exchange.md](file-exchange.md#missing-folders)); it does not ask first.

## `/transfer clean`

Copilot keeps every upload in OneDrive (`Microsoft Copilot Chat Files`). Reiner replaces the full pack in
place (see [file-exchange.md](file-exchange.md#packs-zipdocx)), but packs from before that, part packs and
renamed duplicates stay. `/transfer clean` lists **this project's** packs there, each with what it is
(the current full or part pack, an older full or part pack, a renamed duplicate upload); other files are
never listed.

Tick what to remove under the prompt (`host.pick`): `↑`/`↓` move, `Space` ticks the row (on
**(Select all)**, every row), `a` ticks or unticks all, `Enter` removes the ticked files, `Esc` removes
nothing. Removing moves files to the **OneDrive recycle bin** through OneDrive's own page (right-click,
Delete, confirm): they stay recoverable there, and keep counting toward storage until OneDrive empties it.
As a one-shot command (`reiner transfer clean`) the list is numbered and you type `1,3`, `all`, or nothing.

## From the shell

Every command also runs once as `reiner <command> [args]`, for example `reiner login`,
`reiner models --debug`, `reiner model sol quick` or `reiner chats --json`. The window opens, the command
runs and the window closes. y/N questions are asked on the terminal; without one (piped or scripted) the
answer is "no", so `reiner delete` and `reiner instructions sync` change nothing unattended.
