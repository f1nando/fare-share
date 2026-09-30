import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePayload } from '../server/solanaProxy.js';

const PROGRAM = 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4';

test('recovery proxy validation accepts only bounded supported RPC calls', () => {
  assert.equal(validatePayload({
    jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
    params: [PROGRAM, { commitment: 'finalized', encoding: 'base64' }],
  }, { programId: PROGRAM }).method, 'getAccountInfo');
  assert.throws(() => validatePayload({
    jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [PROGRAM, 1],
  }, { programId: PROGRAM }), /not allowed/);
});
