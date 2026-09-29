import assert from 'node:assert/strict';
import test from 'node:test';
import { getAddressEncoder, address } from '@solana/kit';
import { decodeDashboardMachine, decodeDashboardPool } from '../server/protocolDashboard.js';

const asset = address('GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4');

test('admin dashboard projects finalized machine rewards from pool accumulators', () => {
  const poolBytes = new Uint8Array(298);
  const pool = new Writer(poolBytes);
  pool.i64(100n).u64(10n);
  pool.u128(3_000_000_000_000_000_000n);
  for (let index = 1; index < 5; index += 1) pool.u128(0n);
  for (let index = 0; index < 5; index += 1) pool.u64(index === 0 ? 40n : 0n);
  for (let index = 0; index < 5; index += 1) pool.u64(index === 0 ? 25n : 0n);
  pool.skip(8 * 5);
  for (let index = 0; index < 5; index += 1) pool.u64(index === 0 ? 7n : 0n);
  pool.i64(90n).i64(100n).i64(95n).u64(4n).u8(1);

  const machineBytes = new Uint8Array(189);
  const machine = new Writer(machineBytes);
  machine.bytes(Uint8Array.from(getAddressEncoder().encode(asset))).u16(3).i64(1_000n).skip(8).u8(1).u8(0);
  machine.u128(1_000_000_000_000_000_000n);
  for (let index = 1; index < 5; index += 1) machine.u128(0n);
  machine.u64(5n);
  for (let index = 1; index < 5; index += 1) machine.u64(0n);

  const decodedPool = decodeDashboardPool(poolBytes);
  const decodedMachine = decodeDashboardMachine(machineBytes, decodedPool);
  assert.equal(decodedPool.nextPool[0], 25n);
  assert.equal(decodedPool.seriesRemaining[0], 7n);
  assert.equal(decodedMachine.asset, asset);
  assert.equal(decodedMachine.claimable[0], 11n);
});

class Writer {
  private offset = 8;
  private readonly view: DataView;
  constructor(private readonly target: Uint8Array) { this.view = new DataView(target.buffer); }
  skip(length: number) { this.offset += length; return this; }
  bytes(value: Uint8Array) { this.target.set(value, this.offset); this.offset += value.length; return this; }
  u8(value: number) { this.target[this.offset++] = value; return this; }
  u16(value: number) { this.view.setUint16(this.offset, value, true); this.offset += 2; return this; }
  u64(value: bigint) { this.view.setBigUint64(this.offset, value, true); this.offset += 8; return this; }
  i64(value: bigint) { this.view.setBigInt64(this.offset, value, true); this.offset += 8; return this; }
  u128(value: bigint) { this.u64(value & ((1n << 64n) - 1n)); this.u64(value >> 64n); return this; }
}
