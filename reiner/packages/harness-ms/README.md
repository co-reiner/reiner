# @co-reiner/harness-ms

The Microsoft 365 Copilot harness for [Reiner](https://github.com/co-reiner/reiner) (`m365-copilot`): lets
the `reiner` command drive Microsoft 365 Copilot Chat through its own web page, the way a person would.
Install it through [`@co-reiner/reiner`](https://www.npmjs.com/package/@co-reiner/reiner), which brings
the CLI and this harness; that README covers what every harness shares (install, global commands, the
`.reiner/` folder, browser settings).

Not affiliated with or endorsed by Microsoft. Microsoft 365, Copilot and OneDrive are trademarks of
Microsoft Corporation, used here only to describe compatibility.

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

## Getting started

1. Run `reiner` in your project folder. A browser window opens on Copilot.
2. Sign in once with `/login`; the sign-in is kept in the project's browser profile. If Copilot asks you to
   sign in again after every restart (your organisation has turned "Stay signed in?" off), set
   `"browser": { "keepSession": true }` in `.reiner/config.jsonc`; read the
   [security notes](https://github.com/co-reiner/reiner/blob/main/reiner/docs/architecture/project-config.md#security-notes) first.
3. Run `/instructions sync` to save Reiner's short instructions in Copilot's custom instructions. It shows
   what will change, backs up what was there, and asks before saving. Until then, the instructions go in
   the prompt.
4. Run `/pack` to send the whole project with your next prompt, then ask your question. After that, files
   you change go automatically as part packs before each prompt.

## Commands

These come with Copilot, listed before Reiner's own in `/help`. Each also runs once from the shell as
`reiner <command> [args]`.

| Command                                                 | Does                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/login`                                                | Signs in to Copilot in its window.                                                                       |
| `/new`, `/chats`, `/chat <name or number>`              | Starts a chat, lists recent chats, switches chat.                                                        |
| `/history [turns]`, `/rename <title>`, `/delete [chat]` | Shows the latest turns, renames or deletes a chat (asks first; titles with "(Keep)" are never deleted).  |
| `/models`, `/model <name>`                              | Lists Copilot's models; picks one by part of its name, for the open chat and new ones (below).           |
| `/pack`                                                 | Packs the whole project for the next prompt.                                                             |
| `/transfer [mode]`                                      | Shows or switches how changes come back (below).                                                         |
| `/transfer index on\|off`                               | Adds a search index to packs, or leaves it out.                                                          |
| `/transfer clean`                                       | Lists this project's old packs in Copilot's uploads; tick them to move them to the OneDrive recycle bin. |
| `/instructions [sync\|remove]`                          | Shows, saves or removes Reiner's sections in Copilot's custom instructions.                              |
| `/apply`                                                | Offers the last reply's file changes again.                                                              |

## Models and chats

`/model` switches the model in the chat that is open, at once, and saves it as the project's model. Every
new chat starts with it: `/new` and a fresh start select it straight away, and warn you, naming the
model, when Copilot does not offer it right now. An existing chat keeps the model it was last using:
opening it, with `/chat` or when Reiner reopens your last chat on start, never
switches the model, and Reiner tells you when it differs from the project's. Copilot sometimes hides
models for a while. To keep one at hand, make a buffer chat: start a chat with that model, send a basic
prompt ("Reply with ok."), and `/rename Buffer <model>`. When the model is missing in a new chat,
`/chat buffer`, rename it for your work, and make a new buffer later.

## How files are exchanged

What may be sent, and how changes are applied, is the same for every harness (see
[`@co-reiner/reiner`](https://www.npmjs.com/package/@co-reiner/reiner#how-files-are-exchanged)). For Copilot:

- **Up:** a pack is a ZIP of the project saved as `<project>.zip.docx`, so Copilot accepts it as an upload.
  Changes since go as `<project>.part.zip.docx`, with the list of deleted files inside. Packs keep their names: Reiner moves the earlier upload of the same name to the OneDrive
  recycle bin first. Storage use can still grow (the recycle bin counts), and a file of the same name from
  another project with the same folder name, or one you uploaded yourself, is moved too.
- **Down:** pick one mode with `/transfer`, then run `/instructions sync` again so the saved instructions
  describe it (Reiner warns you):
  - `diff`: the model replies with a `git diff`, which Reiner applies with `git apply`.
  - `download`: the model links a patch file; Reiner downloads and applies it.
  - `onedrive`: the model saves a patch file to OneDrive; Reiner fetches it from OneDrive's page.
- **Documents are not patches.** If Copilot links or saves a real Word, Excel or PowerPoint file (a report
  you asked for, or a document made by mistake instead of a patch), Reiner applies nothing from it. It
  says what arrived, keeps it in `.reiner/incoming/`, and asks whether to save it to the project root,
  under a new name if one is taken.

## Settings

Copilot's keys in its `harnesses` entry in `.reiner/config.jsonc`, next to the keys every harness has
(see [`@co-reiner/reiner`](https://www.npmjs.com/package/@co-reiner/reiner#configuration)):

| Key             | Default                             | Effect                                                                                  |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| `url`           | `https://m365.cloud.microsoft/chat` | Where Copilot Chat lives.                                                               |
| `oneDriveUrl`   | read from the page                  | Your OneDrive site, e.g. `https://contoso-my.sharepoint.com/personal/user_contoso_com`. |
| `createdFolder` | `Documents/Copilot/Created`         | OneDrive folder where Copilot saves files it creates (`onedrive` mode).                 |
| `uploadsFolder` | `Microsoft Copilot Chat Files`      | OneDrive folder where Copilot keeps uploads.                                            |

The folder names may differ by language or organisation; set them if Reiner cannot find a folder. Reiner
never creates OneDrive folders itself: if the created-files folder is missing, it asks Copilot to create a
small document, which makes Copilot set the folder up.

## Licence

MIT, copyright 2026 Alexandr Yeskov. See the LICENSE file in this package.
