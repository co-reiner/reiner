# Harness modules

Status: **Proposed** (2026-11-07)

A module adapts one browser harness to Reiner. Core talks to every module through the same contract.
This doc describes that contract and every point where a harness plugs in. What one harness does with
them is in its own package's docs; the first is Microsoft 365 Copilot, in
[packages/harness-ms/docs/](../../packages/harness-ms/docs/README.md).

## Contract

Built today (`packages/core/src/harness.ts`). A module owns **one live browser window with one tab** on
its harness ([the live browser](../architecture/overview.md#harnesses-and-the-live-browser)):

```ts
interface HarnessModule {
  id: string;                      // e.g. "m365-copilot"
  displayName: string;
  commands?: HarnessCommand[];     // its slash commands, see "Harness commands" below
  // Required: open, send, close.
  start(opts?: { chatId? }): Promise<StartResult>; // open the window, check sign-in; open chatId and keep
                                   // its model, or re-apply the saved model when there is no chat to open
  send(prompt, { onDelta, attachments }): Promise<ChatReply>;  // type, send, stream the reply as markdown
  stopGenerating(): Promise<void>; // press the harness's "Stop generating" button
  restart(): Promise<StartResult>; // e.g. after switching visible/headless
  isOpen(): boolean;
  onClosed(listener): () => void;  // the user closed the window, or we did
  waitUntilClosed(): Promise<void>;
  stop(opts?: { wait?: boolean }): Promise<void>;
  // Optional: sign-in, models, chats. A harness without them leaves them out.
  login?(): Promise<StartResult>;  // wait in the visible window for the user to sign in
  checkSignIn?(): Promise<SignInState>;
  listModels?(): Promise<ModelListResult>;
  selectModel?(query: string): Promise<SelectModelResult>;
  newChat?(): Promise<NewChatResult | undefined>; // the harness's own "New chat" control; selects the
                                   // saved model and notes when it is not available
  listChats?(): Promise<ChatInfo[]>;
  openChat?(id): Promise<ChatInfo>;                 // keeps the model the chat shows
  currentChat?(): Promise<ChatInfo | undefined>;    // the chat the tab is on, read from its address
  readHistory?({ turns }): Promise<HistoryTurn[]>;
  renameChat?(title, { id? }): Promise<ChatInfo>;  deleteChat?(id): Promise<void>;  // refuses "(Keep)" chats
  // Optional: how the project reaches the model and comes back; see "File exchange" below.
  exchange?: ProjectExchange;
  // Optional: what the module remembers between runs, for the status line and suggestions.
  remembered?: { signIn?(); models?(); modelPreference?(); chats?() };
  customInstructions?: { read(): Promise<string>; write(text): Promise<void> };
}

interface HarnessEntry {           // what the CLI's harness list and first-run picker show
  id: string; displayName: string; description: string;
  defaultSettings?: Record<string, unknown>;
  create(ctx: HarnessContext): HarnessModule;
}
```

`HarnessContext` gives the module its project root, profile folder (`.reiner/profiles/<id>/`), state
folder (`.reiner/modules/<id>/`), log folder, browser options and its settings: its entry in the config's
`harnesses` object, plus `readSettings()` for the same entry read fresh, so an edit to a setting that is
read at the time of use counts without a restart.

**The module's state is its own (2026-11-11).** What a module keeps in its state folder, and under which
names, is its business. The host never reads those files: it asks `remembered` for the last sign-in
state, the model list, the chosen model and the recent chats. Before, the CLI read the module's files by
name (`signin`, `models`, `model`, `recent-chats`), a contract nobody had written down. The one note the
host keeps there itself is the open chat (`last-chat`), to reopen it on start.

### Required and optional

Only opening, sending and closing are required. A harness without sign-in or chat history (for example an
AI answer on a search page) leaves those methods out and does not list the commands that need them; the
TUI then skips reopening the last chat on start.

| Group | Methods | Notes |
| --- | --- | --- |
| Required | `start`, `send`, `stopGenerating`, `restart`, `isOpen`, `onClosed`, `waitUntilClosed`, `stop` | Every harness |
| Sign-in | `login`, `checkSignIn` | `/status --check` and `reiner status --check` use `checkSignIn` when present |
| Models | `listModels`, `selectModel` | The module keeps the chosen model in its state folder (Copilot: `model.json`) and `start` re-applies it; the host only reads it to show the user (`CommandHost.modelPreference`) |
| Chats | `newChat`, `listChats`, `openChat`, `currentChat`, `readHistory`, `renameChat`, `deleteChat` | Without `openChat` and `currentChat`, no last-chat reopen on start |
| File exchange | `exchange` | The hook the host calls; see [File exchange](#file-exchange). Without it, prompts go as typed and only a diff written in a reply is offered |
| Memory | `remembered` | Last sign-in state, model list, chosen model, recent chats, for the status line and suggestions |
| Instructions | `customInstructions` | Without it, the sections can only travel in prompts |
| Commands | `commands` | Without it, only the global commands |

`deleteChat` must refuse a chat whose title contains "(Keep)", whatever the caller, and callers ask the
user first.

Ideas not built yet: a module declaring its own tools (`tools?()`), and an instruction size limit the
module reports, so Reiner can fall back to prompts when its sections do not fit.

## Settings

A module's settings are its entry in the config's `harnesses` object, passed as `ctx.settings`. Each
module documents its own keys. `HarnessEntry.defaultSettings` is written to the project config when the
harness is first added, so a new config shows where the keys go. The generic `include` and `exclude`
search patterns sit in the same entry for every harness
([project-config.md](project-config.md#search-include-and-exclude)).

Example: Copilot's `url`, `createdFolder` and `oneDriveUrl`
([module.md](../../packages/harness-ms/docs/module.md#settings)).

## Harness commands

Built (2026-11-09). Why: all commands used to live in the CLI, so every new harness meant more
harness-specific CLI code that Reiner Agent could not reuse. Now a new harness brings its commands, the CLI
does not change, and another host runs the same commands through its own `CommandHost`. Every slash
command that depends on
what a harness can do is defined in the harness's own package and listed in `HarnessModule.commands`. The
contract is in `packages/core/src/commands.ts` and holds plain data, no terminal UI:

```ts
interface HarnessCommand {
  name: string;                     // "models"
  args?: string;                    // hint for /help, e.g. "[--debug]"
  description: string;
  complete?: 'model' | 'chat';      // what the argument names, so the TUI can suggest values
  choices?(): CommandChoice[];      // fixed argument values to suggest: { value, detail? }
  run(host: CommandHost, args: string[]): Promise<void> | void;
}
```

- `CommandHost` is what a command may ask of its host: `print(OutputEntry)`, `busy(label)`,
  `confirm(question)` (true only for an explicit "y"), `pick(question, options)` (the user ticks options,
  with a "(Select all)"; resolves the ticked indexes, empty on cancel), `setSignIn`, `setChat`, `lastChats`,
  `modelPreference`, `log`, `signal` (aborted when the user presses Esc while the command runs, to pass
  on to module calls that can stop part-way), the project root and the harness's state folder, and `offerChanges(sets,
  notes)`: show change sets, ask the user, apply the ones they accept. The host has no file-exchange API:
  a command that packs or switches reply mode works on its own harness's exchange.
- `OutputEntry` is what commands print: `info`, `success`, `warning`, `error`, and structured entries
  such as `models`, `chats`, `history`, `changes` and `transfer`. The TUI renders them; `reiner <command>`
  prints them as text, or as JSON with `--json`.
- The CLI's TUI adds only global commands (`packages/cli/src/tui/commands/`: help, harness, status,
  browser, clear, exit). `tui/commands.ts` lists the harness's commands first, then the global ones, and
  drops a harness command whose name is global, so Reiner's own names stay reserved.
- Reiner Agent can later offer the same commands through its own `CommandHost`.

How the commands appear to the user is in [cli-ux.md](cli-ux.md#harness-commands). Example: Copilot's
thirteen commands, built for any `ChatHarness` (a module with every optional group present), in
[commands.md](../../packages/harness-ms/docs/commands.md).

## File exchange

How files travel is the harness's business ([file-exchange.md](file-exchange.md)). The host knows one
optional member, `exchange: ProjectExchange` (`packages/core/src/harness.ts`), and calls it at fixed
points of a chat turn:

| Call | When | Does |
| --- | --- | --- |
| `prepare(text, chatId)` | before a send | Returns the prompt as it goes, the files to attach, and notes for the user |
| `afterSend(chatId, sent, userText)` | after a send went through | Records what the chat now has |
| `collect(reply)` | after a reply with no tool call | Returns change sets and notes; nothing is applied |
| `runTools(calls, chatId, { confirm })` | after a reply that is a tool call | Returns the message that answers the calls, and lines for the user |
| `applied()` | after the user applied changes | Lets the exchange move on (the pack exchange: the next patch number) |

The host shows the change sets, asks y/N and applies them through core (`applyChangeSet`), so the safety
rules do not depend on the harness. A harness with no `exchange` gets its prompts as typed; a diff the
model writes in a reply is still offered.

A harness that takes uploads does not write this itself: it creates the pack exchange from
`@co-reiner/exchange-packs` and hands it over.

```ts
const transfer: TransferSupport = {
  modes: [DIFF_MODE, downloadMode(saveReplyLinks), myOwnMode],  // TransferMode: id, label, instructions, collect?
  defaultMode: 'diff',
  index: true,                    // packs may carry the search index
};
const exchange = createPackExchange({
  root, reinerDir, stateDir, displayName,
  settings: () => ctx.readSettings(),   // read fresh: staleMinutes, include, exclude
  support: transfer,
});
```

What the pack exchange needs from the page stays in the contract, because it is not about packs:

- `send(prompt, { attachments })`: uploads files through the harness's own upload control first.
- `ChatReply.downloads`: names of download links in the reply. `ChatReply.closedDocument`: the module
  closed a document the harness had opened for editing.
- `ChatReply.notSent`: the user cancelled before the prompt was sent, so nothing reached the model and
  the host calls no `afterSend`. `ChatReply.notes`: what the user should know about the turn, such as
  what a cancelled turn left behind in the harness.
- `customInstructions.read()` / `write(text)`: the user's custom instructions in the harness's settings
  page. `write` replaces the whole text and is verified by reading back; callers change only marked
  sections.

Everything else a pack harness has is its own, declared in its package and used by its own commands, not
by the host. Copilot's are in `PackHarness` (`packages/harness-ms/src/commands/types.ts`): the `transfer`
support and the `exchange` itself, `prepareTransfer(mode)` (get a mode ready before switching to it) and
`uploads` (`list()` and `remove(names)`, for
[`/transfer clean`](../../packages/harness-ms/docs/commands.md#transfer-clean)). Saving download links
and fetching files from a cloud drive are inside the modes that need them.

Example: Copilot declares `diff`, `download` and its own `onedrive` mode, and reads OneDrive through its
web page ([file-exchange.md](../../packages/harness-ms/docs/file-exchange.md)).

## Puppet, never reverse-engineer

Modules only do what a person could do in the harness page: navigate, read what is on screen,
click, type, upload through the page's own controls. No direct calls to vendor APIs, no reading of network
traffic, no reuse of tokens or cookies outside the browser, no flags that hide automation from the site.
This is the project's motto, in [`AGENTS.md`](../../../AGENTS.md#motto-we-puppet-harnesses).

- **Selectors in one file.** Every URL pattern and DOM selector a module uses lives in one `selectors.ts`
  in its package, so a UI change is a one-file fix.
- **One live window and tab** ([overview](overview.md#harnesses-and-the-live-browser)). The module opens it on `start` and reuses it for every call;
  calls are not concurrent. The chat tab stays on the chat: another page the module needs (a cloud
  drive) opens in a short-lived tab of its own in the same window, closed when done.
- **Page loads reset state.** Anything the harness forgets on a page load (for example the chosen model)
  is re-applied by the module before the next action.

## Reading replies

Read the rendered reply from the page (the DOM). Watch the reply container until the harness shows it has
finished (stop button gone, reply complete marker), then convert the rendered HTML back to markdown.
Where the harness offers its own "copy" button for a reply or a code block, prefer that, since it gives
the raw text a person would get. Code passed to `page.evaluate` must not define named inner functions
(tsx adds a `__name` helper the page does not have); convert HTML in Node instead.

## Adding a harness

1. Create `packages/harness-<vendor>/` (`@co-reiner/harness-<vendor>`, no vendor trademarks in the
   name), depending on `@co-reiner/core` and `@co-reiner/browser`. Core must not import from it.
2. Export a `HarnessEntry` with `id`, `displayName`, `description`, `defaultSettings` and `create(ctx)`.
3. Implement the required methods, then whichever optional groups the harness has. Put every selector
   in `selectors.ts`.
4. List the commands it supports in `commands`. Reuse `chatHarnessCommands` from `harness-ms` only if
   the module is a full `ChatHarness`; otherwise bring its own list.
5. Bundle it: add the package as a dependency of `packages/reiner/` and its entry to the list in
   `packages/reiner/bin/reiner.js` ([distribution](../architecture/tech-stack.md#distribution)).
6. Write `packages/harness-<vendor>/docs/`: its module, commands, settings keys, file exchange and live
   checks. Common docs only link to it.

## Packaging

Modules are grouped into one package per vendor, named `@co-reiner/harness-<vendor>`:
`@co-reiner/harness-ms` holds `m365-copilot`. The CLI (`@co-reiner/cli`) ships none; the
`@co-reiner/reiner` package bundles the CLI with its harnesses
([distribution](../architecture/tech-stack.md#distribution)). Third-party modules later load by package name
from config.

Subagents (several tabs per module) are a future possibility; see the [overview](overview.md#future-subagents).
