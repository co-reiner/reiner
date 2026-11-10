# The `m365-copilot` module

How the Microsoft 365 Copilot module is built, and what the Copilot page has taught us. The contract it
implements is in [modules.md](../../../docs/architecture/modules.md).

- Target: Microsoft 365 Copilot Chat in the browser (`https://m365.cloud.microsoft/chat` by default; the
  `url` setting changes it for a tenant that lives elsewhere).
- Sign-in: Microsoft Entra ID in a headed window, then kept in the project's profile.
- Browser: installed Edge first by default (`channel: 'auto'`), since on managed Windows machines Edge can
  carry device single sign-on to Microsoft 365. Not verified yet.

## Code layout

`src/copilot/module.ts` assembles the module. The parts live in separate files by concern and share one
`CopilotState` (`state.ts`): the live window and tab, the close listeners, and the model and stop flags.

| File                       | Does                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `state.ts`                 | `CopilotState`, settings, waiting for the app or the sign-in page    |
| `browser.ts`               | The live tab, sign-in, re-applying the saved model, closing          |
| `send.ts`                  | A turn: upload, submit, read the streamed reply, stop generating     |
| `submit.ts`                | Typing and sending the prompt, and where a cancelled turn stops      |
| `markdown.ts`              | Rendered reply HTML to markdown (turndown, in Node)                  |
| `models.ts`, `picker.ts`   | Reading the model picker and its submenus, selecting a model         |
| `chats.ts`, `chat-list.ts` | New chat, the history sidebar, open, rename, delete, reading turns   |
| `chat-model.ts`            | The model an opened chat shows, kept and compared with the saved one |
| `page-files.ts`            | Uploads, download links, closing co-edited documents                 |
| `drive.ts`                 | OneDrive: address, created folder, fetching files, `prepareTransfer` |
| `uploads.ts`               | Copilot's uploads in OneDrive: listing, removing, replacing a pack   |
| `instructions.ts`          | Custom instructions dialog: read and write                           |
| `transfer.ts`              | The `onedrive` reply mode: its text for the model, fetching its file |
| `selectors.ts`             | Every URL pattern and DOM selector the module uses                   |

**Every selector stays in `selectors.ts`**, so a Copilot UI change is a one-file fix. The module only does
what a person could do in the page: no Microsoft APIs (not even Graph for OneDrive), no network reading,
no token reuse (the rule is repeated at the top of `state.ts`).

## Settings

The module reads its entry in the config's `harnesses` object
([project-config.md](../../../docs/architecture/project-config.md)):

