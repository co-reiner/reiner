# Plugins

Built. A plugin adds to every harness what Reiner itself does not: tools the model may call, a line for the
prompt, slash commands and a status badge. The CLI knows plugins only through the contract in core
(`core/src/plugin.ts`); it has no code for any one plugin. The first plugin is MCP
(`@co-reiner/mcp`, [tool protocol: external tools](tool-protocol.md#external-tools-mcp)).

**Why plugins.** MCP is not part of driving a harness, and not every install needs it: the bare CLI should
not carry an MCP client and its dependencies, nor know MCP's names. Handing plugins in, as harnesses are
handed in ([distribution](tech-stack.md#distribution)), keeps the CLI a host and lets a later plugin come
without a CLI change.

## How a plugin reaches the CLI

- `@co-reiner/reiner` passes its plugins to the CLI's `run(loadHarnesses, loadPlugins)`
  (`packages/reiner/bin/reiner.js`). The bare `reiner-cli` passes none, and then has no plugin commands,
  lines, tools or badges.
- The CLI keeps them in `cli/src/plugins.ts`, and each session starts every plugin's session
  (`ReinerPlugin.start`) with a `PluginContext`: the project root, `.reiner/`, the project's config file,
  Reiner's version, and `readConfig()`, the merged config with every key.
- Core's config schema keeps keys it does not name, so a plugin reads and checks its own block (`mcp` for
  the MCP plugin). A plugin's commands may write its settings with `setConfigValue`.

## The contract

A `PluginSession` (one per plugin and session):

| Method | The host calls it | Used for |
| --- | --- | --- |
| `promptLine(chatId, host)` | before each send; the text goes after the user's prompt | telling a chat what it may call, once per chat |
| `promptSent(chatId)` | after the send went | remembering which chats were told |
| `toolNames(host)` | when a reply is read | the names `extractToolCalls` takes as calls to this plugin |
| `call(name, args, host)` | for each call to one of its names | answering it, after any y/N of its own |
| `status()` | when the status line draws | a few words, yellow with `warn` |
| `close()` | on quit | stopping what it started |

`PluginHost` gives a plugin the harness's name, `print`, `busy` and `confirm`; a plugin's command gets
`choose` too, a tick list that can be a tree and can be cancelled. A plugin starts nothing until a method
needs it.

**Names.** A plugin's tool names hold `__` (`figma__get_metadata`), so they never take one of Reiner's own
tools; when two plugins name the same tool, the first one handed in answers it. A plugin's command never
takes the name of a global or a harness command.

**Calls.** The CLI passes the plugins' calls through `ToolRunOptions.callExternal`, so they are answered
whichever exchange answers the reply, and their attachments (an image) go with the answer.

## Code

- `core/src/plugin.ts`: the contract.
- `cli/src/plugins.ts`: the plugins of a run; `cli/src/tui/plugin-host.ts`: lines, tool names and calls in
  a chat turn; `cli/src/tui/commands/plugin.ts`: a plugin's command as a slash command.
- `packages/mcp/src/plugin/`: the MCP plugin.
