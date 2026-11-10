# Reiner

Take the reins of your AI harness. The Reiner CLI starts with harnesses that only live in the browser.

Powerful models are often available only through a restricted web harness, such as Microsoft 365 Copilot.
Reiner runs that harness in a background Chromium browser and wraps it in a CLI that works like
Claude Code or similar agents: a prompt area, slash commands, streaming output, and local tools. Today the
tools share your project's files with the model and search them; the model's changes come back as a patch
that Reiner applies after you say yes. Tools that read and change files directly are the intention, not
built yet ([docs/plan.md](docs/plan.md)).

> Status: early draft. It runs from source; nothing is published yet. See [docs/plan.md](docs/plan.md).

## How it works (short version)

1. `reiner` starts in your project folder and opens (or reuses) a browser profile in `.reiner/`.
2. You sign in to the harness once; the session is kept in that profile.
3. Reiner teaches the model a short "tool protocol" through marked sections in the harness's custom
   instructions (`/instructions sync`), or in the prompt until those are saved.
4. Your prompt goes to the harness. When the model's reply is a tool call, Reiner runs it locally
   (with your approval where needed) and sends the result back. This loops until the model is done.

The slash commands come from the active harness (for Copilot: `/login`, `/models`, `/chats`, `/pack`,
`/transfer` and more, see [its commands](packages/harness-ms/docs/commands.md)), plus Reiner's own (`/help`, `/harness`, `/status`, `/browser`, `/clear`, `/exit`).
`reiner <command> [args]` runs a harness command once from the shell, for example `reiner login` or
`reiner models --json`.

## Warnings

An experimental reference implementation, built with AI, for study and controlled evaluation: no
warranties and no security guarantees, and not for production use or confidential data. Obtain any
necessary authorisation from the service provider and your organisation before use; this project does not
establish that your use is permitted. Evaluate with disposable projects, and treat `.reiner/` as sensitive.
Please open issues rather than pull requests. The full list is in the
[repository README's Warnings](../README.md#warnings).

## Install (once published)

With npm:

```bash
npm i -g @co-reiner/reiner
```

With Yarn (1.x; Yarn 2 and later have no global installs):

```bash
yarn global add @co-reiner/reiner
```

With pnpm:

```bash
pnpm add -g @co-reiner/reiner
```

`co-reiner` installs the same thing under a shorter name (`npm i -g co-reiner`, `yarn global add co-reiner`
or `pnpm add -g co-reiner`). Either way the command is `reiner`.

## Harnesses

| Harness | Package | What it adds |
| --- | --- | --- |
| `m365-copilot` | [`@co-reiner/harness-ms`](packages/harness-ms/) | Microsoft 365 Copilot Chat as the harness. Files go up as packs and come back three ways: a git diff in the reply, a patch behind a download link, or a patch Copilot saves to OneDrive (`/transfer`). Docs: [packages/harness-ms/docs/](packages/harness-ms/docs/README.md). |

## Trademarks

Reiner is not affiliated with, endorsed by or sponsored by any of the companies or products named here.
Product names, such as Microsoft 365, Copilot and OneDrive (trademarks of Microsoft Corporation), are
trademarks of their owners, used only to describe compatibility.

## Docs

Start with [docs/README.md](docs/README.md). Each harness documents itself in its package, for example
[packages/harness-ms/docs/](packages/harness-ms/docs/README.md).

## Licence

MIT, copyright 2026 Alexandr Yeskov. See [LICENSE](../LICENSE).
