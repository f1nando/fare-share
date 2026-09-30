import assert from 'node:assert/strict';
import test from 'node:test';
import { loadActivationCounts } from '../server/traineeCampaignAdmin.js';

test('trainee campaign activation counts come from finalized on-chain accounts', async () => {
  const campaignData = (value: bigint) => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(value);
    return bytes.toString('base64');
  };
  const fetchImplementation = (async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.method, 'getProgramAccounts');
    assert.deepEqual(request.params[1].filters, [{ dataSize: 90 }]);
    assert.deepEqual(request.params[1].dataSlice, { offset: 40, length: 8 });
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
