import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userInitials } from './userInitials.ts';

test('initials take the first letter of the first two words, or two letters of a single word', () => {
  assert.equal(userInitials('Jane Doe'), 'JD');
  assert.equal(userInitials('  production   key  extra '), 'PK');
  assert.equal(userInitials('ops'), 'OP');
  assert.equal(userInitials('ci_bot'), 'CB');
  assert.equal(userInitials(''), '');
});

test('initials never split a character made of two code units', () => {
  assert.equal(userInitials('😀 team'), '😀T');
});
