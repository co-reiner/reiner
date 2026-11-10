import { add } from './util/math.ts';

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function total(values: number[]): number {
  return values.reduce((sum, v) => add(sum, v), 0);
}
