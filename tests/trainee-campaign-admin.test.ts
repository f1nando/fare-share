import assert from 'node:assert/strict';
import test from 'node:test';
import { createTraineeCampaignAdmin, fixedTraineeCampaignWord, loadActivationCounts } from '../server/traineeCampaignAdmin.js';
import { keywordHash } from '../server/signing.js';

test('trainee campaign activation counts come from finalized on-chain accounts', async () => {
  const campaignData = (value: bigint) => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(value);
    return bytes.toString('base64');
  };
  const fetchImplementation = (async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.method, 'getProgramAccounts');
    assert.deepEqual(request.params[1].filters, [{ dataSize: 122 }]);
    assert.deepEqual(request.params[1].dataSlice, { offset: 72, length: 8 });
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: [1n, 1n, 2n].map(value => ({ account: { data: [campaignData(value), 'base64'] } })),
    }), { status: 200 });
  }) as typeof fetch;

  const counts = await loadActivationCounts('https://rpc.invalid', '11111111111111111111111111111111', fetchImplementation);
  assert.equal(counts.get('1'), 2);
  assert.equal(counts.get('2'), 1);
});

test('primary trainee word follows the configured token ticker', async () => {
  let update: any;
  const database = {
    campaigns: {
      async updateOne(filter: unknown, value: unknown, options: unknown) { update = { filter, value, options }; },
    },
  } as any;
  const service = createTraineeCampaignAdmin({
    solanaRpcUrl: 'https://rpc.invalid',
    programId: '11111111111111111111111111111111',
    wordPepper: 'test-pepper',
  }, database);

  await service.ensurePrimary('$taxi');

  assert.deepEqual(update.filter, { campaignId: '1' });
  assert.equal(update.value.$set.displayWord, 'TAXI');
  assert.equal(update.value.$set.keywordHash, keywordHash('TAXI', 'test-pepper'));
  assert.equal(update.value.$set.durationMinutes, 1_440);
  assert.deepEqual(update.options, { upsert: true });
});

test('rehearsal primary trainee word stays TAXI after runtime ticker replacement', async () => {
  const updates: any[] = [];
  const database = {
    campaigns: {
      async updateOne(filter: unknown, value: unknown, options: unknown) { updates.push({ filter, value, options }); },
    },
  } as any;
  const service = createTraineeCampaignAdmin({
    solanaRpcUrl: 'https://rpc.invalid',
    programId: '11111111111111111111111111111111',
    wordPepper: 'test-pepper',
    primaryWord: fixedTraineeCampaignWord('fare_share_disposable_rehearsal'),
  }, database);

  await service.ensurePrimary('FARE');
  await service.ensurePrimary('FARETEST');

  assert.equal(updates.length, 2);
  for (const update of updates) {
    assert.deepEqual(update.filter, { campaignId: '1' });
    assert.equal(update.value.$set.label, 'TAXI');
    assert.equal(update.value.$set.displayWord, 'TAXI');
    assert.equal(update.value.$set.keywordHash, keywordHash('TAXI', 'test-pepper'));
  }
  assert.equal(fixedTraineeCampaignWord('taxi_park'), undefined);
});
