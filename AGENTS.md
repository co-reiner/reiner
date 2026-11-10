# AGENTS.md

Guidance for AI coding agents working in the Reiner repository.
`CLAUDE.md` imports this file; keep shared guidance here.

## Repository layout

```
reiner/
  reiner/         # Reiner CLI: the active project. Has its own AGENTS.md and docs/.
  reiner-agent/   # Reiner Agent: placeholder only. Do not add code here unless asked.
  test-projects/  # Sample projects to run the CLI in (committed; their .reiner/ is ignored).
```

## Motto: we puppet harnesses

**We do not reverse-engineer harnesses; we puppet them.** Reiner drives an AI harness through its own web
page, the way the user would, in the user's own browser profile. Everything else follows from that:

- Allowed: navigate, read what is rendered (DOM, accessibility tree), click, type, press keys, upload and
  download through the page's own controls, use the page's own buttons and settings screens.
- Never: call the vendor's APIs (for example Microsoft Graph) even with the browser's session, read or
  intercept network traffic, extract or reuse tokens or cookies outside the browser, or hide automation
  from the site (browser flags, stealth scripts).
- The cost is accepted: harness modules break when the page changes. Keep every selector for a harness in
  one `selectors.ts`, so a UI change is a one-file fix.

Each project has its own `AGENTS.md`. When working inside a project, read that file too; it takes
precedence over this one for anything inside that folder.

## Repository-wide conventions

- Australian English in docs, comments and user-facing strings (behaviour, organisation, initialise).
- Dates in docs as `YYYY-MM-DD`.
- Cross-platform always: Windows, macOS and Linux.
- Never commit `.reiner/` folders. They hold browser profiles with live session cookies.
- Code that both projects need (harness modules, tool protocol) belongs in `reiner` packages and is
  reused by `reiner-agent` later, not copied.
