# Microsoft 365 Copilot harness docs

How the `m365-copilot` harness in `@co-reiner/harness-ms` plugs into Reiner. Everything here is
specific to Copilot. What every harness shares, and the extension points this package fills in, is in
[`reiner/docs/architecture/`](../../../docs/architecture/).

The package provides:

- **The module** (`m365CopilotHarness` in `src/index.ts`, built by `createCopilotModule` in
  `src/copilot/module.ts`): a `HarnessModule` with every optional method filled in.
- **The commands** (`chatHarnessCommands` in `src/commands/`): the slash commands listed in
  `HarnessModule.commands`.

| Doc                                  | What it covers                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [module.md](module.md)               | Code layout, sign-in, models, sending and reading, chat history, settings keys, page lessons, live checks |
| [commands.md](commands.md)           | Copilot's slash commands, their arguments, y/N questions and one-shot use                                 |
| [file-exchange.md](file-exchange.md) | `.zip.docx` packs, the three reply modes, OneDrive, custom instructions, co-editing                       |

## When a model is missing

Copilot sometimes hides models for a while (it seems to happen under load), so a model you rely on can
be missing from the picker in a new chat. Reiner never forces a model into an existing chat: an existing
chat keeps the model it was set up with, and Reiner only tells you when it differs from the project's.

A buffer chat keeps the model available to you:

1. Start a chat with the model you want, while it is offered, and send a basic prompt such as "Reply with
   ok." so the chat is saved. Name it so you can find it, for example `/rename Buffer GPT-5 Think`.
2. When the model is missing in a new chat, switch to the buffer instead: `/chat buffer`. It still has
   the model.
3. Rename it for the work you start there (`/rename <topic>`), and make a new buffer the next time the
   model is offered.
