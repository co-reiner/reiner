# Google Search harness docs

How the `google-search` harness in `@co-reiner/harness-gs` plugs into Reiner. Everything here is specific
to the AI mode of Google Search. What every harness shares is in
[`reiner/docs/architecture/`](../../../docs/architecture/).

Status: **Built** (2026-11-12), as an experiment. It is a trial of the concept on a second page, for
education and exploration. Google blocks robots; this harness never works around a block and hands it to
the user instead ([module.md](module.md#robot-checks)).

The package provides:

- **The module** (`googleSearchHarness` in `src/index.ts`, built by `createGoogleSearchModule` in
  `src/gs/module.ts`): a `HarnessModule` with opening, sending, stopping, `/login` and new conversations.
  No models, chat history or custom instructions: the page has none without an account.
- **Its own file exchange** (`src/exchange/`): files quoted in the prompt or uploaded as one text file,
  whole files back. It does not use `@co-reiner/exchange-packs`, because AI mode cannot read archives.
- **The commands** (`gsCommands` in `src/commands.ts`).

| Doc                                  | What it covers                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| [module.md](module.md)               | The page, code layout, robot checks, sending and reading, settings, page lessons, live checks |
| [commands.md](commands.md)           | The slash commands                                                                            |
| [file-exchange.md](file-exchange.md) | How files travel, the briefing, what comes back, tools                                        |

One rule beyond the common ones: **nothing this harness sends names the product.** The briefing, the tool
answers and the names of uploaded files are written without it, and a test checks that
(`test/exchange.test.ts`). What the user types or shares is theirs.
