import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AccountRole, address, createKeyPairSignerFromBytes, getAddressEncoder, type Address } from '@solana/kit';
import {
  decodeEventQueueState,
  decodeMachineCleanupState,
  expiryIsPrunable,
  queueHasReadyEvent,
  selectEventBatch,
  selectWritableQueuePage,
  type EventPageState,
} from '../server/programState.js';
import {
  buildCleanupBurnedMachineInstruction,
  hasAssignableRewards,
  isBurnedCoreAssetAccount,
} from '../server/worker.js';
import {
  assertWireTransactionSize,
  sendInstructions,
  SolanaTransactionSimulationError,
  SolanaTransactionTooLargeError,
} from '../server/transaction.js';

const targetA = address('11111111111111111111111111111111');
const targetB = address('9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv');

function event(timestamp: bigint, eventNumber: bigint, target: Address = targetA) {
  return { timestamp, eventNumber, target, kind: 1, generation: 1 };
}

test('worker decodes the bounded queue vector layout', () => {
  const bytes = new Uint8Array(1_461);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 80, true);
  view.setUint16(12, 3, true);
  view.setBigInt64(14, 50n, true);
  view.setBigUint64(22, 4n, true);
  view.setBigUint64(12 + 80 * 18, 99n, true);
  const queue = decodeEventQueueState(bytes);
  assert.deepEqual(queue.pages[0], { count: 3, minTimestamp: 50n, minEventNumber: 4n });
  assert.equal(queue.nextEventNumber, 99n);
});

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

test('worker decodes open and closed machines for burn scans', () => {
  const bytes = new Uint8Array(189);
  bytes.set(createHash('sha256').update('account:Machine').digest().subarray(0, 8));
  bytes.set(getAddressEncoder().encode(targetB), 8);
  assert.equal(decodeMachineCleanupState(bytes).asset, targetB);
  assert.equal(decodeMachineCleanupState(bytes).closed, false);
  bytes[59] = 1;
  assert.equal(decodeMachineCleanupState(bytes).closed, true);
});

test('worker recognizes the uninitialized account left by a Metaplex Core burn', () => {
  const coreProgram = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
  assert.equal(isBurnedCoreAssetAccount(null), true);
  assert.equal(isBurnedCoreAssetAccount({ owner: coreProgram, data: Uint8Array.of(0) }), true);
  assert.equal(isBurnedCoreAssetAccount({ owner: coreProgram, data: Uint8Array.of(1) }), false);
  assert.equal(isBurnedCoreAssetAccount({ owner: targetA, data: Uint8Array.of(0) }), false);
});

test('worker does not loop on reward dust that cannot be assigned', () => {
  assert.equal(hasAssignableRewards([0n, 1n], 44n), false);
  assert.equal(hasAssignableRewards([0n, 2n], 44n), true);
  assert.equal(hasAssignableRewards([1n], 1n), true);
  assert.equal(hasAssignableRewards([100n], 0n), false);
});

test('worker chooses a queue page with room for a burn event', () => {
  const queue = {
    nextEventNumber: 1n,
    pages: Array.from({ length: 80 }, () => ({ count: 128, minTimestamp: 0n, minEventNumber: 0n })),
  };
  queue.pages[17].count = 127;
  assert.equal(selectWritableQueuePage(queue), 17);
  queue.pages[17].count = 128;
  assert.throws(() => selectWritableQueuePage(queue), /no free page/);
});

test('burn cleanup instruction has the exact Anchor account order', () => {
  const instruction = buildCleanupBurnedMachineInstruction({
    programId: targetB,
    caller: targetA,
    config: targetB,
    queue: targetA,
    eventPage: targetB,
    machine: targetA,
    asset: targetB,
    pageIndex: 7,
  });
  assert.deepEqual(instruction.accounts?.map(account => account.role), [
    AccountRole.WRITABLE_SIGNER,
    AccountRole.READONLY,
    AccountRole.WRITABLE,
    AccountRole.WRITABLE,
    AccountRole.WRITABLE,
    AccountRole.READONLY,
    AccountRole.READONLY,
  ]);
  assert.equal(instruction.data?.length, 9);
  assert.equal(instruction.data?.[8], 7);
});

test('wire transaction size is rejected before RPC submission', () => {
  assert.doesNotThrow(() => assertWireTransactionSize(Buffer.alloc(1232).toString('base64')));
  assert.throws(
    () => assertWireTransactionSize(Buffer.alloc(1233).toString('base64')),
    SolanaTransactionTooLargeError,
  );
});

test('transactions are explicitly simulated before submission', async () => {
  const secret = Uint8Array.from([
    ...Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'),
    ...Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'),
  ]);
  const signer = await createKeyPairSignerFromBytes(secret);
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let recordedAsSubmitted = false;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string };
    methods.push(request.method);
    const result = request.method === 'getLatestBlockhash'
      ? { value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 } }
      : { value: { err: { InstructionError: [0, 'Custom'] }, logs: ['route failed'] } };
    return new Response(JSON.stringify({ jsonrpc: '2.0', result }));
  };
  try {
    await assert.rejects(
      sendInstructions('https://rpc.invalid', signer, [], [], {}, {
        onSigned: async () => { recordedAsSubmitted = true; },
      }),
      SolanaTransactionSimulationError,
    );
    assert.deepEqual(methods, ['getLatestBlockhash', 'simulateTransaction']);
    assert.equal(recordedAsSubmitted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
