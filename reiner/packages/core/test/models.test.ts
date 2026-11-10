/**
 * @file Tests for matching typed model names and chat names, titles and numbers.
 * @see {@link ../../harness-ms/docs/commands.md#choosing-a-chat | Copilot's slash commands: choosing a chat}
 * @see {@link ../../harness-ms/docs/module.md#models | Copilot module: models}
 */
import { describe, expect, it } from 'vitest';
import { type ModelInfo, matchChats, matchModels } from '../src/index.ts';

const group = 'GPT · OpenAI';
const MODELS: ModelInfo[] = [
  { id: 'Auto', label: 'Auto', path: ['Auto'], selected: true },
  { id: 'Quick response', label: 'Quick response', path: ['Quick response'] },
  { id: 'Think deeper', label: 'Think deeper', path: ['Think deeper'] },
  {
    id: 'GPT/GPT-5.6 Sol Quick response',
    label: 'GPT-5.6 Sol Quick response',
    group,
    path: ['GPT', 'GPT-5.6 Sol Quick response'],
  },
  {
    id: 'GPT/GPT-5.6 Sol Think deeper',
    label: 'GPT-5.6 Sol Think deeper',
    group,
    path: ['GPT', 'GPT-5.6 Sol Think deeper'],
  },
];

const ids = (query: string) => matchModels(MODELS, query).map((m) => m.id);

describe('matchModels', () => {
  it('prefers an exact label over partial matches', () => {
    expect(ids('think deeper')).toEqual(['Think deeper']);
    expect(ids('Quick Response')).toEqual(['Quick response']);
  });

  it('matches every word against group, label and id', () => {
    expect(ids('sol quick')).toEqual(['GPT/GPT-5.6 Sol Quick response']);
    expect(ids('openai think')).toEqual(['GPT/GPT-5.6 Sol Think deeper']);
    expect(ids('5.6 think')).toEqual(['GPT/GPT-5.6 Sol Think deeper']);
  });

  it('returns several models when the query is ambiguous', () => {
    expect(ids('gpt')).toHaveLength(2);
  });

  it('returns nothing for no match or an empty query', () => {
    expect(ids('claude')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });
});

describe('matchChats', () => {
  const chats = [
    { id: 'a1', title: 'Large Chat Test (Keep)' },
    { id: 'b2', title: 'Name three primary colours' },
    { id: 'c3', title: 'Name three secondary colours' },
  ];
  const ids = (q: string) => matchChats(chats, q).map((c) => c.id);

  it('matches exact titles, ids and list positions', () => {
    expect(ids('large chat test (keep)')).toEqual(['a1']);
    expect(ids('c3')).toEqual(['c3']);
    expect(ids('2')).toEqual(['b2']);
    expect(ids('9')).toEqual([]);
  });

  it('matches every word, and reports ambiguity', () => {
    expect(ids('large keep')).toEqual(['a1']);
    expect(ids('colours')).toEqual(['b2', 'c3']);
  });
});
