# Project configuration and the `.reiner/` folder

Status: **Proposed** (2026-11-07)

Everything Reiner needs for a project lives in `.reiner/` at the project root, including the browser
profile. Delete the folder and the project is back to a clean state.

## Layout

```
<project>/
  .reiner/
    .gitignore              # written by Reiner: keeps everything below except config.jsonc out of git
    config.jsonc            # project settings (safe to share, but the folder is ignored by default)
    instructions.md         # planned: project instructions appended to the protocol (like CLAUDE.md)
    profiles/
      <module-id>/          # Playwright persistent user data dir: cookies, local storage. SECRET.
    modules/
      <module-id>/          # module state, e.g. saved model, chat lists, transfer settings, backups
    outgoing/               # packs made for upload
    incoming/               # patches and files downloaded from the harness
    sessions/
      2026-11-07T21-55-00/  # transcript.jsonl
    logs/
      reiner.log
```

## Global config

`~/.reiner/config.jsonc` (Windows: `%USERPROFILE%\.reiner\config.jsonc`) holds user defaults:
`defaultHarness` (new projects use it without asking), browser channel, theme, permission defaults.
Project config overrides global config, and CLI flags override both.

The project root is the nearest folder, from where Reiner starts upwards, that has a `.reiner/` folder;
with none, the start folder. The home folder is skipped on the way up (2026-11-11): its `.reiner/` is
this global one, and counting it would make the home folder the project of every new folder below it. The
home folder is still a project when Reiner is started in it.

## Example `config.jsonc`

```jsonc
{
  // harnesses this project uses, each with its own settings, in the order they were added;
  // /harness <id> switches, adds the harness if it is new, and updates defaultHarness
  "harnesses": {
    "m365-copilot": {
      // the harness's own settings, documented by its package (here: Copilot's page address)
      "url": "https://m365.cloud.microsoft/chat",
      // every harness: glob and grep tools, git-ignored files to search anyway, and files never to search
      "include": ["generated/**"],
      "exclude": ["*.min.js", "fixtures/"]
    }
  },
  "defaultHarness": "m365-copilot",
  // commands of this project Reiner may run by name (see Tasks below)
  "tasks": {
    "test": "pnpm test",
    "lint": { "command": "pnpm lint", "afterApply": true, "timeoutSeconds": 120 }
  },
  // headless: false (default) shows the harness window; keepOpen applies to one-shot commands only;
  // keepSession: true keeps a sign-in that would end when the browser closes (see Security notes)
  "browser": { "channel": "msedge", "headless": false, "keepOpen": false, "keepSession": false },
  "permissions": {
    "allow": ["read_file", "list_dir", "glob", "grep"],
    "ask": ["write_file", "edit_file", "run_command", "fetch_url"],
    "deny": []
  }
}
```

`permissions` is planned (M3), not read yet.

