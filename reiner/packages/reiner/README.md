# @co-reiner/reiner

Take the reins of your AI harness. `reiner` is a terminal agent that drives an AI harness you already
have, through its own page, the way a person would: no reverse engineering, no hidden APIs. It
starts with Microsoft 365 Copilot Chat in a browser window and adds what the page lacks: a prompt area in
your terminal, slash commands, your project's files going up as packs, the model's changes coming back and
applied after you approve them, and local search tools the model can call.

> Status: early concept. Expect rough edges and breaking changes.

## Warnings

- **Experimental reference implementation.** Reiner illustrates a browser-driven agent design for study
  and controlled evaluation. It is an early prototype with known security and reliability limitations, and
  is not recommended for production use or for confidential, personal or business-critical information.
- **Get permission first.** You must obtain any necessary authorisation before use: check that your
  intended automation and data sharing are permitted by the service provider, your subscription terms and
  your organisation. This project does not establish that your intended use is permitted, and an existing
  account or approved AI subscription does not mean this integration is approved. Use could lead to
  restrictions or loss of access under the provider's terms.
- **Evaluate with disposable projects.** Use only disposable projects and non-sensitive data. Reiner sends
  files and search results to the chosen service, some of it automatically, and changes project files and
  account settings (custom instructions, uploaded files). Review every change and keep independent backups.
- **Sensitive local state.** The `.reiner/` folder can contain live browser sessions, transcripts,
  instruction backups, project archives and downloaded files. Treat the whole folder as sensitive. Do not
  commit it, publish it in a package, or attach it to public issues. Removing local state does not erase
  records kept by the service.
- **No warranties, no security guarantees.** This is a concept implementation, built with AI. It comes as
  is, with no warranty of any kind and no guarantee that it is secure, correct or fit for any purpose (see
  the licence below).
- **Build your own through your organisation's processes.** If you want similar functionality within an
  organisation, use this project as a reference for an implementation developed and reviewed through your
  organisation's approved engineering, security, privacy and legal processes. Rebuilding the software does
  not by itself make it safe, or establish permission to automate a service.
