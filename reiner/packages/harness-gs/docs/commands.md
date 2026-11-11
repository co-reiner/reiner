# Google Search's slash commands

Status: **Built** (2026-11-12). Code: `src/commands.ts`.

The module lists these in `HarnessModule.commands` (`gsCommands`). How harness commands reach the user
is in [cli-ux.md](../../../docs/architecture/cli-ux.md#harness-commands).

| Command                            | Does                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`                           | Shows the browser window, opens an ordinary search (where Google shows a pending robot check), waits while the user answers it, then goes back to AI mode. There is no account to sign in to; the user may sign in to Google by hand in the same window. See [robot checks](module.md#robot-checks). |
| `/new`                             | Starts a new conversation with the page's "New thread" button. Its first prompt carries the briefing again.                                                                                                                                                                                          |
| `/share [paths or globs \| clear]` | Queues project files for the next prompt. A glob is expanded over the files the share rules allow; refused paths are named with the reason. No argument shows the queue, `clear` empties it.                                                                                                         |
| `/transfer [text \| upload]`       | Shows or switches how shared files travel ([file-exchange.md](file-exchange.md#how-files-travel)). The choice is kept in the module's state.                                                                                                                                                         |
| `/apply`                           | Offers the last reply's changes again.                                                                                                                                                                                                                                                               |

There are no chat, model or instruction commands: the page has nothing for them without an account.
