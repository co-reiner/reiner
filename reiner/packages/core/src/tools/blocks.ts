/**
 * @file Finding the tool-call blocks in a reply: fenced blocks tagged `reiner-tool`, or a lone block whose
 * tag the harness's page lost.
 * @see {@link ../../../../docs/architecture/tool-protocol.md#call-format-built | Tool protocol: call format}
 * @see {@link ../../../harness-ms/docs/module.md#page-lessons | Copilot module: page lessons}
 */

/** The fence tag of a tool call. */
const TOOL_FENCE = 'reiner-tool';

const BLOCK = new RegExp(`^(\`{3,}|~{3,})[ \\t]*${TOOL_FENCE}[^\\n]*\\n([\\s\\S]*?)^\\1[ \\t]*$`, 'gm');

/** Any fenced block, whatever its language label. */
const ANY_BLOCK = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;

/** True for a JSON object that names a tool and gives its arguments: a call whose fence label was lost. */
function looksLikeCall(body: string): boolean {
  if (!body.startsWith('{')) return false;
  try {
    const o = JSON.parse(body) as Record<string, unknown> | null;
    return typeof o === 'object' && o !== null && typeof o.name === 'string' && 'arguments' in o;
  } catch {
    return false;
  }
}

/**
 * The tool-call blocks in a reply. A block tagged `reiner-tool` counts anywhere. Copilot's page shows
 * code blocks with its own guessed language ("react", "json"…), so the tag can be lost on the way back:
 * then a reply that is nothing but one block holding a JSON object with a `name` and `arguments` counts
 * too. A JSON example inside a normal answer never does.
 */
export function toolBlocks(markdown: string): string[] {
  const tagged = [...markdown.matchAll(BLOCK)].map((m) => m[2] ?? '');
  if (tagged.length) return tagged;
  const all = [...markdown.matchAll(ANY_BLOCK)];
  const only = all[0];
  if (all.length !== 1 || !only) return [];
  const outside = markdown.replace(only[0], '').trim();
  const body = (only[2] ?? '').trim();
  return outside === '' && looksLikeCall(body) ? [body] : [];
}
