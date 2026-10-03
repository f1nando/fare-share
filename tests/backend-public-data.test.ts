import assert from 'node:assert/strict';
import test from 'node:test';
import { address } from '@solana/kit';
import { buildPublicOverview, createPublicDataService, validateTraineeAsset } from '../server/publicData.js';
import {
  ensureFleetEarningRetention,
  FLEET_EARNING_RETENTION_SECONDS,
  type FleetMachineDocument,
  type TaxiDatabase,
} from '../server/database.js';

const OWNER = '11111111111111111111111111111111';
const ASSET = 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4';
const SIGNATURE = '5'.repeat(88);

test('public overview aggregates the bounded leaderboard once during synchronization', () => {
  const machines = Array.from({ length: 105 }, (_, index) => machine({
    asset: `asset-${index}`,
    owner: `owner-${String(index).padStart(3, '0')}`,
    weight: index === 104 ? 30 : 1,
    classIndex: index === 104 ? 3 : 0,
  }));
  const overview = buildPublicOverview(snapshot(), machines, 'FARE');
  assert.equal(overview.stats.mintedCars, 105);
  assert.equal(overview.stats.uniqueOwners, 105);
  assert.equal(overview.leaders.length, 100);
  assert.equal(overview.leaders[0].owner, 'owner-104');
  assert.deepEqual(overview.classCounts, [104, 0, 0, 1]);
  assert.deepEqual(overview.mint.mintPricesUsdCents, ['1', '2', '3', '4']);
  assert.equal(overview.mint.fareDecimals, 6);
  assert.equal(overview.mint.fareMint, 'fare-mint');
  assert.equal(overview.mint.fareTicker, 'FARE');
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
      bulkWrite: async () => undefined,
    },
    fleetTrainees: { find: () => cursor([]) },
    fleetEarningSnapshots: { find: () => cursor(historyRows) },
  } as unknown as TaxiDatabase;
  const service = createPublicDataService({
    solanaRpcUrl: 'https://rpc.invalid',
    programId: address('GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4'),
    workerIntervalMs: 60_000,
    fareSymbol: 'FARE',
    assetLoader: async (_rpcUrl, ids) => ids.map(id => ({ id, ownership: { owner: OWNER } })),
  }, database);

  const overviews = await Promise.all(Array.from({ length: 25 }, () => service.overview()));
  assert.ok(overviews.every(value => value === prepared));
  assert.deepEqual(await service.overview(), prepared);
  assert.equal((await service.walletFleet(OWNER)).machines.length, 1);
  assert.equal((await service.earningHistory(OWNER, '24h')).points.length, 1);
  assert.equal(workerReads, 0);
  assert.equal(overviewReads, 3);
});

test('public taxi lookup resolves only already minted NFTs by address or number', async () => {
  let indexRefreshes = 0;
  const minted = machine({ asset: ASSET, name: 'TAXI Toyota Prius #0005', className: 'Comfort', classIndex: 1, weight: 3 });
  const database = {
    fleetMachines: {
      findOne: async (filter: Record<string, unknown>) => {
        if ('asset' in filter) return filter.asset === minted.asset ? minted : null;
        const regex = (filter.name as { $regex?: RegExp } | undefined)?.$regex;
        return regex?.test(minted.name) ? minted : null;
      },
    },
  } as unknown as TaxiDatabase;
  const service = createPublicDataService({
    solanaRpcUrl: 'https://rpc.invalid',
    programId: address(ASSET),
    workerIntervalMs: 60_000,
    fareSymbol: 'FARE',
    taxiIndexRefresher: async () => { indexRefreshes += 1; },
  }, database);

  assert.equal((await service.taxi('5')).asset, ASSET);
  assert.equal((await service.taxi('#0005')).name, minted.name);
  assert.equal((await service.taxi(ASSET)).nftNumber, 5);
  assert.deepEqual(await service.taxi('6'), { minted: false, error: 'This NFT has not been minted yet or is unavailable.' });
  assert.deepEqual(await service.taxi('not-an-address'), { minted: false, error: 'Enter a valid NFT address or minted NFT number.' });
  assert.equal(indexRefreshes, 1);
});

