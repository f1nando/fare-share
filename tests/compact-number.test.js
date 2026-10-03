import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCompactNumber } from '../src/compactNumber.js';

test('compact number format truncates token and price values', () => {
  assert.equal(formatCompactNumber(32_720.516172), '32 720');
  assert.equal(formatCompactNumber(20.516172), '20,5');
  assert.equal(formatCompactNumber(0.0516172), '0,0516');
  assert.equal(formatCompactNumber(0.0000516172), '0,0₃516');
  assert.equal(formatCompactNumber(20.59), '20,5');
});

test('compact number format keeps zero and trims insignificant zeroes', () => {
  assert.equal(formatCompactNumber(0), '0');
  assert.equal(formatCompactNumber(20), '20');
  assert.equal(formatCompactNumber(0.05), '0,05');
});
