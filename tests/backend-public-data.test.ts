import assert from 'node:assert/strict';
import test from 'node:test';
import { address } from '@solana/kit';
import { buildPublicOverview, createPublicDataService } from '../server/publicData.js';
import {
  ensureFleetEarningRetention,
  FLEET_EARNING_RETENTION_SECONDS,
  type FleetMachineDocument,
  type TaxiDatabase,
} from '../server/database.js';

const OWNER = '11111111111111111111111111111111';

test('public overview aggregates the bounded leaderboard once during synchronization', () => {
  const machines = Array.from({ length: 105 }, (_, index) => machine({
    asset: `asset-${index}`,
    owner: `owner-${String(index).padStart(3, '0')}`,
    weight: index === 104 ? 30 : 1,
    classIndex: index === 104 ? 3 : 0,
  }));
  const overview = buildPublicOverview(snapshot(), machines);
  assert.equal(overview.stats.mintedCars, 105);
  assert.equal(overview.stats.uniqueOwners, 105);
  assert.equal(overview.leaders.length, 100);
  assert.equal(overview.leaders[0].owner, 'owner-104');
  assert.deepEqual(overview.classCounts, [104, 0, 0, 1]);
  assert.deepEqual(overview.mint.pricesFareRaw, ['1', '2', '3', '4']);
  assert.equal(overview.mint.fareDecimals, 6);
});

test('public read endpoints use MongoDB snapshots without starting an on-chain sync', async () => {
  let workerReads = 0;
  let overviewReads = 0;
  const prepared = buildPublicOverview(snapshot(), [machine()]);
  const fleetRows = [machine()];
  const historyRows = [{
    owner: OWNER,
    bucketAt: new Date('2026-09-30T10:00:00.000Z'),
    observedAt: new Date('2026-09-30T10:00:00.000Z'),
    claimable: ['10', '0', '0', '0', '0'],
    cars: 1,
    activeWeight: 1,
    createdAt: new Date('2026-09-30T10:00:00.000Z'),
    updatedAt: new Date('2026-09-30T10:00:00.000Z'),
  }];
  const database = {
    workerStatus: { findOne: async () => { workerReads += 1; return null; } },
    publicSnapshots: { findOne: async () => { overviewReads += 1; return { ...snapshot(), key: 'overview', overview: prepared, updatedAt: new Date() }; } },
    fleetMachines: {
      find: (filter: Record<string, unknown>) => cursor('owner' in filter ? fleetRows : []),
    },
    fleetEarningSnapshots: { find: () => cursor(historyRows) },
  } as unknown as TaxiDatabase;
  const service = createPublicDataService({
    solanaRpcUrl: 'https://rpc.invalid',
    programId: address('GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4'),
    workerIntervalMs: 60_000,
    fareSymbol: 'FARE',
  }, database);

  const overviews = await Promise.all(Array.from({ length: 25 }, () => service.overview()));
  assert.ok(overviews.every(value => value === prepared));
  assert.deepEqual(await service.overview(), prepared);
  assert.equal((await service.walletFleet(OWNER)).machines.length, 1);
  assert.equal((await service.earningHistory(OWNER, '24h')).points.length, 1);
  assert.equal(workerReads, 0);
  assert.equal(overviewReads, 3);
});

test('earning history expires after a 45-day safety window', async () => {
  const calls: Array<{ keys: unknown; options: unknown }> = [];
  const collection = {
    async createIndex(keys: unknown, options: unknown) {
      calls.push({ keys, options });
      return 'earning_history_ttl';
    },
  } as unknown as Parameters<typeof ensureFleetEarningRetention>[0];
  await ensureFleetEarningRetention(collection);
  assert.equal(FLEET_EARNING_RETENTION_SECONDS, 45 * 24 * 60 * 60);
  assert.deepEqual(calls, [{
    keys: { observedAt: 1 },
    options: { name: 'earning_history_ttl', expireAfterSeconds: 45 * 24 * 60 * 60 },
  }]);
});

function snapshot() {
  return {
    protocol: { mintPrices: ['1', '2', '3', '4'], mintedByClass: [1, 0, 0, 0], paused: false, saleStarted: true },
    distribution: { activeWeight: '1', protocolNow: '100', assets: [{ symbol: 'FARE', decimals: 6 }] },
    vaults: { solLamports: '20', tokens: [{ amount: '10' }] },
    observedAt: new Date('2026-09-30T10:00:00.000Z'),
  };
}

function machine(overrides: Partial<FleetMachineDocument> = {}): FleetMachineDocument {
  const now = new Date('2026-09-30T10:00:00.000Z');
  return {
    asset: 'asset-1', machine: 'machine-1', owner: OWNER, name: 'FARE Economy #0001', image: '', className: 'Economy',
    classIndex: 0, weight: 1, activeUntil: '200', rewardActive: true, closed: false,
    claimable: ['10', '0', '0', '0', '0'], pending: ['0', '0', '0', '0', '0'], fareBase: '0', lastSeenAt: now, updatedAt: now,
    ...overrides,
  };
}

function cursor<T>(rows: T[]) {
  return {
    sort() { return this; },
    async toArray() { return rows; },
  };
}
