# @co-reiner/harness-gs

An experimental harness for [Reiner](https://github.com/co-reiner/reiner) (`google-search`): lets the
`reiner` command talk to the AI mode of Google Search through its own web page, the way a person would.
Install it through [`@co-reiner/reiner`](https://www.npmjs.com/package/@co-reiner/reiner), which brings
the CLI and this harness; that README covers what every harness shares (install, global commands, the
`.reiner/` folder, browser settings).

Not affiliated with or endorsed by Google. Google and Google Search are trademarks of Google LLC, used
here only to describe compatibility.

## What this is, and what it is not

- **A trial of a concept, for education and exploration.** This harness exists to find out whether the
  idea behind Reiner (a terminal on top of a chat page) carries over to a second, very different page.
  It is not a product, not a way to use Google at scale, and not meant for regular work.
- **Google actively blocks robots, and this project does not try to get around that.** Google decides
  who may use its pages. When it suspects automation it asks the person to confirm they are not a
  robot, or quietly stops answering.
- **When Google blocks, the harness stops and hands over to you.** It shows the browser window (also
  when it was running hidden), and waits. You answer the check yourself, or you do not. The harness never
  answers a check, never retries around one, and uses nothing that hides the automation: no stealth
  settings, no changed browser fingerprint, no vendor APIs, no reading of network traffic.
- **There is no intent to hack around anything.** If Google blocks this for good, the experiment has its
  answer and ends there.

## Warnings

- **Experimental reference implementation.** An early prototype with known security and reliability
  limitations, not recommended for production use or for confidential, personal or business-critical
  information.
- **Get permission first.** Check that automated use and the data you share are permitted by Google's
  terms and by your organisation. This project does not establish that your intended use is permitted.
  Use could lead to restrictions on your access.
- **What you share leaves your machine.** Files you share, search results and command output go to
  Google as part of your prompts. Without a Google account the conversation is not tied to one, but it
  is still sent. Use disposable projects and non-sensitive data only.
- **Review every change.** Replies are a model's suggestions. Nothing is written to your project without
  your "y", and deleted files only go to the recycle bin.
- **Sensitive local state.** The `.reiner/` folder holds a browser profile and transcripts. Do not commit
  or publish it.
- **No warranties, no security guarantees.** A concept implementation, built with AI, provided as is.

## Getting started

1. In your project folder run `reiner init --harness google-search` (or pick it with `/harness`).
2. Start `reiner`. A browser window opens on Google's AI mode. No Google account is needed.
3. Share what your question is about, then ask in plain words:

   ```
   /share src/words.js
   Can you add a countWords(text) function to my words.js file?
   ```

4. When the reply holds a changed file, Reiner shows it and asks before writing anything.

If Google asks whether you are a robot, Reiner says so and shows the window: answer it there, run
`/login` if Reiner is still waiting, and send your prompt again.

## Commands

| Command                            | Does                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/login`                           | Show the browser window so you can answer Google's robot check (or sign in to Google by hand)    |
| `/new`                             | Start a new conversation                                                                         |
| `/share [paths or globs \| clear]` | Queue project files to go with your next prompt; no argument shows the queue                     |
| `/transfer [text \| upload]`       | How shared files travel: quoted in the prompt, or as one text file through the page's "+" button |
| `/apply`                           | Offer the last reply's file changes again                                                        |

## How files are exchanged

- **You choose what goes.** Only files you queue with `/share`, or files the model asks for by name, are
  sent, and only files your git repository would share (nothing git ignores, nothing in `.git/` or
  `.reiner/`). The first prompt of a conversation also lists the project's file names.
- **Two ways out.** `text` quotes the files in the prompt (up to about 24,000 characters). `upload` puts
  them into one plain text file and attaches it with the page's own "+" button. Google's AI mode cannot
  read inside a ZIP, so no archive is used.
- **One way back.** The model is asked to write each changed file in full under a line `File: <path>`.
  A diff in a reply is read too. Reiner shows the changes and asks before applying.
- **Ask in plain words, with the file attached.** A prompt that reads like a search query gets a list of
  web results instead of a reply; Reiner tells you when that happens.
- **Running your tests.** The project tasks described in the
  [main guide](https://www.npmjs.com/package/@co-reiner/reiner#running-your-tests-and-linter) work here
  too: tasks marked `afterApply` run after you apply a change, and a failing one can be sent back.

## Settings

In `.reiner/config.jsonc`, under `harnesses.google-search`:

| Key                  | Default                                | Meaning                                                                             |
| -------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| `url`                | `https://www.google.com/search?udm=50` | The AI mode address                                                                 |
| `include`, `exclude` | `[]`                                   | Glob patterns that add to or hide from what the search tools and `/share` globs see |

## Limits

- No chat history, models or saved instructions: without an account Google keeps none, so a
  conversation lives as long as the window, and each one starts with a short note on how to reply.
- Long projects do not fit: share the few files a question is about.
- The page changes without notice, and then this harness breaks until its selectors are updated.

## Licence

MIT. See the [repository](https://github.com/co-reiner/reiner).
