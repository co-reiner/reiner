# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Copilot, Cursor and others) working in this repository.
`CLAUDE.md` imports this file; keep shared guidance here, not there.

This folder is one project in the `reiner` repository. Repository-wide rules are in `../AGENTS.md`.
The sibling `../reiner-agent/` (a Docker-hosted autonomous harness manager, not started) will reuse
the `core`, `browser` and `harness-*` packages from here, so keep them free of TUI and terminal concerns.

## What this project is

**Reiner** is a cross-platform CLI that gives a terminal agent experience (prompt area, slash commands,
streaming output, local tools) on top of AI harnesses that only exist in the browser, such as
Microsoft 365 Copilot. It drives a background Chromium browser, sends prompts into the harness, reads
responses back, and runs its **own tool layer** locally. The model learns how to call those tools from
instructions Reiner places in the harness's user-level custom instructions.

Read before changing anything substantial:

- [docs/architecture/overview.md](docs/architecture/overview.md): the big picture
- [docs/architecture/tech-stack.md](docs/architecture/tech-stack.md): what we use and why
- [docs/architecture/tool-protocol.md](docs/architecture/tool-protocol.md): how the model calls our tools
- [docs/architecture/modules.md](docs/architecture/modules.md): the harness module contract and extension points
- [docs/architecture/file-exchange.md](docs/architecture/file-exchange.md): who owns file exchange, share rules, applying changes, the search tools
- [packages/exchange-packs/docs/packs.md](packages/exchange-packs/docs/packs.md): the pack exchange: packs, reply modes, instruction sections, the pack tools
- [packages/harness-gs/docs/](packages/harness-gs/docs/README.md): the Google Search AI mode harness, an
  experiment (module, robot checks, text and upload exchange, live checks)
- [docs/plan.md](docs/plan.md): what is not built yet
- [packages/harness-ms/docs/](packages/harness-ms/docs/README.md): the Microsoft 365 Copilot harness
  (module, commands, OneDrive file exchange, live checks)

## Status

Early draft. The CLI runs from source with Microsoft 365 Copilot as the first harness: Ink TUI with
streaming chat, the harness's slash commands plus Reiner's global ones, file exchange (packs, three reply
modes, `/apply`), custom instruction sync, and the tool loop with `share_files`, `share_project`, `glob`
and `grep`. A second, experimental harness drives Google Search's AI mode
(`packages/harness-gs/`): it stops and hands over to the user when Google asks for a robot check, and
nothing it sends names Reiner. From the shell: `reiner -p "<prompt>"`, `reiner <command> [args]` (any harness command once,
`--json` for data), `reiner init`, `reiner harness`, `reiner status`. See [docs/plan.md](docs/plan.md)
for what is not built yet. Docs marked **Built** describe the code; the rest is still proposed.

To try it, run the CLI inside `../test-projects/test01/` (committed; its `.reiner/` is ignored): `.\reiner.cmd` (PowerShell) or `./reiner` (bash).
That folder gets its own `.reiner/`.
When a decision is made, write it into the architecture doc it belongs to, with its date and a short
"why"; there are no separate decision records.

## Stack

- TypeScript (strict), Node.js 22 LTS or later, ESM only
- pnpm workspaces monorepo
- Playwright (`playwright-core`) for browser automation, persistent contexts
- Ink (React for terminals) for the TUI
- zod for schemas, commander for non-interactive argv parsing
- Vitest for tests, Biome for lint and format; tsdown for builds (planned, there is no build yet)

## Repository layout

```
packages/
  reiner/         # @co-reiner/reiner          what users install: the CLI plus the bundled harnesses (bin: reiner),
                  #                          and the full user guide as its README
  cli/            # @co-reiner/cli      the CLI without harnesses (bin: reiner-cli; run() in bin/run.js),
                  #                          bin/ one-shot commands, Ink TUI, global slash commands, chat and
                  #                          tool loop (it calls the harness's exchange; it has none itself)
  core/           # @co-reiner/core     contracts (harness, commands, the exchange hook), config, state,
                  #                          tool protocol, glob/grep, share rules, applying changes
  exchange-packs/ # @co-reiner/exchange-packs  one way to exchange files, for harnesses that take uploads:
                  #                          packs, search index, reply modes, instruction sections
  browser/        # @co-reiner/browser  Playwright launcher, profile management, page helpers
  harness-ms/     # @co-reiner/harness-ms  Microsoft harness: the m365-copilot module (copilot/),
                  #                             its slash commands (commands/), its pack exchange with the
                  #                             OneDrive mode,
                  #                             its own docs (docs/)
  harness-gs/     # @co-reiner/harness-gs  Google Search harness (experimental): the google-search module
                  #                             (gs/), its own text and upload exchange (exchange/), its
                  #                             commands and docs
  co-reiner/      # co-reiner                proxy package, depends on @co-reiner/reiner, no code
docs/             # common architecture (with the reasons for each decision), plan
```

