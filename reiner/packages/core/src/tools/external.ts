/**
 * @file Calls to tools that are not Reiner's own (an MCP server's), under the names the host offers: reading
 * them out of a reply and answering them through the host.
 * @see {@link ../../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
import type { ToolRunOptions } from '../exchange.ts';
import { type ToolAnswer, toolResult } from './protocol.ts';

/**
 * An external tool's name as the model sees it: `<server>__<tool>`. The `__` keeps it apart from every
 * one of Reiner's own tools, and uses only the characters a function name may have in the API the
 * model was trained on.
 */
export const EXTERNAL_TOOL_NAME = /^[a-z0-9][a-z0-9-]*__[a-z0-9_.-]+$/i;

/** The longest arguments object, as JSON, that is passed on. */
const MAX_ARGUMENTS = 20_000;

/** A call to an external tool. Its arguments are checked by the tool's own server, not here. */
export interface ExternalToolCall {
  tool: string;
  arguments: Record<string, unknown>;
  callId: string;
}

/** A call's arguments as given, or why they cannot be passed on. */
export function externalCall(
  tool: string,
  args: Record<string, unknown>,
  callId: string,
): ExternalToolCall | string {
  const size = JSON.stringify(args).length;
  if (size > MAX_ARGUMENTS) return `${tool}: the arguments are too long (${size} characters)`;
  return { tool, arguments: args, callId };
}

/** The answers to a reply's external calls, the lines for the user, and any files that go with them. */
export interface ExternalAnswers {
  lines: string[];
  summary: string[];
  attachments: string[];
}

/**
 * Answer each external call through the host (`ToolRunOptions.callExternal`), which owns the servers and
 * the y/N. Without that hook the model is told the tool is not available here.
 */
export async function answerExternalCalls(
  calls: readonly ExternalToolCall[],
  opts: ToolRunOptions,
  who: string,
): Promise<ExternalAnswers> {
  const out: ExternalAnswers = { lines: [], summary: [], attachments: [] };
  for (const call of calls) {
    let answer: ToolAnswer;
    if (!opts.callExternal) {
      answer = {
        lines: [`${call.tool} is not available here.`],
        summary: `${who} asked for ${call.tool}, which is not available here.`,
      };
    } else {
      answer = await opts.callExternal(call.tool, call.arguments);
    }
    out.lines.push(toolResult(call.callId, answer.lines.join('\n')));
    out.summary.push(answer.summary);
    out.attachments.push(...(answer.attachments ?? []));
  }
  return out;
}
