import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFICIAL_XSTOCK_MINTS, REHEARSAL_DATABASE, REHEARSAL_SHARED_ROLE_ADDRESS, validateDeploymentEnvironment, validateProgramIdSources } from '../server/preflight.js';
import { MAINNET_GENESIS_HASH, validateRehearsalManifest } from '../server/rehearsalManifest.js';

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
    SOLANA_RPC_MAX_REQUESTS_PER_SECOND: '50',
    SOLANA_SEND_TRANSACTION_MAX_REQUESTS_PER_SECOND: '5',
    SOLANA_DAS_MAX_REQUESTS_PER_SECOND: '10',
    VITE_SOLANA_RPC_URL: 'https://rpc.example.test',
    VITE_SOLANA_RPC_MAX_REQUESTS_PER_SECOND: '50',
    VITE_SOLANA_SEND_TRANSACTION_MAX_REQUESTS_PER_SECOND: '5',
    VITE_SOLANA_CHAIN: 'solana:devnet',
    VITE_SOLANA_DAS_URL: 'https://das.example.test',
    VITE_SOLANA_DAS_MAX_REQUESTS_PER_SECOND: '10',
    VITE_BACKEND_URL: 'https://api.example.test',
    ALLOWED_ORIGIN: 'https://example.test',
    TAXI_PROGRAM_ID: 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4',
    VITE_TAXI_PROGRAM_ID: 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4',
    TEAM_ACCOUNT: '11111111111111111111111111111111',
    JUPITER_PROGRAM_ID: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    FARE_MINT: 'So11111111111111111111111111111111111111112',
    STOCK_MINTS: OFFICIAL_XSTOCK_MINTS.join(','),
    MINT_PRICES_USD_CENTS: '2500,2500,2500,2500',
    MINT_ASSIGNMENT_ROOT_HEX: '11'.repeat(12),
    MINT_ASSIGNMENTS_PATH: 'config/mint-assignments.json',
    DEPLOYMENT_ID_HEX: '12'.repeat(32),
    ADMIN_KEYPAIR_SECRET_KEY: SECRETS[0],
    BACKEND_SIGNER_SECRET_KEY: SECRETS[1],
    WORKER_KEYPAIR_SECRET_KEY: SECRETS[2],
    PUMP_FEE_RECIPIENT_SECRET_KEY: SECRETS[0],
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_SCRYPT: `scrypt$${'11'.repeat(16)}$${'22'.repeat(32)}`,
    ADMIN_SESSION_SECRET: 'admin-session-secret-at-least-32-characters',
    TRAINEE_WORD_PEPPER: 'a-secure-random-pepper-that-is-long-enough',
    JUPITER_API_KEY: 'test-key',
    JUPITER_REQUESTS_PER_SECOND: '10',
    COLLECTION_NAME: 'FARE Taxi Park',
    COLLECTION_URI: 'https://arweave.net/collection',
    MACHINE_METADATA_URIS: Array.from({ length: 16 }, (_, index) => `ar://machine-${index}`).join(','),
    TRAINEE_METADATA_URI: 'ar://trainee',
  };
}

test('deployment preflight accepts a complete configuration without exposing secrets', async () => {
  const result = await validateDeploymentEnvironment(validEnvironment());
  assert.deepEqual(result, { errors: [], warnings: [] });
});

test('deployment preflight permits preparing the program before FARE mint exists', async () => {
  const env = validEnvironment();
  delete env.FARE_MINT;
  const result = await validateDeploymentEnvironment(env);
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join('\n'), /FARE_MINT.*runtime-replaceable/);
});

test('deployment preflight rejects placeholders, wrong mint order and zero prices', async () => {
  const env = validEnvironment();
  env.BACKEND_SIGNER_SECRET_KEY = '[0,0]';
  env.TRAINEE_WORD_PEPPER = 'replace-with-a-long-random-secret';
  env.DEPLOYMENT_ID_HEX = '0'.repeat(64);
  env.MINT_PRICES_USD_CENTS = '2500,0,3,4';
  env.STOCK_MINTS = [...OFFICIAL_XSTOCK_MINTS].reverse().join(',');
  const result = await validateDeploymentEnvironment(env);
  const combined = result.errors.join('\n');
  assert.match(combined, /BACKEND_SIGNER_SECRET_KEY/);
  assert.match(combined, /TRAINEE_WORD_PEPPER/);
  assert.match(combined, /DEPLOYMENT_ID_HEX/);
  assert.match(combined, /MINT_PRICES_USD_CENTS\[1\]/);
  assert.match(combined, /expected UBERx,TSLAx,GOOGLx,AMZNx order/);
  assert.doesNotMatch(combined, /a-secure-random-pepper/);
});

