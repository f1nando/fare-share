import assert from 'node:assert/strict';
import test from 'node:test';
import { createSolanaProxy, SolanaProxyError, validatePayload } from '../server/solanaProxy.js';

const PROGRAM_ID = 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4';
const OWNER = '11111111111111111111111111111111';

test('Solana proxy accepts the bounded browser RPC contracts', () => {
  assert.equal(validatePayload({
    jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
    params: [OWNER, { commitment: 'finalized', encoding: 'base64' }],
  }).method, 'getAccountInfo');
  assert.equal(validatePayload({
    jsonrpc: '2.0', id: 2, method: 'getMultipleAccounts',
    params: [[OWNER, PROGRAM_ID], { commitment: 'finalized', encoding: 'base64' }],
  }).method, 'getMultipleAccounts');
  assert.equal(validatePayload({
    jsonrpc: '2.0', id: 3, method: 'getAssetsByOwner',
    params: { ownerAddress: OWNER, page: 1, limit: 1_000 },
  }).method, 'getAssetsByOwner');
});

test('Solana proxy only permits the exact trainee program scan', () => {
  const safeScan = {
    jsonrpc: '2.0', id: 1, method: 'getProgramAccounts', params: [PROGRAM_ID, {
      commitment: 'finalized', encoding: 'base64',
      filters: [{ dataSize: 122 }, { memcmp: { offset: 8, bytes: OWNER } }],
    }],
  };
  assert.equal(validatePayload(safeScan, { programId: PROGRAM_ID }).method, 'getProgramAccounts');
  assert.throws(
    () => validatePayload({ ...safeScan, params: [PROGRAM_ID, { encoding: 'base64' }] }, { programId: PROGRAM_ID }),
    (error: unknown) => error instanceof SolanaProxyError && error.status === 400,
  );
  assert.throws(
    () => validatePayload({ ...safeScan, params: [OWNER, safeScan.params[1]] }, { programId: PROGRAM_ID }),
    (error: unknown) => error instanceof SolanaProxyError && error.status === 403,
  );
});

test('Solana proxy rejects expensive or unused request shapes', () => {
  assert.throws(
    () => validatePayload({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [] }),
    (error: unknown) => error instanceof SolanaProxyError && error.status === 403,
  );
  assert.throws(
    () => validatePayload({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [Array(101).fill(OWNER)] }),
    (error: unknown) => error instanceof SolanaProxyError && error.status === 400,
  );
  assert.throws(
    () => validatePayload({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [OWNER, { encoding: 'jsonParsed' }] }),
    (error: unknown) => error instanceof SolanaProxyError && error.status === 400,
  );
  assert.throws(
    () => validatePayload({ jsonrpc: '2.0', id: 1, method: 'getAssetsByOwner', params: { ownerAddress: OWNER, page: 1, limit: 1_001 } }),
    (error: unknown) => error instanceof SolanaProxyError && error.status === 400,
  );
});

test('Solana proxy forwards a valid request without exposing the upstream URL', async () => {
  let calledUrl = '';
  const proxy = createSolanaProxy('https://private-rpc.invalid/key', { fetchImpl: (async (url, init) => {
    calledUrl = String(url);
    assert.deepEqual(JSON.parse(String(init?.body)), { jsonrpc: '2.0', id: 7, method: 'getSlot', params: [] });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 7, result: 123 }), { status: 200 });
  }) as typeof fetch });
  assert.deepEqual(
    await proxy({ jsonrpc: '2.0', id: 7, method: 'getSlot', params: [] }, '127.0.0.1'),
    { jsonrpc: '2.0', id: 7, result: 123 },
  );
  assert.equal(calledUrl, 'https://private-rpc.invalid/key');
});

test('Solana proxy stops oversized upstream responses', async () => {
  const proxy = createSolanaProxy('https://private-rpc.invalid/key', {
    fetchImpl: (async () => new Response('x'.repeat(300 * 1024), { status: 200 })) as typeof fetch,
  });
  await assert.rejects(
    proxy({ jsonrpc: '2.0', id: 7, method: 'getSlot', params: [] }, '127.0.0.1'),
    (error: unknown) => error instanceof SolanaProxyError && error.status === 502 && /too large/i.test(error.message),
  );
});
