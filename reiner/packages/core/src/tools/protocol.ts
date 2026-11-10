/**
 * @file Tool calls from the model: their zod schemas, parsing them out of a reply, and the result header.
 * @see {@link ../../../../docs/architecture/tool-protocol.md | Tool protocol}
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 * @see {@link ../../../harness-ms/docs/module.md#page-lessons | Copilot module: page lessons}
 */
import { z } from 'zod';
import { GLOB_MAX_SPANS, GLOB_MAX_STARS, globSpans, globStars } from './glob.ts';

/**
 * Tool calls from the model. The model asks Reiner for something by replying with only a fenced code
 * block tagged `reiner-tool` that holds one JSON object, in the shape the GPT model family is trained to
 * write and read for function calls (OpenAI's `function_call` item):
 * `{"type":"function_call","call_id":"call_1","name":"grep","arguments":{"pattern":"x"}}`. Only `name`
 * and `arguments` are needed; `type` and `call_id` may be left out. Reiner answers
 * each call with a `function_call_output` item that carries the same `call_id`. That is the only shape
 * read. Every call is untrusted
 * input: it is parsed with zod, and the tool itself applies the share rules (share.ts) before anything
 * leaves the machine.
 */
const TOOL_FENCE = 'reiner-tool';

export const ShareFilesCall = z
  .object({
    tool: z.literal('share_files'),
    /** Project-relative paths, each shared earlier in this chat. */
    paths: z.array(z.string().min(1).max(500)).max(200).optional(),
    /** Send every file shared earlier in this chat again. */
    all: z.boolean().optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((c) => c.all === true || (c.paths?.length ?? 0) > 0, { message: 'give "paths" or "all": true' });

/**
 * The whole project in one new pack, the way /pack makes it: the files git lists, through the share
 * rules, with the search index when it is on; nothing is packed outside a git repository. It widens what
 * the chat has seen, so the user is asked first.
 */
export const ShareProjectCall = z.object({
  tool: z.literal('share_project'),
  reason: z.string().max(500).optional(),
});

/** A glob from the model: bounded, so a pattern cannot make one path test run away. */
const GlobPattern = z
  .string()
  .min(1)
  .max(300)
  .refine((p) => globSpans(p) <= GLOB_MAX_SPANS, { message: `at most ${GLOB_MAX_SPANS} "**" in a glob` })
  .refine((p) => globStars(p) <= GLOB_MAX_STARS, {
    message: `at most ${GLOB_MAX_STARS} "*" in one name of a glob`,
  });

/** Project files whose path matches a glob (search.ts). Only files the share rules allow are ever listed. */
export const GlobCall = z.object({
  tool: z.literal('glob'),
  pattern: GlobPattern,
  reason: z.string().max(500).optional(),
});

/** Lines matching a regular expression, in the files `glob` would list. */
export const GrepCall = z.object({
  tool: z.literal('grep'),
  pattern: z.string().min(1).max(300),
  glob: GlobPattern.optional(),
  ignoreCase: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

/**
 * Run one of the project's named tasks. The model gives a name, never a command: the command is the one
 * the user wrote for that name in the project's config, and the user is asked before it first runs.
 */
export const RunTaskCall = z.object({
  tool: z.literal('run_task'),
  name: z.string().min(1).max(60),
  reason: z.string().max(500).optional(),
});

export type ShareFilesCall = z.infer<typeof ShareFilesCall>;
export type ShareProjectCall = z.infer<typeof ShareProjectCall>;
export type GlobCall = z.infer<typeof GlobCall>;
export type GrepCall = z.infer<typeof GrepCall>;
export type RunTaskCall = z.infer<typeof RunTaskCall>;
/** A parsed call with the id its answer carries: the model's `call_id`, or `call_<n>` by position. */
type WithId<T> = T & { callId: string };
export type ToolCall =
  | WithId<ShareFilesCall>
  | WithId<ShareProjectCall>
  | WithId<GlobCall>
  | WithId<GrepCall>
  | WithId<RunTaskCall>;

const TOOLS = {
  share_files: ShareFilesCall,
  share_project: ShareProjectCall,
  glob: GlobCall,
  grep: GrepCall,
  run_task: RunTaskCall,
} as const;
const TOOL_NAMES = Object.keys(TOOLS) as (keyof typeof TOOLS)[];

export interface ParsedTools {
  calls: ToolCall[];
  /** Blocks that were tagged as tool calls but did not parse, with the reason, to report back. */
  errors: string[];
}

const BLOCK = new RegExp(`^(\`{3,}|~{3,})[ \\t]*${TOOL_FENCE}[^\\n]*\\n([\\s\\S]*?)^\\1[ \\t]*$`, 'gm');

/** Any fenced block, whatever its language label. */
const ANY_BLOCK = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;

/**
 * The tool-call blocks in a reply. A block tagged `reiner-tool` counts anywhere. Copilot's page shows
 * code blocks with its own guessed language ("react", "json"…), so the tag can be lost on the way back:
 * then a reply that is nothing but one block holding a JSON object with a `name` and `arguments` counts
 * too. A JSON example inside a normal answer never does.
 */
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

function toolBlocks(markdown: string): string[] {
  const tagged = [...markdown.matchAll(BLOCK)].map((m) => m[2] ?? '');
  if (tagged.length) return tagged;
  const all = [...markdown.matchAll(ANY_BLOCK)];
  const only = all[0];
  if (all.length !== 1 || !only) return [];
  const outside = markdown.replace(only[0], '').trim();
  const body = (only[2] ?? '').trim();
  return outside === '' && looksLikeCall(body) ? [body] : [];
}

/** One block's JSON as a tool name, the id to answer with, and the arguments the tool's schema checks. */
interface RawCall {
  tool: unknown;
  callId?: string;
  body: Record<string, unknown>;
}

/**
 * Read a block as a call. The arguments are under `arguments`, as an object or, as the API itself sends
 * them, a JSON string. Returns the reason when the block is not a function call.
 */
function readCall(json: unknown): RawCall | string {
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return 'a tool call is one JSON object';
  const o = json as Record<string, unknown>;
  const id = typeof o.call_id === 'string' && o.call_id.length <= 100 ? { callId: o.call_id } : {};
  if (o.type !== 'function_call' && !('name' in o && 'arguments' in o))
    return 'a tool call is a function call: {"type":"function_call","name":"<tool>","arguments":{...}}';
  let args: unknown = o.arguments ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return `${String(o.name)}: "arguments" is not valid JSON`;
    }
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args))
    return `${String(o.name)}: "arguments" must be a JSON object`;
  return { tool: o.name, ...id, body: { ...(args as Record<string, unknown>), tool: o.name } };
}

export function extractToolCalls(markdown: string): ParsedTools {
  const calls: ToolCall[] = [];
  const errors: string[] = [];
  let position = 0;
  for (const block of toolBlocks(markdown)) {
    position++;
    const body = block.trim();
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      errors.push(`not valid JSON: ${body.slice(0, 80)}`);
      continue;
    }
    const raw = readCall(json);
    if (typeof raw === 'string') {
      errors.push(raw);
      continue;
    }
    const { tool } = raw;
    const schema =
      typeof tool === 'string' && Object.hasOwn(TOOLS, tool) ? TOOLS[tool as keyof typeof TOOLS] : undefined;
    if (!schema) {
      errors.push(`unknown tool ${JSON.stringify(tool)}; available: ${TOOL_NAMES.join(', ')}`);
      continue;
    }
    const parsed = schema.safeParse(raw.body);
    if (parsed.success) calls.push({ ...parsed.data, callId: raw.callId ?? `call_${position}` });
    else errors.push(`${tool}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return { calls, errors };
}

/** What a tool call comes to: the lines of its `output`, and one line for the user about what was done. */
export interface ToolAnswer {
  lines: string[];
  summary: string;
}

/** The `call_id` Reiner answers with when a block could not be read as a call at all. */
export const INVALID_CALL_ID = 'invalid_call';

/**
 * The answer to one call, as the `function_call_output` item the model is trained to read: one line of
 * JSON with the call's `call_id` and the result text as `output`. It goes back in a plain message, not in a
 * code block.
 */
export const toolResult = (callId: string, output: string): string =>
  JSON.stringify({ type: 'function_call_output', call_id: callId, output });

/**
 * The paragraph that teaches a model the call format, for a harness's instructions. Its wording is the one
 * Copilot accepted: it describes when a call helps and what one looks like, in the user's voice, with the
 * short form of a call (`name` and `arguments`).
 */
export const TOOL_FORMAT_TEXT =
  'When a project file or archive is missing, or a search of my project would help, request it with a tool call. A tool call is a reply that contains only one code block labelled `reiner-tool`, holding one JSON object with a name and its arguments, for example `{"name":"grep","arguments":{"pattern":"TODO","glob":"*.ts"}}`. The result comes back in my next message as one line of JSON with an `output` field.';

/** What a model is told about the search tools, which any harness can offer (run.ts answers them). */
export const SEARCH_TOOLS_TEXT = [
  '- `glob` with `pattern`: lists project files.',
  '- `grep` with `pattern`, and optionally `glob` and `ignoreCase`: returns matching lines as `path:line: text`.',
  '- Files outside the project, and files git ignores, are not listed or sent.',
];
