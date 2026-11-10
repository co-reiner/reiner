# Copilot file exchange

How the `m365-copilot` harness exchanges files: it uses the pack exchange (`@co-reiner/exchange-packs`) and adds what is Copilot's own (the reasons are in
[file exchange: why it works this way](../../exchange-packs/docs/packs.md#why-it-works-this-way)). The generic parts (packs, share rules,
reply modes as a concept, instruction sections, tools, applying changes) are in
[file-exchange.md](../../../docs/architecture/file-exchange.md).

Code: `src/copilot/module.ts` (creates the exchange), `src/copilot/page-files.ts` (uploads, download
links, co-editing), `src/copilot/drive.ts` (OneDrive, `prepareTransfer`), `src/copilot/uploads.ts`
(Copilot's uploads folder), `src/copilot/instructions.ts` (custom instructions), `src/copilot/transfer.ts`
(the `onedrive` mode), `src/commands/` (`/transfer`, `/pack`, `/apply`, `/instructions`).

## What the module declares

```ts
const transfer = {
  modes: [DIFF_MODE, downloadMode(saveReplyLinks), onedriveMode(state)],
  defaultMode: 'diff',
  index: true, // Copilot's model runs code on uploads, so packs may carry the index
};
const exchange = createPackExchange({ root, reinerDir, stateDir, displayName, settings, support: transfer });
```

The module sets `exchange` (the hook the host calls) and keeps the rest for its own commands: `transfer`,
`prepareTransfer`, `uploads` and `customInstructions` (`PackHarness` in `src/commands/types.ts`). From
the page it fills in `send(prompt, { attachments })` and `ChatReply.downloads`.

## Packs: `.zip.docx`

- **Why `.zip.docx`:** Copilot's upload control does not accept `.zip`. A ZIP named `.docx` is accepted,
  and the model opens it as a ZIP when told to. The `files` instruction section says so.
- **Uploading:** through the "+" menu's "Upload images and files" item, the same file chooser a user gets.
  Copilot keeps every upload in OneDrive under `Microsoft Copilot Chat Files` (setting `uploadsFolder`).
  The upload counts as done when the attachment chip gets an `SPO_…` id.
- **One name, replaced in place:** the full pack is always `<project>.zip.docx`, so refreshing it does not
  leave a copy per refresh in OneDrive. Copilot's upload control never replaces: a repeated name is
  renamed (`<name>.zip <number>.docx`), which hides the `.zip` from the model. So before each upload the module opens
  the upload folder in OneDrive and moves any file of the same name to the **OneDrive recycle bin** through
  OneDrive's own page (right-click, Delete, confirm), then uploads (`src/copilot/uploads.ts`). That is one
  OneDrive visit per pack upload, and packs are only uploaded when files changed. The old copy
  stays recoverable in the recycle bin, and counts toward storage until OneDrive empties it. On a
  project's first upload the OneDrive address is not known yet (see [OneDrive](#onedrive)), so that visit
  is skipped with a status note and the upload goes ahead.
- **Part packs** keep one name too (`<project>.part.zip.docx`, cumulative since the full pack) and are
  replaced the same way. Stamped full packs and numbered part packs left by earlier versions and
  renamed duplicates can be removed with [`/transfer clean`](commands.md#transfer-clean).

## Reply modes

| Mode       | The model…                                                                                                         | Reiner…                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `diff`     | Replies with one fenced `diff` block in `git diff` format                                                          | Runs `git apply --recount` (checks first)                                                                                 |
| `download` | Creates `<project>.patch.<NNN>.patch` (`git diff --binary`), or a plain ZIP of changed and new files, and links it | `downloadReplyFiles` clicks the reply's download links (`a[download]`) and Reiner applies the file                        |
| `onedrive` | Saves `<project>.patch.<NNN>.zip.docx` as a file it creates                                                        | `fetchCreatedFiles` opens OneDrive's web page, downloads the file from `Documents/Copilot/Created`, and Reiner applies it |

For `download`, a link is matched by its exact `download` name first, then by exact text, and only then
by a name its text contains, so `a.zip` never picks `data.zip`.

**File cards** (since 2026-11-12). A file the model saves to OneDrive can show in the reply as a card
("Saved in … OneDrive") with no link: its name is the card title, and Reiner downloads it through the
card's own **More actions** menu, item **Download** (selectors `FILE_CARD`, `fileCardNamed`). Every mode
counts cards: `download` (and `diff`, which fetches through it) takes them with the links, and `onedrive`
tries the card first and opens OneDrive's page only for a name no card offered. Copilot sometimes shows the same card twice
in one reply; each name is downloaded once, from the last card. Only files after the newest prompt count,
not that prompt's own attachments. A reply read back from the history after a restart (`/apply`) has
no list of files, so its files are read from the page then.

`diff` and `download` come from `@co-reiner/exchange-packs`; `onedrive` is defined in this package
(`onedriveMode` in `src/copilot/transfer.ts`), whole: its wording for the model ("create
NAME.patch.NUMBER.zip.docx as a file for me (it lands in OneDrive, in …)", naming the folder from the
`createdFolder` setting) and how its patch is fetched from OneDrive's page. When the name is taken,
OneDrive saves the patch as `<project>.patch.<NNN>.zip <number>.docx` and Copilot names that, so a reply
naming either form is fetched.

ZIP patches saved as documents (`*.zip.docx`) may hold Word wrapper entries (`[Content_Types].xml`,
`_rels/`, `package/`, `docProps/`); core drops them from those only. A real Word document (one with
`word/document.xml`) is never read as a patch: Reiner says so, keeps it in `.reiner/incoming/` and offers
to save it to the project root ([reading received files](../../../docs/architecture/file-exchange.md#applying-changes)).

## OneDrive

Reiner reads OneDrive through its own web page, in a tab of its own next to the chat, as a person would. It never calls
Microsoft Graph.

- The user's OneDrive address is read from links in the Copilot page (uploaded files link to it) and
  kept in `.reiner/modules/m365-copilot/drive.json`. The `oneDriveUrl` setting overrides it. Until an
  upload has happened and no setting is given, Reiner says it cannot find the address yet (`/transfer
  onedrive`, `/transfer clean`); only the clean-up before an upload carries on without it.
- The folder for created files is `Documents/Copilot/Created` inside the `Documents` library ("My
  files"). The `createdFolder` setting overrides it.
- A folder that does not exist yet shows no column header row; Reiner reports it as missing. That only
  counts while the tab is still on the OneDrive site: if it ended on another host (a sign-in page), Reiner
  stops with an error instead, so it does not ask Copilot to set up a folder that may exist.
- Each OneDrive visit opens a new tab in the harness's window and closes it when done ([overview](../../../docs/architecture/overview.md#harnesses-and-the-live-browser): side
  pages in a short-lived tab). The chat tab stays on the chat, so nothing reloads and the model is not
  reset.

### Missing folders

**Reiner never creates OneDrive folders itself.** `/transfer onedrive` calls `prepareTransfer`, which
checks the folder. If it is missing, it asks Copilot to create a small Word document
(`reiner-setup.docx`), which makes Copilot set up its folders, then checks again. It also returns the
names already in the folder, so patch numbers used there are skipped.

## Custom instructions

The sections live in Copilot's custom instructions, under Settings → Personalization → Customize
Copilot. Copilot checks what is saved there and refuses some texts ("Your instructions may contain content that
violates Microsoft's responsible AI policy"). The sections use the wording it accepted on 2026-11-12, and
why earlier wordings failed is recorded with them
([packs.md](../../exchange-packs/docs/packs.md#instructions-and-sections)). Esc during `/instructions sync`
cancels it: before Save is pressed nothing has changed and the dialog is closed; after, the command says
that Save had already been pressed. `customInstructions.read()` opens the dialog and reads the field until its text stops
changing (it loads a moment after the field appears). `write(text)` fills the field and presses Save.

- **Closing the dialog too soon after "Save customization" loses the save without any message.** Reiner
  waits 3 seconds after saving, reads the text back from a fresh dialog, and saves once more if it does
  not match. If it still does not match, the error quotes anything Copilot showed; the backup in
  `.reiner/modules/m365-copilot/instructions-backups/` holds the text.
- The field took 20,000 characters without complaint; no length limit was seen. Reiner keeps its
  sections near 3,000 characters together anyway (with four tools and the index).

## Co-editing documents

Copilot can open a document it created for co-editing (Word for the web inside the page). While open,
it stays in the prompt context. After every reply Reiner looks for such an editor frame (`officeapps`,
`Doc.aspx`, WOPI) and clicks the close button of the panel around it, then says so (`ChatReply.closedDocument`).
In the live tests Copilot saved documents without opening an editor, so this path has not
been seen live yet; the selectors are `COEDIT_FRAME` and `COEDIT_CLOSE` in `selectors.ts`.

## Live checks

See [module.md](module.md#live-checks). `pnpm live:transfer` runs all three modes; `pnpm live:instructions`
saves and reads back the sections; `pnpm live:tools` checks the tool round trips.
