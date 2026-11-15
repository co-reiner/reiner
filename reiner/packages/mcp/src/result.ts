/**
 * @file An MCP tool result as Reiner's answer to the model: its text, capped, and its images saved as files
 * that go with the answer message.
 * @see {@link ../../../docs/architecture/tool-protocol.md#external-tools-mcp | Tool protocol: external tools (MCP)}
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ToolAnswer } from '@co-reiner/core';

/** The most text one answer carries; past it the model is told how much was left out. */
export const MAX_OUTPUT = 20_000;

/** One content part of a tool result, read loosely: a server may send parts this version does not know. */
interface Part {
  type?: unknown;
  text?: unknown;
  data?: unknown;
  mimeType?: unknown;
  uri?: unknown;
  name?: unknown;
  resource?: { uri?: unknown; text?: unknown; mimeType?: unknown };
}

export interface RawResult {
  content?: unknown;
  structuredContent?: unknown;
  isError?: unknown;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export interface AnswerContext {
  /** The tool's name as the model sees it (`figma__get_screenshot`). */
  name: string;
  /** Where images are saved to go with the answer. Without it, the model is told an image was left out. */
  imageDir?: string;
}

/** Save one image part, or say why it was left out. */
async function image(part: Part, ctx: AnswerContext, n: number, files: string[]): Promise<string> {
  const ext = typeof part.mimeType === 'string' ? EXTENSIONS[part.mimeType] : undefined;
  if (!ctx.imageDir) return '(an image was returned, but images cannot be sent here)';
  if (!ext || typeof part.data !== 'string') return '(an image was returned in a format that is not sent)';
  await mkdir(ctx.imageDir, { recursive: true });
  const file = path.join(ctx.imageDir, `${ctx.name.replace(/[^\w.-]/g, '_')}-${Date.now()}-${n}.${ext}`);
  await writeFile(file, Buffer.from(part.data, 'base64'));
  files.push(file);
  return `image attached: ${path.basename(file)}`;
}

/** The text of one non-image part: text as it is, a resource by its text or its address. */
function text(part: Part): string | undefined {
  if (part.type === 'text' && typeof part.text === 'string') return part.text;
  if (part.type === 'resource_link' && typeof part.uri === 'string') return `resource: ${part.uri}`;
  if (part.type === 'resource' && part.resource) {
    const r = part.resource;
    if (typeof r.text === 'string') return r.text;
    if (typeof r.uri === 'string') return `resource: ${r.uri}`;
  }
  if (part.type === 'audio') return '(audio was returned, which is not sent)';
  return undefined;
}

/** Cut text to `MAX_OUTPUT` characters, saying how much was left out. */
export function capped(output: string): string {
  if (output.length <= MAX_OUTPUT) return output;
  const left = output.length - MAX_OUTPUT;
  return `${output.slice(0, MAX_OUTPUT)}\n[cut: ${left} more characters. Ask for a smaller part.]`;
}

/** Reiner's answer for one tool result. */
export async function toAnswer(result: RawResult, ctx: AnswerContext): Promise<ToolAnswer> {
  const parts = (Array.isArray(result.content) ? result.content : []) as Part[];
  const lines: string[] = [];
  const files: string[] = [];
  for (const part of parts) {
    const line = part.type === 'image' ? await image(part, ctx, files.length + 1, files) : text(part);
    if (line !== undefined) lines.push(line);
  }
  if (lines.length === 0 && result.structuredContent !== undefined)
    lines.push(JSON.stringify(result.structuredContent));
  if (lines.length === 0) lines.push('(no output)');
  const failed = result.isError === true;
  const output = capped(`${failed ? 'error: ' : ''}${lines.join('\n')}`);
  const images = files.length ? `, ${files.length} image${files.length === 1 ? '' : 's'}` : '';
  return {
    lines: [output],
    summary: `${ctx.name}: ${failed ? 'error' : `${output.length} characters${images}`}.`,
    ...(files.length ? { attachments: files } : {}),
  };
}
