# The Google Search module

Status: **Built** (2026-11-12), as an experiment. Code: `src/gs/`.

The module drives the AI mode of Google Search through its page, in the project's own browser profile
(`.reiner/profiles/google-search/`). It follows the motto in the repository's
[AGENTS.md](../../../../AGENTS.md#motto-we-puppet-harnesses): navigate, read what is rendered, click and
type. No Google API, no network traffic, nothing that hides the automation.

## The page

- **Address.** `https://www.google.com/search?udm=50`. It opens without a Google account, in the browser
  Playwright launches, with no special settings.
- **The first prompt reloads the page** with the prompt in the address (`&q=…`). Later prompts stay on
  the page.
- **Turns.** One container (`aim-mars-turn-root`) holds every turn in a block of its own. A turn has the
  prompt and a reply (`data-scope-id="turn"`), which gets `data-complete="true"` when it is finished.
  The reply's text is in its `main-col` container.
- **Uploads.** The "+" button ("Add files and tools") opens a menu; "Add files" opens a file chooser
  that takes any file type. AI mode reads text files; it cannot read inside a ZIP.
- **No account, no memory.** Without an account there is no chat list, no model picker and no saved
  instructions.

Every address and selector is in `src/gs/selectors.ts`.

## Code layout

| File           | What it holds                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `selectors.ts` | Addresses and selectors                                                                        |
| `state.ts`     | The shared state (`GsState`), and telling what the page shows: the prompt box or a robot check |
| `browser.ts`   | The window: open, check, show a robot check, `/login`, close                                   |
| `send.ts`      | Send a prompt, upload, read the reply, stop, new conversation                                  |
| `markdown.ts`  | The reply's HTML to markdown                                                                   |
| `module.ts`    | The `HarnessModule`                                                                            |

## Robot checks

Google blocks robots, and this module does not try to get past that. It notices a block, stops, and
hands over to the user.

- **What a block looks like.** Google's "unusual traffic" page (`/sorry/` in the address) asks the
  person to confirm they are not a robot. AI mode itself never shows it: while a check is pending, AI
  mode takes the prompt and then leaves the reply empty, and the check appears on an ordinary results
  page.
- **What the module does.** When no reply text arrives within 45 seconds, it opens one ordinary search
  in the tab. If that lands on the check, the module shows the window, even when the browser was running
  hidden (the hidden one is replaced by a visible one), saves the state as "not signed in", and the
  prompt fails with the reason. The same happens when the page is on the check at start.
- **What the user does.** Answers the check in the window, or not. `/login` waits for it (up to 8
  minutes) and then goes back to AI mode on a new conversation.
- **What the module never does.** It never touches the check page, never retries around it, and never
  uses stealth settings, a changed fingerprint or anything else that hides the automation.

Why a block counts as "not signed in": the host already knows what to do with that state (say so, offer
`/login`, show the window), and it is the same situation: only the user can clear it. Decided 2026-11-12.

## Sending and reading

`send` (`send.ts`):

1. Makes sure the tab shows the prompt box (`readyPage`); a robot check stops it here.
2. Counts the turns on the page, uploads any attachments through "+" → "Add files", types the prompt
   with `insertText` and presses Enter. Esc before Enter empties the box and nothing is sent.
3. Polls the newest turn, converting its reply to markdown each time it grows (`onDelta`), until the
   page marks the reply complete and the text has stopped changing.
4. Keeps the reply's HTML in `.reiner/logs/google-search-last-reply.html`, and the whole page in
   `google-search-no-reply.html` when no reply came: the first things to look at when the page changes.

`replyHtmlToMarkdown` (`markdown.ts`) runs in Node on the reply's HTML. Headings are divs with a heading
role and become real headings. A code block is a widget (language label, `<pre>`, a caution line, a
copy button) and becomes one fenced block. Source chips, images, the buttons under the reply and the
follow-up suggestions are dropped.

A conversation has no id of Google's without an account, so `currentChat` returns the module's own
(`thread-1`, `thread-2`…) with the first prompt as title. It tells the host one conversation from the
next; it cannot be reopened after the window closes.

## Settings

| Key                  | Default                                | Meaning                                                                                                   |
| -------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `url`                | `https://www.google.com/search?udm=50` | The AI mode address                                                                                       |
| `include`, `exclude` | `[]`                                   | Search patterns, as for every harness ([project-config.md](../../../docs/architecture/project-config.md)) |

## Page lessons

- **A prompt that reads like a search gets web results.** AI mode then replies with "Here are top web
  results" and a list of sites, not an answer. Seen for: a long first prompt that opens with rules, a
  prompt that describes a JSON tool-call format, and a request about "my file" with no file in front of
  the model. The same request with the file quoted or uploaded got a real reply. So the briefing is
  short, in plain words, and comes after the user's text
  ([file-exchange.md](file-exchange.md#the-briefing)), and the exchange tells the user when a reply is
  only web results.
- **The environment variable `PROMPT` is the command prompt's own on Windows** (`$P$G`). The live checks
  take the prompt from `ASK`.
- **Domino answers a bare tag selector with a list that cannot be spread**; `markdown.ts` copies matches
  into an array.

## Live checks

These use the real page, so they are not part of `pnpm test`. Run them from `reiner/` with `REINER_CWD`
pointing at a project folder with no TUI open (e.g. `../test-projects/test02`). Send few prompts: every
automated prompt makes a robot check more likely, and a check is the user's to answer.

- `pnpm live:gs-chat`: one prompt through the module and the exchange, the reply as markdown, and up to
  two more rounds answering what the reply asks for. Options: `ASK`, `SHARE`, `MODE`, `PLAIN=1`,
  `FIRST`, `HIDE=1` (in the file's header).
- `pnpm live:gs-explore`: opens an address in the profile, optionally clicks and types, and records the
  page (inputs, buttons, HTML, screenshot) in `.reiner/logs/`. For finding selectors after a change.