test('wallet fleet removes a taxi whose live NFT owner has changed', async () => {
  const updates: unknown[] = [];
  const staleMachine = machine({ asset: ASSET, owner: OWNER });
  const database = {
    publicSnapshots: { findOne: async () => ({ ...snapshot(), key: 'overview', updatedAt: new Date() }) },
    fleetMachines: {
      find: () => cursor([staleMachine]),
      bulkWrite: async (operations: unknown[]) => { updates.push(...operations); },
    },
    fleetTrainees: { find: () => cursor([]) },
  } as unknown as TaxiDatabase;
  const newOwner = '2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF';
  const service = createPublicDataService({
    solanaRpcUrl: 'https://rpc.invalid',
    programId: address(ASSET),
    workerIntervalMs: 60_000,
    fareSymbol: 'FARE',
    assetLoader: async () => [{ id: ASSET, ownership: { owner: newOwner } }],
  }, database);

  assert.equal((await service.walletFleet(OWNER)).machines.length, 0);
  assert.equal(updates.length, 1);
  assert.equal((updates[0] as { updateOne: { update: { $set: { owner: string } } } }).updateOne.update.$set.owner, newOwner);
});

test('recording a finalized mint immediately indexes its targeted machine', async () => {
  const indexedMachine = machine({ asset: ASSET, owner: OWNER });
  let storedMachine: FleetMachineDocument | null = null;
  let receiptStatus = 'pending';
  const database = {
    fleetMintReceipts: {
      updateOne: async (_filter: unknown, update: { $set?: { status?: string } }) => {
        if (update.$set?.status) receiptStatus = update.$set.status;
      },
    },
    fleetMachines: {
      findOne: async () => storedMachine,
      updateOne: async (_filter: unknown, update: { $set: FleetMachineDocument | Partial<FleetMachineDocument> }) => {
        storedMachine = { ...(storedMachine || indexedMachine), ...update.$set };
      },
    },
  } as unknown as TaxiDatabase;
  const service = createPublicDataService({
    solanaRpcUrl: 'https://rpc.invalid',
    programId: address(ASSET),
    workerIntervalMs: 60_000,
    fareSymbol: 'FARE',
    mintReceiptVerifier: async () => ({ slot: 123, blockTime: new Date('2026-10-03T00:10:26.000Z') }),
    mintMachineLoader: async () => indexedMachine,
  }, database);

  const result = await service.recordMint({ signature: SIGNATURE, asset: ASSET, owner: OWNER });
  const savedMachine = storedMachine as FleetMachineDocument | null;
  assert.equal(result.indexed, true);
  assert.equal(savedMachine?.mintSignature, SIGNATURE);
  assert.equal(receiptStatus, 'indexed');
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

test('trainee indexer requires the on-chain owner and configured Core collection', () => {
  const asset = {
    id: 'trainee-asset',
    ownership: { owner: OWNER },
    grouping: [{ group_key: 'collection', group_value: 'official-collection' }],
  };
  assert.doesNotThrow(() => validateTraineeAsset(asset, OWNER, 'official-collection'));
  assert.throws(() => validateTraineeAsset(asset, 'another-owner', 'official-collection'), /owner/);
  assert.throws(() => validateTraineeAsset(asset, OWNER, 'another-collection'), /collection/);
  assert.throws(() => validateTraineeAsset(undefined, OWNER, 'official-collection'), /owner/);
});

function snapshot() {
  return {
    protocol: { fareMint: 'fare-mint', mintPricesUsdCents: ['1', '2', '3', '4'], mintedByClass: [1, 0, 0, 0], paused: false, saleStarted: true },
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