test('deployment preflight permits explicit test mints only on devnet', async () => {
  const env = validEnvironment();
  env.STOCK_MINTS = [
    'EfKpTsykvLLew289idBNd89TKjRNQSqL8YJQHE4PaTui',
    '4MZq4bmK6waS6xg2BtwFnq6oXBH2CQifFQ8FaqPgEzeP',
    'EaUbexsnj136p7nxHbeKxh8dnNDMdctjGYjcXZjRpx4P',
    'FFxPKHYbaSgzp6g12MgH1ybQZH76EMPkhPsFMg9oMh7f',
  ].join(',');
  env.DEVNET_ALLOW_TEST_MINTS = 'true';
  env.JUPITER_API_KEY = '';
  const devnet = await validateDeploymentEnvironment(env);
  assert.deepEqual(devnet.errors, []);
  assert.match(devnet.warnings.join('\n'), /test Devnet mints/);
  assert.match(devnet.warnings.join('\n'), /swap worker will be disabled/);

  env.VITE_SOLANA_CHAIN = 'solana:mainnet';
  const mainnet = await validateDeploymentEnvironment(env);
  assert.match(mainnet.errors.join('\n'), /DEVNET_ALLOW_TEST_MINTS: allowed only/);
  assert.match(mainnet.errors.join('\n'), /official mints/);
  assert.match(mainnet.errors.join('\n'), /JUPITER_API_KEY/);
});

test('deployment preflight rejects a 64-byte array whose key halves do not match', async () => {
  const env = validEnvironment();
  env.WORKER_KEYPAIR_SECRET_KEY = JSON.stringify(Array.from({ length: 64 }, (_, index) => index));
  const result = await validateDeploymentEnvironment(env);
  assert.match(result.errors.join('\n'), /WORKER_KEYPAIR_SECRET_KEY: private and public keypair parts do not match/);
});

test('deployment preflight rejects legacy lamport values used as USD cents', async () => {
  const env = validEnvironment();
  env.MINT_PRICES_USD_CENTS = '350000000,1000000000,3000000000,8000000000';
  const result = await validateDeploymentEnvironment(env);
  assert.match(result.errors.join('\n'), /every mint price must equal 2500/);
});

test('rehearsal environment is fail-closed around mainnet, database, worker and approved shared role', async () => {
  const env = validEnvironment();
  env.REHEARSAL_MODE = 'true';
  env.REHEARSAL_SHARED_ROLE_ADDRESS = REHEARSAL_SHARED_ROLE_ADDRESS;
  env.MONGODB_DATABASE = REHEARSAL_DATABASE;
  env.VITE_SOLANA_CHAIN = 'solana:mainnet';
  env.WORKER_INITIAL_ENABLED = 'false';
  env.REHEARSAL_ORDINARY_BUDGET_LAMPORTS = '700000000';
  env.REHEARSAL_HARD_BUDGET_LAMPORTS = '800000000';
  env.REHEARSAL_INITIAL_SPENT_LAMPORTS = '0';
  env.TEAM_ACCOUNT = REHEARSAL_SHARED_ROLE_ADDRESS;
  env.ADMIN_KEYPAIR_SECRET_KEY = SECRETS[0];
  env.BACKEND_SIGNER_SECRET_KEY = SECRETS[0];
  env.WORKER_KEYPAIR_SECRET_KEY = SECRETS[0];
  const rehearsal = await validateDeploymentEnvironment(env);
  const combined = rehearsal.errors.join('\n');
  assert.doesNotMatch(combined, /ADMIN and BACKEND_SIGNER must use different keypairs/);
  assert.match(combined, /rehearsal signers must match 2NUN/);

  env.REHEARSAL_MODE = 'false';
  const production = await validateDeploymentEnvironment(env);
  assert.match(production.errors.join('\n'), /ADMIN and BACKEND_SIGNER must use different keypairs/);
});

test('rehearsal environment requires explicit safe fixed settings', async () => {
  const env = validEnvironment();
  env.REHEARSAL_MODE = 'true';
  env.REHEARSAL_SHARED_ROLE_ADDRESS = '11111111111111111111111111111111';
  env.MONGODB_DATABASE = 'taxi_park';
  env.WORKER_INITIAL_ENABLED = 'true';
  const result = await validateDeploymentEnvironment(env);
  const combined = result.errors.join('\n');
  assert.match(combined, /fare_share_disposable_rehearsal/);
  assert.match(combined, /requires solana:mainnet/);
  assert.match(combined, /must explicitly start with false/);
  assert.match(combined, /REHEARSAL_SHARED_ROLE_ADDRESS/);
  assert.match(combined, /REHEARSAL_ORDINARY_BUDGET_LAMPORTS/);
  assert.match(combined, /REHEARSAL_HARD_BUDGET_LAMPORTS/);
});

