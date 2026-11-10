# Tech stack

Status: **Proposed** (2026-11-07)

## Recommendation: TypeScript on Node.js, Playwright, Ink

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict), ESM | Same language as the browser side (page scripts, DOM types). Large ecosystem for CLIs. |
| Runtime | Node.js 22 LTS+ | Playwright's first-class runtime. Cross-platform. Installed via npm, no compiler toolchain for users. |
| Browser automation | Playwright (`playwright-core`) | `launchPersistentContext(userDataDir)` gives a per-project profile in `.reiner/`. Auto-waiting locators and accessibility snapshots, can use installed Edge or Chrome via `channel`. |
| TUI | Ink (React for terminals) | Proven for agent CLIs (Claude Code, Gemini CLI use it). Components for the prompt, streaming output, approval dialogs. |
| Markdown in terminal | `marked`'s lexer + our own renderer (`cli/src/tui/markdown.ts`), colours from `node:util` `styleText` | Model replies are markdown. `marked-terminal` was dropped on 2026-11-11: its image support pulled in `jimp` and an unpatched zod 3 advisory, and we never load images anyway. |
| Schemas | zod | Validates tool-call arguments and config files; generates the tool docs injected into the harness. |
| Argv parsing | commander | For non-interactive use: `reiner -p "..."`, `reiner <command>` (a harness command once), `reiner status`. |
| Config format | JSONC (`jsonc-parser`) | Comments allowed, simple to edit by hand. |
| Logging | pino to `.reiner/logs/` | Structured, never to the TUI's stdout. |
| Build | tsdown | Fast bundling of each package. |
| Tests | Vitest; Playwright against local HTML fixtures | Fixtures mimic harness DOM so module tests run offline. |
| Lint / format | Biome | One tool, fast. |
| Monorepo | pnpm workspaces | Clean module boundaries, third-party modules later. |

### Why Playwright over Puppeteer

- Persistent profile support is a single call, and it works the same on Windows, macOS and Linux.
- `channel: 'msedge'` lets corporate users run their installed Edge. On managed Windows machines Edge can
  carry device-based single sign-on to Microsoft 365, which may avoid repeated MFA prompts. Needs verifying.
- Better locators and auto-waiting, which matter when scraping a fast-changing SPA.
- `playwright-core` does not download browsers on install; we choose at runtime between an installed
  Edge or Chrome and a Playwright-managed Chromium.

### Browser selection order

1. `browser.channel` from config if set (`msedge`, `chrome`, `chromium`)
2. Installed Microsoft Edge (`channel: 'auto'` tries it first)
3. Installed Google Chrome
4. Playwright-managed Chromium (offer to install)

### Headed versus headless

- A harness's sign-in command (`login`, for example `/login` or `reiner login` with Copilot) opens a
  visible window so the user can sign in and complete MFA.
- The window is visible by default (`browser.headless: false`), so the user can watch. `--hide-browser`,
  `/browser hide` or `"headless": true` run it in the background with the same profile. Some identity
  providers refuse headless sessions; if so, fall back to an off-screen or minimised headed window.
- A sign-in kept only in session cookies (no "Stay signed in") ends when the browser closes, even with a
  persistent profile. `browser.keepSession` starts the browser with `--restore-last-session`, the only
  setting that kept them in tests (the profile's "Continue where you left off" alone did not), in headed and
  headless windows alike ([security notes](project-config.md#security-notes)).

## Alternatives considered

| Option | For | Against |
| --- | --- | --- |
| **Go + Bubble Tea + chromedp/rod** | Single static binary, great TUI library | Weaker persistent-profile and auto-waiting support; page scripts still need JS; slower to iterate on scraping |
| **Python + Textual + Playwright** | Playwright is first-class too; Textual is a good TUI | Packaging and distribution is harder for non-Python users; two languages once page scripts grow |
| **Rust + Ratatui + chromiumoxide** | Fast, single binary | Most effort for the least benefit here; CDP crates are less mature |
| **Bun runtime** | Fast start, `bun build --compile` single binary | Playwright on Bun is not fully supported; revisit later for distribution only |

## Distribution

- Primary: npm package `@co-reiner/reiner`, command `reiner`. `npm i -g @co-reiner/reiner`. It bundles
  `@co-reiner/cli` (the CLI without harnesses, command `reiner-cli`) with the harness packages it
  lists in `packages/reiner/bin/reiner.js`, passed to the CLI's `run()` (since 2026-11-11). The CLI's
  runtime dependencies hold only what an empty CLI needs, so it can be reused with any set of harnesses,
  including by Reiner Agent; harness packages are only its dev dependencies, for tests and live checks.
  A harness brings what it needs with it: `@co-reiner/harness-ms` depends on `@co-reiner/exchange-packs`
  (file exchange by packs), which neither the CLI nor core depends on.
  Both packages can be installed together: their commands are `reiner` and `reiner-cli`.
- Until there is a build step, the packages ship their TypeScript source and the CLI's `bin/run.js` runs it
  through tsx with the CLI package's own `tsconfig.runtime.json` (JSX and module settings; at the package
  root, because tsx applies a tsconfig only to files under its folder), so an
  installed copy never reaches for the workspace `tsconfig.json`. Checked on 2026-11-10 by installing the
  packed tarballs in a folder outside the repository.
- Proxy: unscoped `co-reiner` depends on the main package and exposes the same command, so
  `npx co-reiner` works. Released in lockstep: same version number, published in the same release. Its
  dependency is `workspace:*`, which pnpm rewrites to the exact version on publish. It never gets code of
  its own.
- Reserving `co-reiner`: the name was free on npm when checked on 2026-11-07. To hold it before the main
  package exists, publish a placeholder `0.0.0` by hand (with the dependency removed) from an account in
  the `co-reiner` npm organisation. npm blocks names that differ only by punctuation, so it should also stop
  anyone publishing `coreiner`; likely, not confirmed.
- Later: standalone binaries via Node single executable applications, once the dependency tree allows.
