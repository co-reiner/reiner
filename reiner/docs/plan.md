# Implementation plan

Started 2026-11-07. Status as of 2026-11-11, checked against the code.

This file lists only what is **not built yet**. What is built is described by the architecture docs
([docs/README.md](README.md)), the user guide in `packages/reiner/README.md` and the Copilot harness docs
in `packages/harness-ms/docs/`; an item is taken out of this list when it is built.

## Not yet

### Foundations

- tsdown builds: the root `pnpm build` script exists, but no package has a `build` script yet, so the
  CLI only runs from source through tsx.
- CI on Windows, macOS and Linux.

### Measurements (were the M1 spikes)

- **Protocol compliance:** how reliably the model writes valid tool calls across 20 or so representative
  tasks. `share_files`, `glob` and `grep` have a live check (`live:tools`); `share_project` only unit tests.
- **Live checks after the 2026-11-11 fixes:** the first upload of a fresh project, a chat that fails to
  open, a OneDrive tab that ends off the site and reply downloads by exact name were changed from
  reading the code and have not been run against the page.
- **Limits:** longest prompt Copilot accepts, messages per chat before it degrades, upload size and type
  rules per tenant.
- **Headless sessions:** whether the tenant keeps a headless profile signed in, and for how long.

### Tool layer (was M2/M3)

- Tool registry and runtime in `core`. Today the two search tools are answered by core
  (`core/src/tools/run.ts`) and the two file tools by the pack exchange; there is no registry to add a
  tool to, and no permissions.
- Tools in one-shot use: `reiner -p` sends the prompt and prints the reply, but does not run tool calls.
- More read-only local tools: `read_file`, `list_dir` ([tool-protocol.md](architecture/tool-protocol.md)).
- Write and command tools (`write_file`, `edit_file`, `run_command`, `fetch_url`) behind permissions. The
  project's own tasks can be run by name (`run_task`); a free command cannot, on purpose.
- Tasks: arguments (one test file), running in a throwaway worktree or a container, and a results file
  for long output. Today a task takes no argument, runs in the project folder, and only the end of its
  output is sent.
- Permission system: `permissions` in config, approval dialogs, `/permissions`.
- Tool results larger than the prompt limit: paging, or sending them as a file.

### TUI

- Multi-line prompts: `Shift+Enter` or `\` + `Enter` for a new line. The prompt is one line today
  ([cli-ux.md](architecture/cli-ux.md#keys)).
- JSON output for `reiner status` (`--json` only covers harness commands).

### Project files

- `.reiner/instructions.md`: project instructions added to the protocol
  ([project-config.md](architecture/project-config.md#layout)).
- Global config beyond `defaultHarness` and the browser: `theme` and permission defaults are not read.

### Chat lifecycle

- Counting messages per chat, rolling over to a fresh chat with a summary, `/compact`.
- `/mode` for harness modes (work or web grounding, agents).

### Hardening

- `reiner doctor` with selector self-tests against the live page.
- Offline module tests against recorded page fixtures.
- Packaging and install docs for Windows, macOS and Linux; npm publishing.
- Co-editing close: built from the shape of Office for the web, not yet seen live.

## Later

- Reiner Agent (`../reiner-agent/`): an unattended, Docker-hosted runner that reuses `core`, `browser`
  and the harness modules. Keeping those packages free of TUI code makes this possible.
- Subagents: several tabs or windows per harness (see the overview).
- More harness modules (other browser-only assistants), each declaring its own file-exchange modes.
- Third-party module loading.
- MCP bridge: expose MCP servers' tools through the same protocol.
