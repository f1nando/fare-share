import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFICIAL_XSTOCK_MINTS, validateDeploymentEnvironment, validateProgramIdSources } from '../server/preflight.js';

const secret = (seed: string, publicKey: string) => JSON.stringify([...Buffer.from(seed, 'hex'), ...Buffer.from(publicKey, 'hex')]);
const SECRETS = [
  secret('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'),
  secret('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb', '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'),
  secret('c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7', 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025'),
];

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    MONGODB_URI: 'mongodb://127.0.0.1:27017',
    SOLANA_RPC_URL: 'https://rpc.example.test',
    VITE_SOLANA_RPC_URL: 'https://rpc.example.test',
    VITE_SOLANA_CHAIN: 'solana:devnet',
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
    ADMIN_KEYPAIR_SECRET_KEY: SECRETS[0],
    BACKEND_SIGNER_SECRET_KEY: SECRETS[1],
    WORKER_KEYPAIR_SECRET_KEY: SECRETS[2],
    TRAINEE_WORD_PEPPER: 'a-secure-random-pepper-that-is-long-enough',
    JUPITER_API_KEY: 'test-key',
    COLLECTION_NAME: 'FARE Taxi Park',
    COLLECTION_URI: 'https://arweave.net/collection',
    MACHINE_METADATA_URIS: 'ar://economy,ar://comfort,ar://business,ar://legend',
  };
}

test('deployment preflight accepts a complete configuration without exposing secrets', async () => {
  const result = await validateDeploymentEnvironment(validEnvironment());
  assert.deepEqual(result, { errors: [], warnings: [] });
});

test('deployment preflight rejects placeholders, wrong mint order and zero prices', async () => {
  const env = validEnvironment();
  env.BACKEND_SIGNER_SECRET_KEY = '[0,0]';
  env.TRAINEE_WORD_PEPPER = 'replace-with-a-long-random-secret';
  env.DEPLOYMENT_ID_HEX = '0'.repeat(64);
  env.MINT_PRICES_LAMPORTS = '1,0,3,4';
  env.STOCK_MINTS = [...OFFICIAL_XSTOCK_MINTS].reverse().join(',');
  const result = await validateDeploymentEnvironment(env);
  const combined = result.errors.join('\n');
  assert.match(combined, /BACKEND_SIGNER_SECRET_KEY/);
  assert.match(combined, /TRAINEE_WORD_PEPPER/);
  assert.match(combined, /DEPLOYMENT_ID_HEX/);
  assert.match(combined, /MINT_PRICES_LAMPORTS\[1\]/);
  assert.match(combined, /порядок UBERx,TSLAx,GOOGLx,AMZNx/);
  assert.doesNotMatch(combined, /a-secure-random-pepper/);
});

test('deployment preflight rejects a 64-byte array whose key halves do not match', async () => {
  const env = validEnvironment();
  env.WORKER_KEYPAIR_SECRET_KEY = JSON.stringify(Array.from({ length: 64 }, (_, index) => index));
  const result = await validateDeploymentEnvironment(env);
  assert.match(result.errors.join('\n'), /WORKER_KEYPAIR_SECRET_KEY: приватная и публичная части keypair не совпадают/);
});

test('deployment preflight detects program id drift between Rust, Anchor and environment', () => {
  const expected = '7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY';
  assert.deepEqual(validateProgramIdSources(
    expected,
    `[programs.localnet]\ntaxi_park = "${expected}"`,
    `declare_id!("${expected}");`,
  ), []);
  const errors = validateProgramIdSources(
    '11111111111111111111111111111111',
    `[programs.localnet]\ntaxi_park = "${expected}"`,
    `declare_id!("${expected}");`,
  );
  assert.equal(errors.length, 2);
});
