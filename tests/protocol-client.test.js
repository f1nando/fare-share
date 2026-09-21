import assert from 'node:assert/strict';
import test from 'node:test';

import { PROGRAM_ID, protocolAddresses, shortAddress } from '../src/protocol/solana.js';

test('protocol PDAs are deterministic and distinct', async () => {
  const first = await protocolAddresses();
  const second = await protocolAddresses();

  assert.deepEqual(first, second);
  assert.equal(new Set(Object.values(first)).size, 3);
  assert.notEqual(String(first.config), String(PROGRAM_ID));
});

test('wallet addresses are shortened for the primitive UI', () => {
  assert.equal(shortAddress('7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY'), '7SpH…KwnY');
  assert.equal(shortAddress('short'), 'short');
});

