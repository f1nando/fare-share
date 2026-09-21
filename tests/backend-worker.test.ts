import assert from 'node:assert/strict';
import test from 'node:test';
import { address, type Address } from '@solana/kit';
import {
  expiryIsPrunable,
  queueHasReadyEvent,
  selectEventBatch,
  type EventPageState,
} from '../server/programState.js';

const targetA = address('11111111111111111111111111111111');
const targetB = address('7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY');

function event(timestamp: bigint, eventNumber: bigint, target: Address = targetA) {
  return { timestamp, eventNumber, target, kind: 1, generation: 1 };
}

test('worker selects exact chronological events across heap pages', () => {
  const queue = {
    nextEventNumber: 4n,
    pages: Array.from({ length: 80 }, () => ({ count: 0, minTimestamp: 0n, minEventNumber: 0n })),
  };
  queue.pages[0] = { count: 2, minTimestamp: 10n, minEventNumber: 2n };
  queue.pages[1] = { count: 2, minTimestamp: 10n, minEventNumber: 1n };
  const pages = new Map<number, EventPageState>([
    [0, { index: 0, events: [event(10n, 2n), event(12n, 3n)] }],
    [1, { index: 1, events: [event(10n, 1n, targetB), event(11n, 4n)] }],
  ]);
  const pool = { totalActiveWeight: 2n, nextPool: [0n], seriesEnd: 20n, seriesEventCutoff: 3n, seriesActive: true };
  const result = selectEventBatch(queue, pool, 99n, pages);
  assert.deepEqual(result.selected.map(item => item.event.eventNumber), [1n, 2n, 3n]);
  assert.deepEqual(result.pageIndexes, [1, 0]);
  assert.equal(result.targets.length, 2);
});

test('worker respects account cap instead of building an oversized transaction', () => {
  const queue = {
    nextEventNumber: 3n,
    pages: Array.from({ length: 80 }, () => ({ count: 0, minTimestamp: 0n, minEventNumber: 0n })),
  };
  const pages = new Map<number, EventPageState>();
  for (let index = 0; index < 3; index += 1) {
    queue.pages[index] = { count: 1, minTimestamp: BigInt(index), minEventNumber: BigInt(index) };
    pages.set(index, { index, events: [event(BigInt(index), BigInt(index), index % 2 ? targetB : targetA)] });
  }
  const pool = { totalActiveWeight: 1n, nextPool: [0n], seriesEnd: 10n, seriesEventCutoff: 2n, seriesActive: true };
  const result = selectEventBatch(queue, pool, 10n, pages, 4);
  assert.equal(result.selected.length, 2);
  assert.equal(result.pageIndexes.length + result.targets.length, 4);
});

test('future events are not processed before protocol time', () => {
  const queue = {
    nextEventNumber: 1n,
    pages: [{ count: 1, minTimestamp: 101n, minEventNumber: 0n }],
  };
  const pool = { totalActiveWeight: 1n, nextPool: [0n], seriesEnd: 0n, seriesEventCutoff: 0n, seriesActive: false };
  assert.equal(queueHasReadyEvent(queue, pool, 100n), false);
  assert.equal(queueHasReadyEvent(queue, pool, 101n), true);
});

test('worker prunes only expiry events made obsolete by a repair', () => {
  const repairTime = 20n;
  const machine = {
    activeUntil: repairTime + 5n * 24n * 60n * 60n,
    scheduledGeneration: 2,
    rewardGeneration: 1,
    rewardActive: true,
    closed: false,
  };
  assert.equal(expiryIsPrunable(event(repairTime + 1n, 1n), machine), true);
  assert.equal(expiryIsPrunable(event(repairTime - 1n, 2n), machine), false);
  assert.equal(expiryIsPrunable({ ...event(repairTime + 1n, 3n), kind: 0 }, machine), false);
  assert.equal(expiryIsPrunable(event(repairTime - 1n, 4n), { ...machine, rewardGeneration: 2 }), true);
});
