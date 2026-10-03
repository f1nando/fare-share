import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  executeDisposableDeploy,
  runDisposablePreflight,
  type CommandResult,
  type DeployOptions,
} from '../scripts/deploy-disposable-rehearsal.js';

const PROGRAM = 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4';
const PROGRAM_DATA = '3mUafcsMtJmQBym8AzguUQPZSV5yNgTjYsc3cpuReazU';
const SHARED = 'F3jKZokibZiN5SJM5JM4T3a99HVb4zueDTGPR5hbn8tR';
const BUFFER = '5uK9HMPXw7mhr8D5darUMvJnRL9gunQw9p1FWWk6TuoQ';

async function fixture(): Promise<{ options: DeployOptions; calls: string[][] }> {
  const directory = await mkdtemp(join(tmpdir(), 'deploy-preflight-test-'));
  const binary = Buffer.from('sbf');
  const paths = Object.fromEntries(['program', 'authority', 'payer', 'recipient', 'buffer'].map(name => [name, join(directory, `${name}.json`)]));
  await Promise.all(Object.values(paths).map(path => writeFile(path, '[]')));
  const marker = join(directory, 'backup.json');
  await writeFile(marker, JSON.stringify({ programId: PROGRAM, upgradeAuthority: SHARED, buffer: BUFFER, backupVerified: true, verifiedAt: '2026-09-30' }));
  const manifest = join(directory, 'manifest.json');
  await writeFile(manifest, JSON.stringify({
    validationMode: 'complete', releaseSha: 'a'.repeat(40),
    sbf: { sha256: createHash('sha256').update(binary).digest('hex'), sizeBytes: binary.length },
    cluster: { chain: 'solana:mainnet', genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' },
    database: 'fare_share_disposable_rehearsal', workerInitiallyEnabled: false,
    mintPricesUsdCents: [2500, 2500, 2500, 2500],
    addresses: {
      programId: PROGRAM, programData: PROGRAM_DATA, buffer: BUFFER, collection: PROGRAM, userWallet: BUFFER, fareMint: PROGRAM, replacementFareMint: PROGRAM,
      jupiterProgramId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      stockMints: ['XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB', 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg'],
      sharedRole: SHARED, feePayer: SHARED, upgradeAuthority: SHARED, admin: SHARED, backendSigner: SHARED,
      worker: SHARED, team: SHARED, pumpCreatorFeeRecipient: SHARED, recoveryRecipient: SHARED,
    },
    assignmentRootHex: '1'.repeat(24),
    assignmentManifestSha256: '2'.repeat(64), deploymentIdHex: '3'.repeat(64),
    metadata: { collectionUri: 'https://example.com/collection', machineUris: Array.from({ length: 16 }, (_, i) => `https://example.com/${i}`), traineeUri: 'https://example.com/trainee', imageUris: Array.from({ length: 18 }, (_, i) => `https://example.com/image-${i}`), faretestArtworkUri: 'https://example.com/faretest.svg', faretestMetadataUri: 'https://example.com/faretest.json' },
    limits: { automaticStopSol: 0.7, irreversibleMaximumSol: 0.8, recoverableRentLamports: '108', uploadBufferRentLamports: '108', programTombstoneLamports: '1', estimatedPeakFundingLamports: '900000217' },
  }));
  const programSo = join(directory, 'program.so');
  await writeFile(programSo, binary);
  const calls: string[][] = [];
  return {
    options: {
      manifestPath: manifest, programSo, programKeypair: paths.program, upgradeAuthorityKeypair: paths.authority,
      feePayerKeypair: paths.payer, recipientKeypair: paths.recipient, bufferKeypair: paths.buffer,
      bufferAddress: BUFFER, backupMarker: marker, rpcUrl: 'https://fake.invalid',
    }, calls,
  };
}

function fakeRunner(options: DeployOptions, calls: string[][]) {
  return (command: string, args: string[]): CommandResult => {
    calls.push([command, ...args]);
    if (command === 'solana-keygen') {
      const path = args[1];
      const key = path === options.programKeypair ? PROGRAM : path === options.bufferKeypair ? BUFFER : SHARED;
      return ok(`${key}\n`);
    }
    if (args[0] === 'genesis-hash') return ok('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d\n');
    if (args[0] === 'rent') return ok('108 lamports\n');
    if (args[0] === 'balance') return ok('900000217 lamports\n');
    if (args[0] === 'program' && args[1] === 'show') return { status: 1, stdout: '', stderr: 'not found' };
    return ok('');
  };
}

test('preflight is read-only and binds every frozen deploy input', async () => {
  const { options, calls } = await fixture();
  const result = await runDisposablePreflight(options, fakeRunner(options, calls));
  assert.equal(result.bufferRentLamports, 108n);
  assert.equal(result.programDataRentLamports, 108n);
  assert.equal(result.confirmation, `DEPLOY-DISPOSABLE-MAINNET:${'a'.repeat(40)}:${PROGRAM}`);
  assert.equal(calls.some(call => call.includes('deploy') || call.includes('close') || call.includes('new')), false);
});

test('execute rejects anything except the exact confirmation before a deploy command', async () => {
  const { options, calls } = await fixture();
  await assert.rejects(() => executeDisposableDeploy(options, 'yes', fakeRunner(options, calls)), /Exact confirmation required/);
  assert.equal(calls.some(call => call.includes('deploy')), false);
});

test('execute remains disabled under the test environment even with exact confirmation', async () => {
  const { options, calls } = await fixture();
  await assert.rejects(
    () => executeDisposableDeploy(options, `DEPLOY-DISPOSABLE-MAINNET:${'a'.repeat(40)}:${PROGRAM}`, fakeRunner(options, calls)),
    /disabled in test environments/,
  );
  assert.equal(calls.some(call => call.includes('deploy')), false);
});

function ok(stdout: string): CommandResult { return { status: 0, stdout, stderr: '' }; }
