import assert from 'node:assert/strict';
import test from 'node:test';
import { createSolanaProxy, SolanaProxyError, validatePayload } from '../server/solanaProxy.js';

test('Solana proxy accepts only the browser RPC allowlist', () => {
  assert.equal(validatePayload({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [] }).method, 'getAccountInfo');
  assert.throws(
    () => validatePayload({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [] }),
    (error: unknown) => error instanceof SolanaProxyError && error.status === 403,
  );
});

test('Solana proxy forwards an allowed request without exposing the upstream URL', async () => {
  let calledUrl = '';
  const proxy = createSolanaProxy('https://private-rpc.invalid/key', (async (url, init) => {
    calledUrl = String(url);
    assert.deepEqual(JSON.parse(String(init?.body)), { jsonrpc: '2.0', id: 7, method: 'getSlot', params: [] });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 7, result: 123 }), { status: 200 });
  }) as typeof fetch);
  assert.deepEqual(
    await proxy({ jsonrpc: '2.0', id: 7, method: 'getSlot', params: [] }, '127.0.0.1'),
    { jsonrpc: '2.0', id: 7, result: 123 },
  );
  assert.equal(calledUrl, 'https://private-rpc.invalid/key');
});
