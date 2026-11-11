import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slug } from '../src/slug.js';
import { wordCount } from '../src/words.js';

test('slug joins lower-case words with hyphens', () => {
  assert.equal(slug('Hello, World!'), 'hello-world');
});

test('slug of an empty title is empty', () => {
  assert.equal(slug(''), '');
});

test('wordCount counts runs of letters and digits', () => {
  assert.equal(wordCount('one two, three 4'), 4);
});
