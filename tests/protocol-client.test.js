import assert from 'node:assert/strict';
import test from 'node:test';

import { PROGRAM_ID, protocolAddresses, shortAddress } from '../src/protocol/solana.js';
import { chooseEventPage, TAXI_DISCRIMINATORS } from '../src/protocol/anchorClient.js';

test('protocol PDAs are deterministic and distinct', async () => {
  const first = await protocolAddresses();
  const second = await protocolAddresses();

  assert.deepEqual(first, second);
  assert.equal(new Set(Object.values(first)).size, Object.keys(first).length);
  assert.notEqual(String(first.config), String(PROGRAM_ID));
});

test('mint routing chooses a page with room for both machine events', () => {
  const queue = { pages: [{ index: 0, count: 127 }, { index: 1, count: 126 }] };
  assert.equal(chooseEventPage(queue, 2), 1);
  assert.deepEqual([...TAXI_DISCRIMINATORS.mintMachine], [163, 170, 168, 54, 183, 79, 113, 45]);
});

test('wallet addresses are shortened for the primitive UI', () => {
  assert.equal(shortAddress('7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY'), '7SpH…KwnY');
  assert.equal(shortAddress('short'), 'short');
});