function completeRehearsalManifest() {
  const sharedRole = REHEARSAL_SHARED_ROLE_ADDRESS;
  return {
    validationMode: 'complete',
    releaseSha: '1'.repeat(40),
    sbf: { sha256: '2'.repeat(64), sizeBytes: 669_552 },
    cluster: { chain: 'solana:mainnet', genesisHash: MAINNET_GENESIS_HASH },
    database: REHEARSAL_DATABASE,
    workerInitiallyEnabled: false,
    mintPricesUsdCents: [2500, 2500, 2500, 2500],
    addresses: {
      programId: 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4',
      programData: 'F3B4QLnRRBumZ27TARxSKQdZ75sb7pU3crbnU5A3LHLo',
      collection: '5DwDcfC4jsY8tq7VQqLGCmsWmVepVjDfMoWpZWAL5nro',
      fareMint: '4fg5Nh2wjVddSfDPW1AATQ9Tvmdc1Np1pBQQGL4Mpump',
      replacementFareMint: 'So11111111111111111111111111111111111111112',
      jupiterProgramId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      stockMints: [...OFFICIAL_XSTOCK_MINTS],
      sharedRole, feePayer: sharedRole, upgradeAuthority: sharedRole, admin: sharedRole,
      backendSigner: sharedRole, worker: sharedRole, team: sharedRole,
      pumpCreatorFeeRecipient: sharedRole, recoveryRecipient: sharedRole,
    },
    assignmentRootHex: 'ab'.repeat(12),
    metadata: {
      collectionUri: 'ar://collection',
      machineUris: Array.from({ length: 16 }, (_, index) => `ar://machine-${index}`),
      traineeUri: 'ar://trainee',
    },
    limits: { automaticStopSol: 0.7, irreversibleMaximumSol: 0.8, recoverableRentLamports: '3400000000' },
  };
}

test('complete rehearsal manifest binds the frozen release and safety limits', () => {
  assert.deepEqual(validateRehearsalManifest(completeRehearsalManifest(), 'complete'), {
    errors: [], warnings: [], deploymentAuthorized: true,
  });
});

test('preparation manifest can be incomplete but never authorizes deployment', () => {
  const manifest = completeRehearsalManifest();
  manifest.validationMode = 'preparation';
  manifest.releaseSha = '<40_CHAR_RELEASE_SHA>';
  manifest.sbf = { sha256: '<64_CHAR_SBF_SHA256>', sizeBytes: 0 };
  manifest.addresses.programId = '<DISPOSABLE_PROGRAM_ID>';
  manifest.addresses.programData = '<DISPOSABLE_PROGRAM_DATA>';
  manifest.addresses.collection = '<DISPOSABLE_COLLECTION>';
  manifest.addresses.replacementFareMint = '<DISPOSABLE_REPLACEMENT_FARE_MINT>';
  manifest.assignmentRootHex = '<24_CHAR_ASSIGNMENT_ROOT>';
  manifest.metadata = { collectionUri: '<PERMANENT_COLLECTION_URI>', machineUris: [], traineeUri: '<PERMANENT_TRAINEE_URI>' };
  manifest.limits.recoverableRentLamports = '<EXACT_RECOVERABLE_RENT_LAMPORTS>';
  const result = validateRehearsalManifest(manifest, 'preparation');
  assert.deepEqual(result.errors, []);
  assert.equal(result.deploymentAuthorized, false);
  assert.match(result.warnings.join('\n'), /cannot authorize deployment/);
});

test('complete rehearsal manifest rejects placeholders and safety drift', () => {
  const manifest = completeRehearsalManifest();
  manifest.releaseSha = '<RELEASE_SHA>';
  manifest.database = 'taxi_park';
  manifest.workerInitiallyEnabled = true;
  manifest.limits = { automaticStopSol: 0.8, irreversibleMaximumSol: 0.9, recoverableRentLamports: '0' };
  const result = validateRehearsalManifest(manifest, 'complete');
  assert.equal(result.deploymentAuthorized, false);
  const combined = result.errors.join('\n');
  assert.match(combined, /complete mode rejects placeholders/);
  assert.match(combined, /fare_share_disposable_rehearsal/);
  assert.match(combined, /automaticStopSol/);
  assert.match(combined, /irreversibleMaximumSol/);
  assert.match(combined, /positive lamport string/);
});

test('deployment preflight requires 16 distinct ordered machine metadata URIs', async () => {
  const missing = validEnvironment();
  missing.MACHINE_METADATA_URIS = Array.from({ length: 15 }, (_, index) => `ar://machine-${index}`).join(',');
  assert.match((await validateDeploymentEnvironment(missing)).errors.join('\n'), /exactly 16/);

  const duplicate = validEnvironment();
  duplicate.MACHINE_METADATA_URIS = Array.from({ length: 16 }, () => 'ar://same').join(',');
  assert.match((await validateDeploymentEnvironment(duplicate)).errors.join('\n'), /distinct URI/);
});

test('deployment preflight detects program id drift between Rust, Anchor and environment', () => {
  const expected = 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4';
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
