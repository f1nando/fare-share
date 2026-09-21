import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFICIAL_XSTOCK_MINTS, validateDeploymentEnvironment } from '../server/preflight.js';

const secret = (offset: number) => JSON.stringify(Array.from({ length: 64 }, (_, index) => (index + offset) % 256));

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    MONGODB_URI: 'mongodb://127.0.0.1:27017',
    SOLANA_RPC_URL: 'https://rpc.example.test',
    VITE_SOLANA_RPC_URL: 'https://rpc.example.test',
    VITE_SOLANA_DAS_URL: 'https://das.example.test',
    VITE_BACKEND_URL: 'https://api.example.test',
    ALLOWED_ORIGIN: 'https://example.test',
    TAXI_PROGRAM_ID: '7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY',
    VITE_TAXI_PROGRAM_ID: '7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY',
    TEAM_ACCOUNT: '11111111111111111111111111111111',
    JUPITER_PROGRAM_ID: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    FARE_MINT: 'So11111111111111111111111111111111111111112',
    STOCK_MINTS: OFFICIAL_XSTOCK_MINTS.join(','),
    MINT_PRICES_LAMPORTS: '1,2,3,4',
    DEPLOYMENT_ID_HEX: '12'.repeat(32),
    ADMIN_KEYPAIR_SECRET_KEY: secret(1),
    BACKEND_SIGNER_SECRET_KEY: secret(2),
    WORKER_KEYPAIR_SECRET_KEY: secret(3),
    TRAINEE_WORD_PEPPER: 'a-secure-random-pepper-that-is-long-enough',
    JUPITER_API_KEY: 'test-key',
    COLLECTION_NAME: 'FARE Taxi Park',
    COLLECTION_URI: 'https://arweave.net/collection',
    MACHINE_METADATA_URIS: 'ar://economy,ar://comfort,ar://business,ar://legend',
  };
}

test('deployment preflight accepts a complete configuration without exposing secrets', () => {
  const result = validateDeploymentEnvironment(validEnvironment());
  assert.deepEqual(result, { errors: [], warnings: [] });
});

test('deployment preflight rejects placeholders, wrong mint order and zero prices', () => {
  const env = validEnvironment();
  env.BACKEND_SIGNER_SECRET_KEY = '[0,0]';
  env.TRAINEE_WORD_PEPPER = 'replace-with-a-long-random-secret';
  env.DEPLOYMENT_ID_HEX = '0'.repeat(64);
  env.MINT_PRICES_LAMPORTS = '1,0,3,4';
  env.STOCK_MINTS = [...OFFICIAL_XSTOCK_MINTS].reverse().join(',');
  const result = validateDeploymentEnvironment(env);
  const combined = result.errors.join('\n');
  assert.match(combined, /BACKEND_SIGNER_SECRET_KEY/);
  assert.match(combined, /TRAINEE_WORD_PEPPER/);
  assert.match(combined, /DEPLOYMENT_ID_HEX/);
  assert.match(combined, /MINT_PRICES_LAMPORTS\[1\]/);
  assert.match(combined, /порядок UBERx,TSLAx,GOOGLx,AMZNx/);
  assert.doesNotMatch(combined, /a-secure-random-pepper/);
});
