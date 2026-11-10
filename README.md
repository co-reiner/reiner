# Reiner

Take the reins of your AI harness: local tools, files and agents on top of whatever it already gives
you, starting with Microsoft 365 Copilot.

| Project | What it is | Status |
| --- | --- | --- |
| [reiner/](reiner/) | **Reiner**: an interactive, cross-platform CLI agent that drives a browser harness in a background Chromium browser and adds its own local tool layer | Early draft, runs from source |
| [reiner-agent/](reiner-agent/) | **Reiner Agent**: an autonomous harness manager that runs as a Docker container | Placeholder, not started |

Not affiliated with or endorsed by any of the companies or products named here. Product names are
trademarks of their owners, used only to describe compatibility or for context.

Start with [reiner/README.md](reiner/README.md) and [reiner/docs/](reiner/docs/).

## Why

It is a very interesting world we have stepped into, with all the agentic advantage and AI development
tools available to people, but not for everyone, or not all the time. I know many people who live a double
life: at home they are the best AI riders with Claude, Codex, Grok..., but at work they are part of a big
enterprise where any AI is locked to one approved tool. In a world where all the reports show that
employees step into the grey or dark side and use AI tools they pay for themselves just to stay
competitive, I thought we could have a better solution.

Quickly I realised I'm not alone, and many other people extract the best from existing tools by
decompiling or reverse engineering their harness to call models directly from VS Code, for example. But
this just adds more stress, as the normal T&Cs of the tools forbid such usage, and people just carry even
more risk. I was thinking about what else could be done, how to help people get the most out of the
limited tools they have, and came up with something which probably already exists, but I could just never
find it... So if espresso machines can run Doom nowadays, can Google Search or MS Copilot just code on the
licence they already have like a normal local harness, without hacking it away?

## The Concept

And this is how the concept was born: something which attaches to a limited LLM harness to operate it,
using the harness through its own page, the way a person would: no reverse engineering, no hidden APIs. Just faster: like instead of two hands you would have eight tentacles, with an extended brain
which follows your intent but allows you to control more, and puppet another harness. Not sure if I found
a good name for it, but controlling a harness through a rein seemed to be what I want: just navigating the
tool I already have... So welcome Reiner, a tool which navigates your AI harness at the speed your
"default" body parts can't!

It can scale in multiple directions, but this project started from a CLI tool, a tool familiar to any
developer/engineer and to their enterprise friend: MS Copilot.

Reiner does not make any use compliant: whether you may automate a service, and what you may share with
it, is still for that service's terms and your organisation to decide.

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
  the [LICENSE](LICENSE)).
- **Build your own through your organisation's processes.** If you want similar functionality within an
  organisation, use this project as a reference for an implementation developed and reviewed through your
  organisation's approved engineering, security, privacy and legal processes. Rebuilding the software does
  not by itself make it safe, or establish permission to automate a service.
- **Clone and change it freely.** You are welcome to clone it and modify it as you wish.
- **Prefer issues to pull requests.** You can open a pull request, but the chances it will be reviewed or
  accepted are pretty low: most likely I will implement the fix it describes with my own agents. So please
  open an issue instead, describing the problem or the fix.

## Licence

MIT, copyright 2026 Alexandr Yeskov. See [LICENSE](LICENSE).
