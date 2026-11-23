/**
 * @file What became of a reply's changes, told back to the model: applied, declined (with the user's reason)
 * or failed. A model that sends one file's diff at a time waits for this before it sends the next.
 * @see {@link ../../../../../docs/architecture/file-exchange.md#telling-the-model-what-was-applied | File exchange: telling the model what was applied}
 */

/** One change set's fate, as the y/N and the apply left it. */
export type Outcome =
  | { kind: 'applied'; files: string[] }
  | { kind: 'declined'; files: string[]; reason: string }
  | { kind: 'failed'; files: string[]; error: string };

const list = (files: string[]) => files.join(', ');

function line(o: Outcome): string {
  if (o.kind === 'applied') return `I applied your changes to ${list(o.files)}.`;
  if (o.kind === 'failed') return `Your changes to ${list(o.files)} did not apply: ${o.error}`;
  const why = o.reason.trim();
  return `I did not apply your changes to ${list(o.files)}.${why ? ` My reason: ${why}` : ''}`;
}

/**
 * The message that tells the model how its changes went, or undefined when none was offered. It ends by
 * asking for the rest, so a model that changes one file per reply goes on, and one that is done says so.
 */
export function outcomeMessage(outcomes: Outcome[]): string | undefined {
  if (outcomes.length === 0) return undefined;
  return [
    ...outcomes.map(line),
    'Continue with any remaining changes; if there are none, say that you are done.',
  ].join('\n');
}
