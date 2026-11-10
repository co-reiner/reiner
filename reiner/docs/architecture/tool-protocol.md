# Tool protocol

Status: **Built** for the first four tools (2026-11-09): `share_files`, `share_project`, `glob` and `grep`
([file-exchange.md](file-exchange.md#tools)). The call and result format changed to the function-call
shape on 2026-11-11 ([below](#call-format-built)). The rest of the tool set, the tool registry and the
permission system are **Proposed** ([plan.md](../plan.md)).

The harness model cannot call our tools natively. Instead it writes tool calls as **text** in a fixed
format, Reiner parses them out of the reply, runs them, and sends back results as the next user message.
The code is `packages/core/src/tools/protocol.ts` (parsing, and the text that teaches the format) and
`packages/core/src/tools/run.ts` (answering the search tools).

## Design goals

- **Easy for the model to produce** inside a normal chat reply, without the harness mangling it.
- **Survives the harness renderer.** Harnesses render markdown and we read the rendered reply from the page
  (never from network traffic). Fenced code blocks survive rendering well and often have a copy button.
- **Easy to parse tolerantly.** A malformed call gets a short corrective message, not a crash.
- **Small.** The protocol text has to fit in the harness's custom instruction setting, which may have a
  character limit.

## Call format (built)

The model's whole reply is one fenced block tagged `reiner-tool` that holds one JSON object: a function
call, in the shape of OpenAI's `function_call` item.

````
```reiner-tool
{"type":"function_call","call_id":"call_1","name":"grep","arguments":{"pattern":"TODO","glob":"*.ts"}}
```
````

| Field | Meaning |
| --- | --- |
| `type` | Always `"function_call"`. |
| `call_id` | The model's own id for the call; Reiner's answer repeats it. Optional: without one, Reiner numbers the calls in a reply `call_1`, `call_2`, … |
| `name` | The tool: `share_files`, `share_project`, `glob` or `grep`. |
| `arguments` | The tool's arguments as a JSON object. A JSON **string** holding that object is read too, since that is how the API itself carries them. |

**Why this shape (2026-11-11).** The first harness, Microsoft 365 Copilot, offers models of the GPT-5.6
family. Those models are trained to call functions through OpenAI's Responses API, where a call is an
item with `type: "function_call"`, a `call_id`, a `name` and `arguments`, and its answer is an item with
`type: "function_call_output"`, the same `call_id` and an `output` string
([OpenAI function calling guide](https://developers.openai.com/api/docs/guides/function-calling)). Reiner
cannot use that API (we puppet the page, we never call the vendor), but it can ask for the same shape as
text, so the model writes and reads something it already knows. Before this date a call was
`{"tool":"grep","pattern":"TODO"}`, a shape of our own.

What the parser allows for:

- **The tag may not survive the harness's page.** A page can relabel code blocks with its own guessed
  language. So a reply that is nothing but one code block holding a JSON object with a `name` and
  `arguments` also counts as a call; a JSON example inside a normal answer never does.
  (Seen in Copilot: [module.md](../../packages/harness-ms/docs/module.md#page-lessons).)
- **Several calls in one reply** are several `reiner-tool` blocks, one object each. They are all answered
  in one message. (The API calls this parallel function calling.)
- **Only `name` and `arguments` are needed.** `type` and `call_id` may be left out, and the text the
  model is given shows that short form: `{"name":"grep","arguments":{"pattern":"TODO"}}`. Fewer fields
  mean fewer ways to get a call wrong, and plainer text in the harness's custom instructions
  ([packs.md](../../packages/exchange-packs/docs/packs.md#instructions-and-sections)).
- **No other shape is read.** The first built shape, `{"tool":"grep","pattern":"TODO"}`, is reported
  back as not being a function call (dropped 2026-11-11). Run `/instructions sync` to save the current
  text.
- **Every call is untrusted input.** The arguments are checked with the tool's zod schema; a block that
  does not parse, names an unknown tool or fails its schema is reported back to the model.

## Who answers a call

- **`glob` and `grep` are core's.** They only read what the share rules allow, so any harness can have
  them: `answerSearchCall` in `core/src/tools/run.ts`.
- **`run_task` is the host's.** Whoever answers a reply's calls passes it to the host
  (`ToolRunOptions.runTask`), which owns the project's config and the y/N ([below](#project-tasks)).
- **`share_files` and `share_project` are an exchange's.** They send files, and how files are sent is the
  harness's business ([file-exchange.md](file-exchange.md)).
- A harness with an exchange has it answer every call in a reply (`ProjectExchange.runTools`); the pack
  exchange uses core for the two search tools. A harness without one still gets `glob` and `grep`: the
  host calls core's `runSearchTools`, which also tells the model that the file tools are not available.
- The text that teaches the format (`TOOL_FORMAT_TEXT`) and the search tools (`SEARCH_TOOLS_TEXT`) is
  core's too. The pack exchange puts it in its `tools` section; a harness without packs that wants tools
  puts it in its own instructions.

A registry that tools are added to, with permissions, is still proposed ([plan.md](../plan.md)).

## Project tasks

Built (2026-11-12). `run_task` lets the model ask for one of the project's checks by name:
`{"name":"run_task","arguments":{"name":"test"}}`. The names and their commands are the user's, in the
project's `tasks` ([project-config.md](project-config.md#tasks)); the call carries no command, and any
other argument is dropped.

- **The answer** is the task's summary and the end of its output:
  `test: failed (exit code 1) in 12.3 s`, then the last lines. An unknown name gets the list of names; a
  "no" from the user gets "the user declined".
- **Asking.** y/N the first time a task is asked for in a session, and again after an applied patch
  touched a build manifest or a script. The question shows the command.
- **The same tasks run after an apply**, without the model asking, when marked `afterApply`. A failing
  one is sent to the model only if the user says yes; then its output goes as the next prompt, and the
  usual reply handling follows.
- **How the model learns of it.** Not from the saved instructions: once per chat, the prompt gets a line
  naming the project's tasks and the call. So adding or renaming a task needs no `/instructions sync`,
  and the wording Copilot accepted for the instructions stays as it is.
- **Where the code is.** `core/src/tools/tasks.ts` runs a task with its limits; `cli/src/tui/checks.ts`
  holds the questions, the session's approvals and the after-apply run.

Why names and not commands: everything a model writes is untrusted. With a free command, one poisoned
file and one tired "y" would be enough. With names, the worst a model can do is run your own tests.

## Result format (built)

Reiner answers in one plain user message, not in a code block: the facts line every Reiner message
starts with, then one `function_call_output` item per call, each on one line, then "Continue the task."

```
[Precise] project=myapp next-patch=003
{"type":"function_call_output","call_id":"call_1","output":"2 lines in 1 file match /TODO/ in *.ts:\nsrc/a.ts:4: // TODO tidy\nsrc/a.ts:9: // TODO test"}
Continue the task.
```

| Field | Meaning |
| --- | --- |
| `type` | Always `"function_call_output"`. |
| `call_id` | The id of the call this answers. A block that could not be read as a call at all is answered with `invalid_call`. |
| `output` | The result as text: what was attached, the matching paths or lines, or why the call was refused. Line breaks inside it are JSON-escaped. |

A pack that answers a call goes with the message as an attachment, as with any prompt; the `output` names
it. At most 3 tool rounds follow one prompt.

Known cost: because `output` is a JSON string, quotes and backslashes in `grep` lines are escaped. The
live check (`pnpm live:tools`) has not been run since the change; if the model misreads escaped lines,
the output can go back to plain text under the item.

## Lessons from the live tests

- Results go back as a plain message, not a fenced block.
- Keep the instruction sections short (near 3,000 characters together), and have the harness module
  check that saving them worked by reading them back.
- Without an explicit "never ask in plain text", the model asks the user to re-send files in prose.
- How reliably the model writes valid calls is still to measure ([plan.md](../plan.md), Measurements).

## Tool set

| Tool | Arguments | Side effect | Permission | Status |
| --- | --- | --- | --- | --- |
| `share_files` | `paths` or `all`, `reason` | uploads files the chat has seen | none needed | built |
| `share_project` | `reason` | uploads a full pack | y/N each time | built |
| `glob` | `pattern` | none | none needed | built |
| `run_task` | `name` | runs one of the project's own commands | y/N the first time each session | built |
| `grep` | `pattern`, `glob`, `ignoreCase` | none | none needed | built |
| `read_file` | `path`, `offset`, `limit` | none | allow | proposed |
| `list_dir` | `path`, `depth` | none | allow | proposed |
| `write_file` | `path`, `content` | writes | ask | proposed |
| `edit_file` | `path`, `old`, `new` | writes | ask | proposed |
| `run_command` | `command`, `cwd`, `timeout` | anything | ask | proposed, and not planned next: `run_task` covers tests and linting without letting the model choose a command |
| `fetch_url` | `url` | network | ask | proposed |

`glob` and `grep` search only the files the share rules allow, adjusted per harness by `include` and
`exclude` in `.reiner/config.jsonc` ([project-config.md](project-config.md#search-include-and-exclude)).
A glob such as `src/**` narrows the folder; there is no separate `path` argument. A pattern from the model
may hold at most three `**`, and four `*` in any one name: each wildcard multiplies the work of testing a
path, and a pattern must not stall the TUI. Paths are relative to
the project root, and nothing outside it is listed or sent.

For the proposed write tools, JSON escaping of large file contents is error-prone for models. The API has
an answer for that too, a custom tool whose input is plain text rather than JSON; whether to ask for that
shape as text is open.

## Instruction text

The model learns the format from the `tools` section Reiner places in the harness's custom instructions
(or, for a chat that has not had them, the first prompt): one sentence with a call, then one line per
tool, all in plain text. The sentence and the search tools' lines are core's (`protocol.ts`); the pack
exchange adds the lines for its two tools (`exchange-packs/src/instructions.ts`).

Proposed: core renders it from a tool registry (names, one-line descriptions, zod argument schemas
compacted to a short signature), and modules decide where it goes and enforce the harness's size limit.

## Context and message limits (proposed)

- Results longer than a module-defined limit are truncated with a note telling the model how to page
  (`offset`/`limit`), or, for a harness that takes uploads, sent as a file in a pack.
- The session counts harness messages per chat. Near the limit it summarises and starts a fresh chat.
