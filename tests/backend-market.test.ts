import assert from 'node:assert/strict';
import test from 'node:test';
import { address } from '@solana/kit';
import { createPublicDataService } from '../server/publicData.js';
import type { TaxiDatabase } from '../server/database.js';

test('market exposes only active listings whose seller still owns the taxi', async () => {
  const listedAt = new Date('2026-10-01T12:00:00.000Z');
  const listings = [
    { asset: 'asset-1', seller: 'seller-1', priceLamports: '1250000000', status: 'active', listedAt, updatedAt: listedAt },
    { asset: 'asset-2', seller: 'old-owner', priceLamports: '500000000', status: 'active', listedAt, updatedAt: listedAt },
  ];
  const machines = [
    { asset: 'asset-1', owner: 'seller-1', name: 'TAXI Toyota Camry #0042', image: '/taxi.webp', className: 'Comfort', weight: 3, closed: false },
    { asset: 'asset-2', owner: 'new-owner', name: 'TAXI Porsche 911 #0043', image: '/taxi-2.webp', className: 'Legend', weight: 30, closed: false },
  ];
  const offers = [
    { offer: 'offer-1', buyer: 'buyer-1', kind: 'asset', asset: 'asset-1', priceLamports: '1000000000', status: 'active', createdAt: listedAt, updatedAt: listedAt },
    { offer: 'offer-2', buyer: 'buyer-2', kind: 'class', weight: 30, priceLamports: '2000000000', status: 'active', createdAt: listedAt, updatedAt: listedAt },
  ];
  const database = {
    marketListings: { find: () => cursor(listings) },
    marketOffers: { find: () => cursor(offers) },
    fleetMachines: { find: () => cursor(machines) },
  } as unknown as TaxiDatabase;
  const service = createPublicDataService({
    solanaRpcUrl: 'https://rpc.invalid',
    programId: address('GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4'),
    workerIntervalMs: 60_000,
    fareSymbol: 'FARE',
  }, database);

  const market = await service.market();
  assert.equal(market.listings.length, 1);
  assert.equal(market.listings[0].asset, 'asset-1');
  assert.equal(market.listings[0].nftNumber, 42);
  assert.equal(market.floorLamports, '1250000000');
  assert.equal(market.offers.length, 2);
  assert.equal(market.offers[0].name, 'TAXI Toyota Camry #0042');
  assert.equal(market.offers[1].className, 'Legend');
});

function cursor<T>(rows: T[]) {
  return {
    sort() { return this; },
    limit() { return this; },
    async toArray() { return rows; },
  };
}