`harnesses` maps a harness id to that harness's settings object. The keys in it are whatever its module
reads, documented in the harness's package (Copilot's `url`, `createdFolder` and `oneDriveUrl` are in
[its module doc](../../packages/harness-ms/docs/module.md#settings)), plus the settings every harness
has (next section). A harness new to the project starts with its module's
defaults; one already listed keeps its settings. In the global config, `harnesses` entries give settings to
every project, and a project's own entry for the same harness overrides them key by key.

## Harness settings

Keys Reiner itself reads in every harness's entry, whatever the harness. They are read fresh when used, so
an edit counts without restarting:

| Key | Default | Effect |
| --- | --- | --- |
| `include`, `exclude` | `[]` | Search patterns for the `glob` and `grep` tools (next section). |
| `staleMinutes` | `10` | Minutes a chat may be idle before its next prompt carries a full pack again, in case the harness's sandbox dropped its files ([keeping the project current](../../packages/exchange-packs/docs/packs.md#keeping-the-project-current)). |

## Tasks

Built (2026-11-12). `tasks` names commands of the project that Reiner may run: its tests, its linter, its
type check. A task is a command line, or an object with options:

| Key | Default | Meaning |
| --- | --- | --- |
| `command` | required | The command line, run in a shell in the project root |
| `afterApply` | `false` | Run it after you apply a change from the model |
| `timeoutSeconds` | `600` | Stop it, and everything it started, after this long |

A name is letters, digits, `-` and `_`. Two things use the list
([tool-protocol.md](tool-protocol.md#project-tasks)):

- **After an apply.** Tasks marked `afterApply` run once you have said yes to a change. Each result is
  shown. If one fails, Reiner asks whether to send its output to the model so it can fix it.
- **On the model's request.** The model can ask for a task by name with `run_task`. You are asked y/N the
  first time each task is asked for in a session.

Why it is safe to switch on:

- **The model never chooses a command.** It gives a name; the command is the one written here.
- **Only the project's own config counts.** `tasks` in the global config is ignored, so no setting
  elsewhere makes a project runnable.
- **A patch that changes what a task runs is asked about again.** After an applied change touched a build
  manifest (`package.json`, a `Makefile`, a project file) or a script, the next run asks first and names
  the files, whatever was agreed before. Applying a patch and then running the tests runs the patch's
  code, so this is the moment to look.
- **Limits on every run:** the project root as working folder, a time limit that stops the whole process
  tree, no environment variables that look like secrets (names containing `TOKEN`, `SECRET`, `PASSWORD`,
  `KEY`, `CREDENTIAL` or `AUTH`), and only the end of the output (4,000 characters) is kept.

What it does not do: it does not isolate the run. A task has your user's access to the machine, as it
does when you run it yourself.

## Search `include` and `exclude`

Each harness's entry in `harnesses` can hold two lists of glob patterns for the model's `glob` and `grep` tools
([file-exchange.md](file-exchange.md#tools)). There is no slash command for them: edit `config.jsonc`
(or the global config for every project). They are read on every tool call, so an edit counts at once.

| Key | Effect |
| --- | --- |
| `include` | Adds back files git ignores, tracked or not, e.g. generated code. |
| `exclude` | Hides files from both tools. Wins over `include` and over git. |

- Patterns use the tools' glob syntax: `**` spans folders, `*` and `?` stay in one name, `{a,b}` and
  `[abc]` work, a pattern without `/` matches the name in any folder (`*.log`), and a trailing `/` means
  the whole folder (`fixtures/`). Paths are relative to the project root; case is ignored.
- `include` never gets past the folder rule: nothing outside the project, in `.git/` or `.reiner/`, or
  reached through a link. Without git the tools list nothing at all.
- They apply to `glob` and `grep` only. Packs (`/pack`, `share_project`) and `share_files` keep the plain
  share rules, so a file found through `include` is searchable but not uploaded.
- New project configs get empty lists. If either key is not a list of strings, `glob` and `grep` are not
  run; the model is told the settings need fixing and the TUI shows the details.

## Git ignore

`.reiner/` should be in the user's global git ignore. Two things cover a user who has not set that up:

- **`.reiner/.gitignore`**, written whenever `.reiner/` is set up and the file is missing (also in existing
  projects, which get it on their next start). It ignores what is private or generated: `profiles/`
  (session cookies), `modules/` (saved state, including custom-instruction backups), `incoming/` and
  `outgoing/` (transferred files), `sessions/` (transcripts) and `logs/`. `config.jsonc` stays committable.
  Reiner never overwrites the file, so the user can change it.
- **`.git/info/exclude`**: on first run in a project whose root is a git checkout, if `.reiner/` is not
  ignored, Reiner adds it there (local, not committed) and tells the user, so the whole folder stays out
  by default. A linked worktree or a submodule has a `.git` file, not a folder; Reiner follows it to the
  repository's own `info/exclude` (2026-11-11). A project in a sub-folder of a larger repository gets no
  exclude entry, only the `.reiner/.gitignore` above.

Reiner never edits the project's own `.gitignore` without asking.

## Security notes

- `profiles/` holds live session cookies for the user's harness accounts (for example Microsoft 365).
  Treat it like a password.
- `browser.keepSession` (off by default) is for accounts that are asked to sign in after every restart:
  when "Stay signed in?" is turned off (often by the organisation), the sign-in lives in session cookies,
  which the browser drops when it closes. With it on, the browser starts with its own
  `--restore-last-session` option, which keeps those cookies in the profile on disk; the sign-in then lasts
  until the server ends it. Reiner never reads or copies the cookies. It may go against an organisation's
  choice to turn "Stay signed in" off, so it is the user's call. The tabs the browser restores are closed
  at once, leaving the one Reiner drives.
- On macOS and Linux, create `.reiner/profiles/` with `0700` permissions.
- One profile per project means one sign-in per project. A `profile: "global"` option can point all
  projects at `~/.reiner/profiles/` for users who prefer a single sign-in. To decide.
