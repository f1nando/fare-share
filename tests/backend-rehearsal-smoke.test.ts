import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  REHEARSAL_EXECUTION_CONFIRMATION,
  REHEARSAL_STEPS,
  runRehearsalSmoke,
} from '../server/rehearsalSmoke.js';
import { MAINNET_GENESIS_HASH } from '../server/rehearsalManifest.js';
import { OFFICIAL_XSTOCK_MINTS, REHEARSAL_DATABASE, REHEARSAL_SHARED_ROLE_ADDRESS } from '../server/preflight.js';

const repoRoot = resolve(import.meta.dirname, '..');
const disposable = 'So11111111111111111111111111111111111111112';

function manifest() {
  return {
    validationMode: 'complete', releaseSha: 'a'.repeat(40), sbf: { sha256: 'b'.repeat(64), sizeBytes: 1 },
    cluster: { chain: 'solana:mainnet', genesisHash: MAINNET_GENESIS_HASH }, database: REHEARSAL_DATABASE,
    workerInitiallyEnabled: false, mintPricesUsdCents: [2500, 2500, 2500, 2500],
    addresses: {
      programId: disposable, programData: disposable, collection: disposable, fareMint: disposable,
      replacementFareMint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
      jupiterProgramId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', stockMints: OFFICIAL_XSTOCK_MINTS,
      sharedRole: REHEARSAL_SHARED_ROLE_ADDRESS, feePayer: REHEARSAL_SHARED_ROLE_ADDRESS,
      upgradeAuthority: REHEARSAL_SHARED_ROLE_ADDRESS, admin: REHEARSAL_SHARED_ROLE_ADDRESS,
      backendSigner: REHEARSAL_SHARED_ROLE_ADDRESS, worker: REHEARSAL_SHARED_ROLE_ADDRESS,
      team: REHEARSAL_SHARED_ROLE_ADDRESS, pumpCreatorFeeRecipient: REHEARSAL_SHARED_ROLE_ADDRESS,
      recoveryRecipient: REHEARSAL_SHARED_ROLE_ADDRESS,
    },
    assignmentRootHex: '1234567890abcdef12345678',
    metadata: { collectionUri: 'ar://collection', machineUris: Array.from({ length: 16 }, (_, i) => `ar://machine-${i}`), traineeUri: 'ar://trainee' },
    limits: { automaticStopSol: 0.7, irreversibleMaximumSol: 0.8, recoverableRentLamports: '1' },
  };
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'rehearsal-smoke-'));
  const manifestPath = resolve(root, 'manifest.json');
  const text = `${JSON.stringify(manifest(), null, 2)}\n`;
  await writeFile(manifestPath, text);
  return { root, manifestPath, digest: createHash('sha256').update(text).digest('hex') };
}

function budgetEvidence(stepId: string, digest: string) {
  return {
    version: 1, stepId, manifestSha256: digest, outcome: 'passed', recordedAt: '2026-09-30T00:00:00.000Z',
    observations: {
      spentLamports: '0', reservedLamports: '0', projectedNextLamports: '1', recoverableRentLamports: '1', finalizedBalanceSnapshot: 'snapshot.json',
    },
  };
}

function oldCaMintEvidence(digest: string) {
  return {
    version: 1, stepId: 'old-ca-paid-mint-1', manifestSha256: digest, outcome: 'passed', recordedAt: '2026-09-30T00:01:00.000Z',
    observations: {
      transactionSignature: 'signature', quoteFareMint: disposable, quoteUsdCents: 2500, assignmentIndex: 0,
      asset: 'asset', owner: 'owner', sourceAta: 'source-ata', teamAta: 'team-ata',
      teamAtaDeltaRaw: '123', quotedAmountRaw: '123',
    },
  };
}

test('approved smoke ordering contains all required scenarios and five worker routes', () => {
  assert.deepEqual(REHEARSAL_STEPS.filter(item => item.id.startsWith('old-ca-paid-mint')).map(item => item.id), ['old-ca-paid-mint-1', 'old-ca-paid-mint-2']);
  assert.deepEqual(REHEARSAL_STEPS.filter(item => item.id.startsWith('faretest-paid-mint')).map(item => item.id), ['faretest-paid-mint-1', 'faretest-paid-mint-2']);
  assert.equal(REHEARSAL_STEPS.filter(item => item.id.startsWith('worker-route-')).length, 5);
  assert.ok(REHEARSAL_STEPS.findIndex(item => item.id === 'ca-replacement-stale-quote-rejected') > REHEARSAL_STEPS.findIndex(item => item.id === 'old-ca-paid-mint-2'));
  assert.ok(REHEARSAL_STEPS.findIndex(item => item.id === 'faretest-paid-mint-1') > REHEARSAL_STEPS.findIndex(item => item.id === 'ca-replacement-stale-quote-rejected'));
});