- **Clone and change it freely.** You are welcome to clone this package or its [repository](https://github.com/co-reiner/reiner) and modify it as you wish.
- **Prefer issues to pull requests.** You can open a pull request, but the chances it will be reviewed or
  accepted are pretty low: most likely I will implement the fix it describes with my own agents. So please
  [open an issue](https://github.com/co-reiner/reiner/issues) instead, describing the problem or the fix.

## Requirements

- Node.js 22 or later, on Windows, macOS or Linux.
- Microsoft Edge or Google Chrome installed (or Playwright's Chromium).
- Git: Reiner shares files only from a git repository, so git's ignore rules keep private files out.
  In a folder without git it sends no files at all.
- A Microsoft 365 account with Copilot Chat.

## Install

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

This package brings the CLI ([`@co-reiner/cli`](https://www.npmjs.com/package/@co-reiner/cli))
together with its harnesses, today [`@co-reiner/harness-ms`](https://www.npmjs.com/package/@co-reiner/harness-ms)
for Microsoft 365 Copilot. The CLI on its own has no harness and is only useful for building on.

## Harnesses

`@co-reiner/reiner` installs these harnesses. Each one's README lists its commands, settings and first
steps.

| Harness                    | Id             | Package and guide                                                              |
| -------------------------- | -------------- | ------------------------------------------------------------------------------ |
| Microsoft 365 Copilot Chat | `m365-copilot` | [`@co-reiner/harness-ms`](https://www.npmjs.com/package/@co-reiner/harness-ms) |

## Getting started

1. Open a terminal in your project folder and run `reiner`. The first run creates `.reiner/` there and
   asks which harness to use (or run `reiner init --harness m365-copilot`).
2. A browser window opens on the harness. Follow the harness's first steps in its README, for example
   signing in and saving Reiner's instructions; for Copilot see
   [`@co-reiner/harness-ms`](https://www.npmjs.com/package/@co-reiner/harness-ms#getting-started).
3. Ask your question. Reiner sends the project with it where the harness supports files, and keeps the
   harness's copy current before each prompt.
4. When the model sends changes back, Reiner lists the files and asks before applying them to your
   project. Downloads, logs and other files in `.reiner/` are written without asking.

## Using it

**In the terminal UI:** type a prompt and press `Enter` (the prompt is a single line). `Esc` stops the turn: a reply that is still being written, or a prompt that has not been sent yet. Typing `/` lists the commands, with suggestions for
their arguments.

| Command               | Does                                                             |
| --------------------- | ---------------------------------------------------------------- |
| `/help`               | Lists every command.                                             |
| `/harness [id]`       | Lists harnesses, or switches and makes it the project's default. |
| `/status [--check]`   | Shows the project, harness, browser and sign-in.                 |
| `/browser show\|hide` | Shows the browser window, or runs it in the background.          |
| `/clear`, `/exit`     | Clears the screen; quits.                                        |

Each harness adds its own commands (sign-in, chats, models, file exchange), listed first in `/help`. For
Microsoft 365 Copilot they are in [its README](https://www.npmjs.com/package/@co-reiner/harness-ms#commands).

**From the shell:**

- `reiner -p "<prompt>"` sends one prompt and prints the reply as Markdown (`--new-chat` starts a chat
  first).
- `reiner <command> [args]` runs any command once, including the harness's, for example `reiner login` or
  `reiner chats --json` with Copilot. Questions that need a "y" are answered "no" when nothing can type, so
  those operations are declined. Other commands still do their normal work, such as signing in, sending a
  prompt or uploading packs.
- `reiner init`, `reiner harness [id]` and `reiner status [--check]` set up and inspect the project.
- Options for any run, before or after the command: `--harness <id>`, `--show-browser`, `--hide-browser`,
  and `--keep-browser` (keep a one-shot command's window open).

Only one Reiner session can use a project's browser profile at a time.

## How files are exchanged

How a harness takes files (packs, reply modes, cloud storage) is in its README; for Copilot see
[its file exchange](https://www.npmjs.com/package/@co-reiner/harness-ms#how-files-are-exchanged). What every harness shares:

- **What can be sent:** the files git tracks plus untracked files git does not ignore. Files git ignores,
  files reached through a symbolic link or junction, and everything in a folder without git are never
  sent. Git's ignore rules are not a secret scanner: anything git does not ignore can be sent.
- **Keeping the harness current:** after the whole project has gone to a chat, later prompts carry every
  file changed since, with a list of deleted files. After a chat has been idle for `staleMinutes`
  (default 10), the next prompt carries the whole project again.
- **Changes coming back** are listed and applied only after you approve them. Deletions go to your
  system's recycle bin, and only once the rest of the change has been checked; if a patch does not apply,
  nothing changes. Files the model overwrites are not backed up, so keep your work committed.
- **Tools:** the model can ask Reiner for `glob` and `grep` over the same files a pack could hold (plus
  git-ignored files you `include`). Their results go to the model without asking. It can also ask for
  files again with `share_files`, and for the whole project with `share_project` (after you approve).

## Configuration

Settings live in `.reiner/config.jsonc` in your project, with defaults for every project in
`~/.reiner/config.jsonc` (Windows: `%USERPROFILE%\.reiner\config.jsonc`). The project file wins, and
command-line options win over both. Edits to harness settings count without a restart.

```jsonc
{
  // each harness this project uses, with its settings
  "harnesses": {
    "m365-copilot": {
      "url": "https://m365.cloud.microsoft/chat",
      "include": ["generated/**"],
      "exclude": ["*.min.js", "fixtures/"],
      "staleMinutes": 10
    }
  },
  "defaultHarness": "m365-copilot",
  "browser": { "channel": "auto", "headless": false, "keepOpen": false }
}
```

**Every harness:**

| Key            | Default | Effect                                                                                                  |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `include`      | `[]`    | Glob patterns for git-ignored files the `glob` and `grep` tools may search anyway, e.g. generated code. |
| `exclude`      | `[]`    | Glob patterns for files those tools never search. Wins over `include` and over git.                     |
| `staleMinutes` | `10`    | Minutes a chat may be idle before its next prompt carries a full pack again.                            |

`include` and `exclude` affect searching only: packs always follow git's ignore rules. Patterns are
relative to the project root: `**` spans folders, `*` stays in one name, a pattern without `/` matches a
name in any folder, and a trailing `/` means a whole folder.

**Harness settings:** each harness has its own keys in its entry; Copilot's are in
[its README](https://www.npmjs.com/package/@co-reiner/harness-ms#settings).

**Browser:**

| Key        | Default | Effect                                                               |
| ---------- | ------- | -------------------------------------------------------------------- |
| `channel`  | `auto`  | `msedge`, `chrome`, `chromium`, or `auto` (the first one installed). |
| `headless` | `false` | `true` runs the browser in the background.                           |
| `keepOpen` | `false` | Keeps a one-shot command's window open afterwards.                   |

**The `.reiner/` folder** holds the browser profile (`profiles/`), saved state, packs, downloads,
transcripts and logs. Reiner writes a `.reiner/.gitignore` that keeps all of that out of git except
`config.jsonc`, and in a git repository it also adds `.reiner/` to `.git/info/exclude` (local, not
committed). Delete the folder to reset the project.

### Running your tests and linter

Reiner can run commands of your project for you, by name. Add them to `.reiner/config.jsonc`:

```jsonc
"tasks": {
  "test": "npm test",
  "lint": { "command": "npm run lint", "afterApply": true }
}
```

- A task marked `afterApply` runs each time you apply a change from the model. If it fails, Reiner asks
  whether to send the output back so the model can fix it.
- The model can also ask for a task by name. Reiner asks you first, once per task and session, and shows
  the command.
- The model can never choose the command: only the names you wrote here exist. After a change touched
  `package.json` or a script, Reiner asks again before the next run and names the files.
- A task runs in your project folder with your access to the machine. It gets no environment variables
  that look like secrets, and it is stopped after 10 minutes unless you set `timeoutSeconds`.

## Trademarks

Not affiliated with, endorsed by or sponsored by any of the companies or products named here. Microsoft
365, Copilot and OneDrive are trademarks of Microsoft Corporation; product names are trademarks of their
owners, used only to describe compatibility.

## Licence

MIT, copyright 2026 Alexandr Yeskov. See the LICENSE file in this package.
