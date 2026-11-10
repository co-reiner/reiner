import { describe, expect, it } from 'vitest';

import { greet, total } from '../src/greet.ts';

describe('greet', () => {
  it('greets a supplied name', () => {
    expect(greet('Alex')).toBe('Hello, Alex!');
  });

  it('preserves surrounding whitespace in the current implementation', () => {
    expect(greet('  Alex  ')).toBe('Hello,   Alex  !');
  });

  it('accepts an empty name in the current implementation', () => {
    expect(greet('')).toBe('Hello, !');
  });
});

describe('total', () => {
  it('adds several values', () => {
    expect(total([1, 2, 3, 4])).toBe(10);
  });

  it('returns zero for an empty array', () => {
    expect(total([])).toBe(0);
  });

  it('supports negative and decimal values', () => {
    expect(total([-2, 0.5, 4])).toBe(2.5);
  });
});
