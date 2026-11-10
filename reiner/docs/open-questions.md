# Open questions

Last updated 2026-11-09. Move answers into the relevant doc and delete the question.

## Product

1. What is the main use case to optimise for first: coding in a repo, document work, or both?
2. Who are the users: just us internally, or a public open-source release? This affects the policy and
   security wording and how much setup polish we need. (The licence is settled: MIT.)

## Harness (to measure, see plan.md)

3. Which Copilot URL and edition: Microsoft 365 Copilot (licensed) or Copilot Chat (free with Entra ID)?
4. Does the tenant allow headless sign-in, and does Edge device SSO carry over to a Playwright-launched Edge?
5. Prompt length and messages-per-chat limits.

The custom instructions question is answered in [file-exchange.md](architecture/file-exchange.md): the
setting exists in the tested tenant and took 20,000 characters without complaint.

## Technical

6. One browser profile per project (as asked) versus an optional shared global profile?
7. Do other tenants or licence types show a different model picker (more vendors, different labels)?