`cli/`, `harness-ms/` and `harness-gs/` also hold `live/`: checks against the real harness, not part of `pnpm test`.
Besides the code headers' own links, these docs apply to a whole package:

| Package | Docs |
| --- | --- |
| every package | [`../AGENTS.md`](../AGENTS.md) (the motto), this file, [overview](docs/architecture/overview.md), [tech stack](docs/architecture/tech-stack.md) |
| `browser/` | [the live browser](docs/architecture/overview.md#harnesses-and-the-live-browser) |
| `harness-ms/` | [harness modules](docs/architecture/modules.md), [the live browser](docs/architecture/overview.md#harnesses-and-the-live-browser), [its own docs](packages/harness-ms/docs/README.md) |
| `harness-gs/` | [harness modules](docs/architecture/modules.md), [its own docs](packages/harness-gs/docs/README.md) |
| `exchange-packs/` | [its own doc](packages/exchange-packs/docs/packs.md), [file exchange](docs/architecture/file-exchange.md), [harness modules: file exchange](docs/architecture/modules.md#file-exchange) |
| `reiner/`, `cli/`, `co-reiner/` | [tech stack: distribution](docs/architecture/tech-stack.md#distribution) (the bundle and the bare CLI, lockstep releases, reserving the name) |

Product name in prose is **Reiner**, and the unattended runner in `../reiner-agent/` is **Reiner Agent**
(never "Co-Reiner", the earlier name). The main npm package is `@co-reiner/reiner`, the command is
`reiner`. `co-reiner` names the npm organisation (every package is `@co-reiner/<name>`), the GitHub
organisation, and the unscoped npm proxy package `co-reiner`.

## Conventions

- Australian English in docs, comments and user-facing strings (behaviour, organisation, initialise).
- Dates in docs as `YYYY-MM-DD`.
- Cross-platform always: use `node:path`, never hard-code `/` or `\`; test path handling on Windows.
- **Puppet, never reverse-engineer** (the motto in [`../AGENTS.md`](../AGENTS.md#motto-we-puppet-harnesses)):
  modules only use the harness's own page. No vendor APIs, no network interception, no token reuse, no
  hiding automation.
- No harness-specific code outside its module package. Core must not import from a module.
- How the project's files reach a harness's model and come back is the harness's own business: it sets
  `HarnessModule.exchange`, and the host only calls that hook
  ([file exchange](docs/architecture/file-exchange.md)). Core holds the rules every exchange obeys (share
  rules, where a change may land, applying after a y/N), never a way of exchanging. A harness that takes
  uploads uses `@co-reiner/exchange-packs`; code several harnesses need goes in a package like it, not in
  core and not in the CLI.
- A module's state files are its own. The host never reads them by name: it asks the module
  (`HarnessModule.remembered`).
- Harness-specific docs live in the harness package's `docs/` (e.g. `packages/harness-ms/docs/`); the
  common docs in `docs/architecture/` cover global behaviour and extension points, and link to them.
- A package's `README.md` is what npm shows, so it is for users only, with absolute links (GitHub or
  npm): either a short description that points at `@co-reiner/reiner`, or a full guide with the warnings:
  `packages/reiner/` for what every harness shares (install, global commands, common settings, the list
  of bundled harnesses with links), and each harness package for its own commands, settings and first
  steps. Developer notes (folder layout,
  the docs that apply to a whole package, release rules) go in this file or `docs/`, never in a package
  README. The `files` list in each `package.json` keeps tests, live checks and docs out of npm. The only
  `LICENSE` is at the repository root; each package's `prepack` (`scripts/copy-license.mjs`) copies it
  in for npm, and the copies are git-ignored. A
  user-facing change updates `packages/reiner/README.md`, or the harness's README when it is that
  harness's.
- All DOM selectors for a harness live in one `selectors.ts` per module, so UI changes are a one-file fix.
- A hint that names a slash command is only shown when the active harness has that command
  (`hasCommand` in `packages/cli/src/tui/hints.ts`): the CLI must read well for any harness.
- Slash commands that depend on what a harness can do live in its package (`HarnessModule.commands`,
  [harness commands](docs/architecture/modules.md#harness-commands)). The CLI keeps only global ones (`help`, `harness`,
  `status`, `browser`, `clear`, `exit`), and a harness command never hides a global name.
- Every tool call from a model is untrusted input: validate with zod, and route side effects
  (write, delete, shell) through the permission system.
- Never log or print cookies, tokens, or the contents of `.reiner/profiles/`.
- Keep functions small and typed; prefer plain objects and functions over class hierarchies,
  except for the module contract.
- Biome's `useDomNodeTextContent` rule is off for harness packages (`biome.json`, `overrides`): a harness
  reads `innerText` on purpose, because it wants the text as the page shows it, not the text of hidden
  nodes.
- Biome fails a file over 240 lines or a function over 80 (`noExcessiveLinesPerFile`,
  `noExcessiveLinesPerFunction`). Split by concern rather than raising the limits.

## Commands

Run from `reiner/`:

```bash
pnpm install
pnpm typecheck   # TypeScript 7
pnpm test        # Vitest
pnpm lint        # Biome
```

The CLI runs straight from TypeScript through tsx (`packages/reiner/bin/reiner.js`, which starts the CLI's
`bin/run.js` with the bundled harnesses); there is no build step yet. The CLI ships no harness
([distribution](docs/architecture/tech-stack.md#distribution)).

## Live checks

These drive the real, signed-in Copilot, so they are not part of `pnpm test`. Run them from `reiner/`
with `REINER_CWD` pointing at a signed-in project folder (e.g. `../test-projects/test01`) that has no TUI
open. What each one does is in
[packages/harness-ms/docs/module.md](packages/harness-ms/docs/module.md#live-checks).

- `pnpm live:large-chat`, `pnpm live:transfer` (`MODES=diff` runs one mode), `pnpm live:instructions`
  (`REMOVE=1` takes the sections out; it changes the account), `pnpm live:tools` (`ONLY=share` or
  `ONLY=search` runs one part), `pnpm live:refresh` (a new file reaches the chat in a fresh full pack).
- `pnpm live:gs-chat`, `pnpm live:gs-explore`: the Google Search harness, against `../test-projects/test02`
  ([what they do](packages/harness-gs/docs/module.md#live-checks)). Send few prompts, and never answer or
  work around a robot check: that is the user's.
- Use the chat "Large Chat Test (Keep)" for live tests instead of creating new ones. Never delete or
  rename it. Only point `live:transfer` at a scratch project: it resets `src/` and `docs/` with git.

## Browser gotchas

- A harness module owns **one live window and one tab**
  ([overview](docs/architecture/overview.md#harnesses-and-the-live-browser)). In the TUI it opens when the harness
  becomes active and stays open; all commands reuse that tab, which never navigates away from the chat.
  Another page the module needs (a cloud drive such as OneDrive) opens in a short-lived tab of its own in
  the same window, closed when done. Do not open other long-lived tabs or windows; that is the future
  subagents work.
- Page loads reset harness state (Copilot goes back to "Auto"). The module re-applies the saved model
  after a load in a new chat; anything else that resets on load must be handled the same way. An existing
  chat it opens keeps the model it shows: never switch the model before or after switching chat. Copilot's other page
  lessons are in [packages/harness-ms/docs/module.md](packages/harness-ms/docs/module.md#page-lessons).
- Edge and Chrome can take 10 to 70 seconds to close after visiting Microsoft 365. `stop()` closes in the
  background unless you pass `{ wait: true }`; the CLI waits at most 10 seconds on quit, then exits.
- Code passed to `page.evaluate` must not define named inner functions (`const f = () => …`): tsx adds a
  `__name` helper that does not exist in the page, and the call fails. Inline them, or do the work in Node
  on `innerHTML` (as `copilot/markdown.ts` does).
- Only one process can use a profile folder at a time, so a TUI and a one-shot command on the same project
  and harness cannot run together.
- The window is visible by default. `--hide-browser`, `/browser hide` or `"browser": { "headless": true }`
  run it in the background; `--keep-browser` keeps a one-shot command's window open until you close it.
- `"browser": { "keepSession": true }` launches with `--restore-last-session` so a session-cookie sign-in
  survives a restart; `openProfile` closes the tabs that restores, so the one-tab rule still holds.

## Things to never do

- Commit anything under `.reiner/` (browser profiles hold live session cookies).
- Add a dependency without a one-line reason in the PR description.
- Bypass the permission prompt for destructive tools, even in tests against a real file system.
