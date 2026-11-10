# Reiner Agent

Status: **Placeholder** (2026-11-07). Nothing is implemented. This file only records the intent.

> Read the [Warnings](../README.md#warnings) first. An agent that drives a harness unattended needs them
> most: check that automated use is allowed by the service's terms and by your organisation's policies.

## What it will be

An autonomous harness manager that runs unattended in a Docker container. Where the Reiner CLI is an
interactive tool a person drives from their terminal, Reiner Agent runs browser harnesses on its own:
it takes tasks from a queue or an API, works through them using the harness's model and the Reiner
tool layer, and reports results back.

## Rough shape (not decided)

- Container image with headless Chromium and the Reiner CLI's core and harness modules.
- Reuses the Reiner CLI packages (`core`, `browser`, `harness-*`) rather than duplicating them. A
  harness's slash commands live in its package and talk to their host through core's `CommandHost`, so
  Reiner Agent can run the same commands without the TUI.
- Browser profiles and state on a mounted volume, not baked into the image.
- A control surface (HTTP API or task queue) instead of a TUI.
- Sandboxed tool execution: the container is the boundary for file and shell tools.

## Open questions

- How does sign-in work for an unattended container (one-off headed login, then a copied profile)?
- Where do tasks come from, and where do results go?
- Can it manage several harness sessions or accounts at once?

See [../reiner/docs/](../reiner/docs/) for the shared architecture.
