/**
 * @file Matching what the user typed against a harness's models and chats (`/model`, `/chat`, `/delete`).
 * @see {@link ../../harness-ms/docs/commands.md#choosing-a-chat | Copilot's slash commands: choosing a chat}
 * @see {@link ../../harness-ms/docs/module.md#models | Copilot module: models}
 */
import type { ModelInfo } from './harness.ts';

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}.]+/u)
    .filter(Boolean);

const norm = (text: string) => words(text).join(' ');

/** Everything a model can be matched on: its group, label and id. */
const haystack = (m: ModelInfo) => norm(`${m.group ?? ''} ${m.label} ${m.id}`);

/**
 * Find the models a user means by `query`.
 *
 * 1. An exact id or label match (ignoring case and punctuation) wins outright,
 *    so "think deeper" picks the top-level "Think deeper", not "GPT-5.6 Sol Think deeper".
 * 2. Otherwise every word of the query must appear in the model's group, label or id,
 *    so "sol quick" finds "GPT · OpenAI › GPT-5.6 Sol Quick response".
 *
 * Returns one model when the choice is clear, several when it is ambiguous, none when nothing fits.
 */
export function matchModels(models: ModelInfo[], query: string): ModelInfo[] {
  const q = norm(query);
  if (!q) return [];
  const exact = models.filter((m) => norm(m.id) === q || norm(m.label) === q);
  if (exact.length > 0) return exact;
  const terms = words(query);
  return models.filter((m) => {
    const hay = ` ${haystack(m)} `;
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * Find the chats a user means by `query`: an exact title (ignoring case) wins, then a chat id, then a
 * 1-based position in `chats` ("3"), then every word appearing in the title.
 */
export function matchChats<T extends { id: string; title: string }>(chats: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact = chats.filter((c) => c.title.toLowerCase() === q);
  if (exact.length > 0) return exact;
  const byId = chats.filter((c) => c.id.toLowerCase() === q);
  if (byId.length > 0) return byId;
  if (/^\d+$/.test(q)) {
    const chat = chats[Number(q) - 1];
    return chat ? [chat] : [];
  }
  const terms = q.split(/\s+/);
  return chats.filter((c) => terms.every((t) => c.title.toLowerCase().includes(t)));
}