test('dry-run validates but creates no state or evidence files', async () => {
  const item = await fixture();
  const stateDirectory = resolve(item.root, 'outside-state');
  const evidencePath = resolve(item.root, 'dry-run-evidence.json');
  await writeFile(evidencePath, JSON.stringify(budgetEvidence('budget-initial', item.digest)));
  const result = await runRehearsalSmoke({ repoRoot, manifestPath: item.manifestPath, stateDirectory, mode: 'dry-run', evidencePath });
  assert.equal(result.nextStep?.id, 'budget-initial');
  await assert.rejects(stat(stateDirectory), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
});

test('execute fails closed on incomplete manifest, missing evidence, and wrong confirmation', async () => {
  const item = await fixture();
  const bad = manifest();
  bad.validationMode = 'preparation';
  await writeFile(item.manifestPath, JSON.stringify(bad));
  await assert.rejects(runRehearsalSmoke({ repoRoot, manifestPath: item.manifestPath, stateDirectory: resolve(item.root, 'state-a'), mode: 'dry-run' }), /Complete rehearsal manifest/);
  await writeFile(item.manifestPath, `${JSON.stringify(manifest(), null, 2)}\n`);
  await assert.rejects(runRehearsalSmoke({ repoRoot, manifestPath: item.manifestPath, stateDirectory: resolve(item.root, 'state-b'), mode: 'execute', confirmation: 'yes' }), /exact confirmation/);
  await assert.rejects(runRehearsalSmoke({ repoRoot, manifestPath: item.manifestPath, stateDirectory: resolve(item.root, 'state-c'), mode: 'execute', confirmation: REHEARSAL_EXECUTION_CONFIRMATION }), /Evidence is required/);
});

test('execute persists evidence outside Git and resumes at the next ordered step', async () => {
  const item = await fixture();
  const evidencePath = resolve(item.root, 'input-evidence.json');
  await writeFile(evidencePath, JSON.stringify(budgetEvidence('budget-initial', item.digest)));
  const stateDirectory = resolve(item.root, 'state');
  const first = await runRehearsalSmoke({
    repoRoot, manifestPath: item.manifestPath, stateDirectory, mode: 'execute',
    confirmation: REHEARSAL_EXECUTION_CONFIRMATION, evidencePath, now: () => new Date('2026-09-30T01:00:00Z'),
  });
  assert.equal(first.nextStep?.id, 'old-ca-paid-mint-1');
  const resumed = await runRehearsalSmoke({ repoRoot, manifestPath: item.manifestPath, stateDirectory, mode: 'dry-run' });
  assert.deepEqual(resumed.completedStepIds, ['budget-initial']);
  assert.equal(resumed.nextStep?.id, 'old-ca-paid-mint-1');
  await writeFile(evidencePath, JSON.stringify(oldCaMintEvidence(item.digest)));
  const second = await runRehearsalSmoke({
    repoRoot, manifestPath: item.manifestPath, stateDirectory, mode: 'execute',
    confirmation: REHEARSAL_EXECUTION_CONFIRMATION, evidencePath, now: () => new Date('2026-09-30T01:01:00Z'),
  });
  assert.equal(second.nextStep?.id, 'budget-after-old-ca-mint-1');
  const checkpoint = JSON.parse(await readFile(resolve(stateDirectory, 'checkpoint.json'), 'utf8')) as { completedStepIds: string[] };
  assert.deepEqual(checkpoint.completedStepIds, ['budget-initial', 'old-ca-paid-mint-1']);
});

test('evidence is fail-closed for order, completeness, manifest pin, and budget cap', async () => {
  const item = await fixture();
  const stateDirectory = resolve(item.root, 'state');
  for (const evidence of [
    budgetEvidence('old-ca-paid-mint-1', item.digest),
    { ...budgetEvidence('budget-initial', item.digest), manifestSha256: '0'.repeat(64) },
    { ...budgetEvidence('budget-initial', item.digest), observations: { spentLamports: '1' } },
    { ...budgetEvidence('budget-initial', item.digest), observations: { ...budgetEvidence('budget-initial', item.digest).observations, spentLamports: '700000000', projectedNextLamports: '1' } },
  ]) {
    const evidencePath = resolve(item.root, `evidence-${Math.random()}.json`);
    await writeFile(evidencePath, JSON.stringify(evidence));
    await assert.rejects(runRehearsalSmoke({
      repoRoot, manifestPath: item.manifestPath, stateDirectory, mode: 'execute',
      confirmation: REHEARSAL_EXECUTION_CONFIRMATION, evidencePath,
    }));
  }
});