| Key                  | Default                             | Effect                                                                                                                                       |
| -------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                | `https://m365.cloud.microsoft/chat` | Where Copilot Chat lives                                                                                                                     |
| `createdFolder`      | `Documents/Copilot/Created`         | OneDrive folder where Copilot saves files it creates                                                                                         |
| `oneDriveUrl`        | read from the page                  | The user's OneDrive site, e.g. `https://contoso-my.sharepoint.com/personal/user_contoso_com`                                                 |
| `uploadsFolder`      | `Microsoft Copilot Chat Files`      | OneDrive folder (in the library) where Copilot keeps uploads; old packs are replaced and cleaned there                                       |
| `include`, `exclude` | `[]`                                | The generic search patterns every harness has ([project-config.md](../../../docs/architecture/project-config.md#search-include-and-exclude)) |

New projects get `url`, `include` and `exclude` (`defaultSettings` in `src/index.ts`).

State in `.reiner/modules/m365-copilot/`: `model.json` (saved model), `models.json` (the model list as
last read from the picker, for `/model` suggestions), `signin.json` (the sign-in state as last seen, for
the status line), `recent-chats.json` and `chats.json` (chat lists), `drive.json` (OneDrive address),
`instructions-backups/`, and `transfer.json` (the pack exchange's settings and what each chat has). The
host reads none of these: it asks the module's `remembered` for the sign-in state, models, chosen model
and recent chats.

## Models

- The picker next to the prompt box offered Auto, Quick response, Think deeper and an OpenAI submenu
  (GPT-5.6 Sol Quick response / Think deeper). `listModels` hovers each submenu as a
  person would (up to 3 levels). `selectModel` clicks through and confirms the choice.
- **Copilot resets to Auto on every page load**, and on a new chat or a change made by hand. The chosen
  model is saved in `model.json`. Before each action the module reads the picker button's label (cheap),
  and opens the picker only when it no longer shows the saved model. Copilot shortens long names on the
  button, so labels are compared by prefix. Just after a load the picker can read as empty: that is not
  taken as "the model is gone". The module looks once more, and otherwise says the model is tried again
  with the next prompt.
- **An existing chat keeps its model.** Opening a chat (`openChat`, `/chat`, or the
  last chat on start through `start({ chatId })`) applies no model first: the chat loads, then the module
  reads the model its picker shows (`chat-model.ts`) and keeps it. If it differs from the saved model, the
  chat comes back with `model` and `savedModel` and the user is told; nothing is switched. The saved model
  is applied again only for a new chat (`/new`, or start without a chat to open, or a chat that failed to
  open). Why: switching the model before switching chat did the work twice, and Copilot sometimes hides
  models for a while, so forcing the saved one into an existing chat could fail or undo a choice the user
  made in that chat. A `/model` the user picks still applies at once. A window that is opened again
  (`/browser show|hide`, or after the user closed it) or brought back to Copilot lands on a new chat, so
  the saved model applies there again.
- **A new chat gets the saved model at once.** `newChat` (`/new`, `reiner -p --new-chat`)
  and start without a chat to open select it straight away, not at the next send. When Copilot does not
  offer it, the result's notes name the model and point to `/model` or a buffer chat (see the package
  README); the TUI shows that in yellow. Before, the note was lost and the user only noticed later.
  `newChat` only reports a new chat when the tab has left the conversation it was on: if the "New
  chat" control does nothing, it opens Copilot's address instead, and if the tab is still on the old
  conversation it fails, so the next prompt cannot go into the old chat by mistake.

## Sending and reading

- **Send:** click the prompt box, clear it, insert the whole prompt at once (like a paste, so newlines do
  not send early), press Enter.
- **Read:** wait for a new `[data-testid=markdown-reply]`, then poll its HTML every 300 ms and convert it
  to markdown in Node (`markdown.ts`: turndown, with Copilot's "Code Preview" widgets rebuilt as plain
  fenced blocks so indentation survives). Done when "Stop generating" is gone and the text has stopped
  changing.
- **Stop generating:** `stopGenerating` presses Copilot's own stop button (Esc in the TUI). Before a
  reply has started it cancels the turn instead ([below](#cancelling-a-turn)).
- **Long chats:** Copilot loads long conversations lazily, so the module does not count prompts. It
  remembers the newest prompt element before sending and waits for a newer one starting with the prompt's
  text; the reply is the newest reply after that element.
- Every prompt lands in the user's Copilot chat history, like one typed by hand.

## Chat history

- The sidebar lists recent chats as links to `/chat/conversation/<id>` with the title as `aria-label`.
  Chats with one of Copilot's agents link to `/chat/agent/<agent>` instead, with the conversation id in
  the link's `id` attribute; their page URL is `/chat/agent/<agent>/conversation/<id>`. Reiner's id for
  them is `agent/<agent>/conversation/<id>`, and `/chats` marks them "(agent)".
- `listChats` reads the sidebar (opening it first if collapsed) and caches it (`recent-chats.json` for
  suggestions and chat numbers, `chats.json` for every chat seen). Only `listChats` writes
  `recent-chats.json`: the module's other sidebar reads (open, current, rename, delete)
  leave it alone, so `/chat 2` and `/delete 2` mean what the user last saw.
- `openChat` clicks the link, or opens `/chat/conversation/<id>` directly for a chat that has dropped off
  the recent list, then waits for messages to load. It succeeds only when the tab's URL is that chat's;
  otherwise it throws, so `start({ chatId })` reports `chatError` and a chat that is
  gone is not recorded as open.
- `renameChat` and `deleteChat` use the chat's "More" menu (Rename, Delete) and Copilot's own
  confirmation. Delete refuses titles containing "(Keep)".
- `readHistory` reads prompts (`chatQuestion`) and replies (`markdown-reply`) in page order and pairs
  each prompt with the last non-empty reply after it. Only turns Copilot has rendered can be read; for
  very long chats that is the most recent part. It needs a signed-in tab and says so otherwise: a
  sign-in page has no messages, which used to read as an empty chat.
- `currentChat` trusts the URL: a new chat has no conversation id until its first prompt is sent.

## Cancelling a turn

Esc stops a turn wherever it is, not only while a reply is being written. `stopGenerating` raises a flag
that `send` checks between its steps, and `send` clears it when a turn begins, so an Esc during the upload
is not lost.

| Esc arrives…                                              | What happens                                                                    | Left behind                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| While the prompt is prepared (the host is packing)        | The host stops before calling `send`                                            | Nothing: the pack is a local file                                                                                            |
| During the OneDrive visit that removes the earlier upload | `send` returns before uploading                                                 | The earlier copy may already be in the OneDrive recycle bin; the pack goes up again with the next prompt                     |
| During or after the upload, before Enter                  | The draft is emptied (text and attachment chips), nothing is sent               | The uploaded file stays in Copilot's uploads, unused; the next upload of that name replaces it, `/transfer clean` removes it |
| After Enter, before Copilot shows its stop button         | `send` keeps looking for the button for 10 seconds and presses it when it shows | If it never shows, Copilot has the prompt and may still answer in its window; `/history` shows it                            |
| While the reply is being written                          | The stop button is pressed                                                      | The partial reply, as before                                                                                                 |

In the first three cases the reply comes back with `notSent: true`: nothing reached the model, so the host
prints no reply and records nothing for the chat (a pack made with `/pack` stays waiting for the next
prompt). Whatever the turn left behind is said in `ChatReply.notes`, which the TUI shows in yellow.
Why: before, an Esc during the upload was dropped and the prompt went anyway, and an Esc just after Enter
was reported as stopped while Copilot went on answering.

## Page lessons

What the Copilot page does that the rest of Reiner has to allow for:

- **Code fences are relabelled.** Copilot shows code blocks with its own guessed language ("react",
  "json"), so the `reiner-tool` tag does not survive. That is why core's tool-call parser also accepts a
  reply that is nothing but one code block holding a JSON function call (`"type":"function_call"`)
  ([tool-protocol.md](../../../docs/architecture/tool-protocol.md)).
- **Thinking models leave empty placeholders.** "Think deeper" adds empty `markdown-reply` elements
  before and around the answer, and can hide the stop button between thinking and writing. Reading skips
  empty replies.
- **How long `send` waits.** It polls the page every 300 ms. "Started" means Copilot has shown its stop
  button or some reply text for this turn; "idle" means the stop button is not showing.

  | The page shows                                                         | `send` stops waiting                                           |
  | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
  | Reply text, no stop button, text unchanged for two polls               | at once: the normal end                                        |
  | The user pressed Esc while a reply was being written                   | when the stop button goes, or after 3 seconds                  |
  | The user pressed Esc after the prompt went, before any reply           | once the stop button shows and is pressed, or after 10 seconds |
  | Reply text, but the page keeps re-rendering it                         | after 3 seconds idle                                           |
  | No text, an empty reply slot after the prompt (still thinking)         | after 3 minutes idle                                           |
  | No text and no reply slot, after the stop button came and went         | after 20 seconds idle                                          |
  | Nothing at all: no stop button, no text, no reply slot (never started) | after 30 seconds, with an error                                |
  | None of the above                                                      | at `timeoutMs`, 5 minutes by default                           |

  A thinking model reading a fresh full pack needs the 3 minutes: with the shorter limit it was cut off
  with an empty reply. A turn that never starts (the page did not take the prompt) fails after 30 seconds
  rather than holding the terminal for the whole timeout. A wait that ends with no text at all makes
  `send` throw, as the contract says; only a reply the user stopped may come back empty.
- **Blank lines in code are kept.** Runs of blank lines are collapsed to one outside fenced code blocks
  only, so a diff or a file in a code block keeps its lines.
- **The conversation can re-render.** If this turn's prompt element is replaced, reading finds it again
  as the newest prompt that starts with the same text.
- **Long code blocks render lazily** (known gap): lines far outside the window may be missing from a
  reply.
- **Page loads reset the model** (see Models above).
- **Edge and Chrome can take 10 to 70 seconds to close** after visiting Microsoft 365. `stop()` closes in
  the background unless asked to wait.
- **Saving custom instructions** is lost if the dialog closes too soon; see
  [file-exchange.md](file-exchange.md#custom-instructions).

## Live checks

These drive the real, signed-in Copilot, so they are not part of `pnpm test`. Run them from `reiner/`
with `REINER_CWD` pointing at a signed-in project folder (e.g. `../test-projects/test01`) that has no TUI
open.

One long-lived chat, **"Large Chat Test (Keep)"**, is used for live testing, so it keeps growing and
exercises Copilot's slow loading of large chats. Use it instead of creating new chats. Never delete or
rename it.

- `pnpm live:large-chat` (`packages/harness-ms/live/large-chat.live.ts`): adds turns, switches to a fresh
  unsent chat (so nothing extra is saved) and back, and checks sending still works.
- `pnpm live:transfer` (`packages/cli/live/transfer.live.ts`): runs the `diff`, `download` and `onedrive`
  modes in that chat against `test-projects/test01` (`src/greet.ts`, `src/util/math.ts`,
  `docs/notes.md`), applies each result, checks the files, resets `src/` and `docs/` with git, and checks
  that a missing OneDrive folder is reported rather than thrown. Only point it at a scratch project.
  `MODES=diff` runs one mode.
- `pnpm live:instructions` (`packages/cli/live/instructions.live.ts`): saves Reiner's sections into the
  account's custom instructions (backup first, user text kept) and reads them back. `REMOVE=1` takes them
  out again. It changes the account.
- `pnpm live:tools` (`packages/cli/live/tools.live.ts`): in that chat, asks Copilot for a `share_files`
  call and answers it, then for `glob` and `grep` calls with git-ignored decoy files in the project, and
  checks the decoys never reach the chat. `ONLY=share` or `ONLY=search` runs one part.
- `pnpm live:refresh` (`packages/cli/live/refresh.live.ts`): in that chat, sends a full pack holding
  `src/meet-live.ts`, then changes and deletes that file, asking Copilot each time. Checks each prompt
  carries the part pack `<project>.part.zip.docx` with what changed since the full pack (and
  `.reiner/deleted.txt`), that Copilot reads the newest of several same-named uploads and knows the file
  is gone, that the uploads keep one copy, and that nothing is uploaded when nothing changed.

## Not built yet

- `/mode` for work versus web grounding, and the agent picker, if the page exposes them.
- Selector self-tests against the live page (`reiner doctor`).
