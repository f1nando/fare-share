import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { address, getBase58Decoder } from '@solana/kit';
import { createPublicDataService, verifyMarketSignature } from '../server/publicData.js';
import type { MarketListingDocument, MarketNonceDocument, TaxiDatabase } from '../server/database.js';

const ASSET = 'So11111111111111111111111111111111111111112';

test('market listing requires a valid owner signature and current DAS ownership', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const owner = getBase58Decoder().decode(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const listings = new Map<string, MarketListingDocument>();
  const nonces = new Map<string, MarketNonceDocument>();
  const machine = {
    asset: ASSET, machine: 'machine', owner, name: 'TAXI Toyota Camry #0042', image: '/taxi.webp', className: 'Comfort',
    classIndex: 1, weight: 3, activeUntil: '200', rewardActive: true, closed: false,
    claimable: ['0', '0', '0', '0', '0'], pending: ['0', '0', '0', '0', '0'], fareBase: '0', lastSeenAt: new Date(), updatedAt: new Date(),
  };
  const database = {
    fleetMachines: {
      findOne: async (filter: { asset: string }) => filter.asset === ASSET ? machine : null,
      find: () => cursor([machine]),
    },
    marketListings: {
      find: () => cursor([...listings.values()].filter(row => row.status === 'active')),
      findOne: async (filter: { asset: string; seller?: string; status?: string }) => {
        const row = listings.get(filter.asset);
        return row && (!filter.seller || row.seller === filter.seller) && (!filter.status || row.status === filter.status) ? row : null;
      },
      updateOne: async (filter: { asset: string }, update: { $set: MarketListingDocument }) => {
        const previous = listings.get(filter.asset);
        listings.set(filter.asset, { ...previous, ...update.$set } as MarketListingDocument);
        return { matchedCount: previous ? 1 : 0 };
      },
    },
    marketNonces: {
      insertOne: async (row: MarketNonceDocument) => { nonces.set(row.nonce, row); },
      findOne: async (filter: { nonce: string; owner: string }) => {
        const row = nonces.get(filter.nonce);
        return row?.owner === filter.owner ? row : null;
      },
      findOneAndDelete: async (filter: { nonce: string; owner: string }) => {
        const row = nonces.get(filter.nonce);
        if (!row || row.owner !== filter.owner) return null;
        nonces.delete(filter.nonce);
        return row;
      },
    },
  } as unknown as TaxiDatabase;
  const service = createPublicDataService({
    solanaRpcUrl: 'https://rpc.invalid',
    programId: address('GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4'),
    workerIntervalMs: 60_000,
    fareSymbol: 'FARE',
    loadMarketAsset: async asset => ({ id: asset, ownership: { owner } }),
  }, database);

  const challenge = await service.marketChallenge({ action: 'list', owner, asset: ASSET, priceLamports: '1250000000' });
  const signature = sign(null, Buffer.from(challenge.message), privateKey).toString('base64');
  assert.equal(verifyMarketSignature(owner, challenge.message, signature), true);
  assert.equal(verifyMarketSignature(owner, `${challenge.message}!`, signature), false);

  assert.deepEqual(await service.submitMarketAction({ owner, nonce: challenge.nonce, signature }), {
    listed: true,
    asset: ASSET,
    priceLamports: '1250000000',
  });
  const market = await service.market();
  assert.equal(market.listings.length, 1);
  assert.equal(market.listings[0].nftNumber, 42);
  assert.equal(market.floorLamports, '1250000000');
});

function cursor<T>(rows: T[]) {
  return {
    sort() { return this; },
    limit() { return this; },
    async toArray() { return rows; },
  };
}
