# Reiner docs

| Doc | What it covers |
| --- | --- |
| [architecture/overview.md](architecture/overview.md) | System shape, layers, the agent loop |
| [architecture/tech-stack.md](architecture/tech-stack.md) | Stack choices, alternatives considered |
| [architecture/tool-protocol.md](architecture/tool-protocol.md) | How a browser-caged model calls local tools |
| [architecture/modules.md](architecture/modules.md) | Harness module contract, every extension point, adding a harness |
| [architecture/file-exchange.md](architecture/file-exchange.md) | Who owns file exchange, share rules, applying changes, the search tools |
| [Pack exchange](../packages/exchange-packs/docs/packs.md) | File exchange by packs: packs, reply modes, instruction sections, the pack tools |
| [architecture/project-config.md](architecture/project-config.md) | The `.reiner/` folder, global config, profiles |
| [architecture/cli-ux.md](architecture/cli-ux.md) | TUI layout, keys, global commands, how harness commands plug in |
| [Harness docs: Microsoft 365 Copilot](../packages/harness-ms/docs/README.md) | The `m365-copilot` module, its commands, OneDrive file exchange, live checks |
| [plan.md](plan.md) | What is not built yet |
| [open-questions.md](open-questions.md) | Things to decide or verify |

The architecture docs cover what is global and the extension points every harness plugs into. Each
harness documents itself in its package's `docs/` folder (`../packages/harness-<vendor>/docs/`).

Status markers used in docs: **Proposed** (draft, open to change), **Accepted** or **Built** (with a date and a short "why"),
**Superseded**.
