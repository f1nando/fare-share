import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runRecovery, type CommandResult, type CommandRunner } from '../scripts/close-mainnet-programdata.js';

const shared = '2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF';
const programId = 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4';
const programData = 'F3B4QLnRRBumZ27TARxSKQdZ75sb7pU3crbnU5A3LHLo';
const buffer = '4Z2mUq8Y3BYqg6f1a2WMbLsGGBYbXmRYXKf7q5R1ft2m';
const rent = 3_402_203_000n;

test('default dry-run invokes the strengthened audit but never sends a close command', async () => {
  const fixture = await recoveryFixture(false);
  await runRecovery(fixture.options, fixture.run);
  assert.equal(fixture.calls.some(call => call.args[0] === 'close' || call.args[1] === 'close'), false);
  assert.equal(fixture.calls.filter(call => call.command === process.execPath).length, 1);
  assert.deepEqual(fixture.calls.find(call => call.command === process.execPath)?.args.slice(-2), ['--require-paused', '--require-empty-vaults']);
});

test('execute uses fake Solana commands, audits immediately before close, and verifies finalized state and bounded return', async () => {
  const fixture = await recoveryFixture(true);
  await runRecovery(fixture.options, fixture.run);
  const closeIndex = fixture.calls.findIndex(call => call.args[0] === 'program' && call.args[1] === 'close');
  assert.ok(closeIndex > 0);
  assert.equal(fixture.calls[closeIndex - 1].command, process.execPath);
  assert.deepEqual(fixture.calls[closeIndex].args.slice(0, 9), [
      'program', 'close', programId, '--recipient', shared, '--authority', fixture.keypair, '--keypair', fixture.keypair,
  ]);
  assert.ok(fixture.calls.some(call => call.args[0] === 'account' && call.args[1] === programData));
  assert.ok(fixture.calls.some(call => call.args[0] === 'program' && call.args[1] === 'show'));
});

test('execute fails closed when the recipient delta is below rent minus bounded fees', async () => {
  const fixture = await recoveryFixture(true, rent - 50_001n);
  await assert.rejects(runRecovery(fixture.options, fixture.run), /Recipient delta .* is outside/);
});

test('execute rejects anything except the exact irreversible confirmation before close', async () => {
  const fixture = await recoveryFixture(true);
  fixture.options.confirm = 'CLOSE IT';
  await assert.rejects(runRecovery(fixture.options, fixture.run), /execute confirmation mismatch/);
  assert.equal(fixture.calls.some(call => call.args[0] === 'program' && call.args[1] === 'close'), false);
});

async function recoveryFixture(execute: boolean, delta = rent - 5_000n) {
  const directory = await mkdtemp(join(tmpdir(), 'mainnet-close-'));
  const keypair = join(directory, 'signer.json');
  const bufferKeypair = join(directory, 'buffer.json');
  await writeFile(keypair, '[1]');
  await writeFile(bufferKeypair, '[2]');
  const manifest = completeManifest();
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, manifestBytes);
  const calls: Array<{ command: string; args: string[] }> = [];
  let balances = 0;
  const run: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === process.execPath) return result(auditOutput());
    if (args[0] === 'genesis-hash') return result('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d\n');
    if (args[0] === 'address') {
      const expected = args[2] === bufferKeypair ? buffer : shared;
      return result(`${expected}\n`);
    }
    if (args[0] === 'balance') return result(`${balances++ === 0 ? 1_000_000_000n : 1_000_000_000n + delta}\n`);
    if (args[0] === 'program' && args[1] === 'close') return result('Signature: fake-close-signature\n');
    if (args[0] === 'account' && args[1] === programData) return result('', 1, 'Account not found');
    if (args[0] === 'account' && args[1] === programId) return result(JSON.stringify({
      owner: 'BPFLoaderUpgradeab1e11111111111111111111111', executable: false, lamports: 833120,
    }));
    if (args[0] === 'program' && args[1] === 'show') return result(`Program ${programId} has been closed\n`);
    return result('', 1, `Unexpected fake Solana command: ${args.join(' ')}`);
  };
  const options = {
    manifest: manifestPath,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    rpcUrl: 'http://mainnet-rpc.invalid', programId, programData, authority: shared, feePayer: shared,
    buffer, recipient: shared, worker: shared, backend: shared,
    authorityKeypair: keypair, feePayerKeypair: keypair, bufferKeypair, workerKeypair: keypair, backendKeypair: keypair,
    servicesStopped: 'I CONFIRM ALL TRANSACTION-SENDING SERVICES ARE STOPPED',
    protocolPaused: 'I CONFIRM THE PROTOCOL IS PAUSED ON CHAIN', maxFeeLamports: 50_000n, execute,
    confirm: `CLOSE MAINNET PROGRAM ${programId} PROGRAMDATA ${programData} TO ${shared} RETURN ${rent} LAMPORTS FOREVER`,
    solanaBin: 'fake-solana',
  };
  return { options, run, calls, keypair };
}

function completeManifest() {
  return {
    validationMode: 'complete', releaseSha: 'a'.repeat(40), sbf: { sha256: 'b'.repeat(64), sizeBytes: 1 },
    cluster: { chain: 'solana:mainnet', genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' },
    database: 'fare_share_disposable_rehearsal', workerInitiallyEnabled: false, mintPricesUsdCents: [2500, 2500, 2500, 2500],
    addresses: {
      programId, programData, buffer, collection: '56acKgFW1Tn9vzcsBysWiYNjQYBzTySdLfZzUk1NCctp', userWallet: buffer,
      fareMint: '4fg5Nh2wjVddSfDPW1AATQ9Tvmdc1Np1pBQQGL4Mpump', replacementFareMint: 'So11111111111111111111111111111111111111112',
      jupiterProgramId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      stockMints: ['XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB','XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB','XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN','Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg'],
      sharedRole: shared, feePayer: shared, upgradeAuthority: shared, admin: shared, backendSigner: shared, worker: shared,
      team: shared, pumpCreatorFeeRecipient: shared, recoveryRecipient: shared,
    },
    assignmentRootHex: '1234567890abcdef12345678',
    assignmentManifestSha256: 'c'.repeat(64), deploymentIdHex: 'd'.repeat(64),
    metadata: { collectionUri: 'https://example.invalid/collection', machineUris: Array.from({ length: 16 }, (_, i) => `https://example.invalid/${i}`), traineeUri: 'https://example.invalid/trainee', imageUris: Array.from({ length: 18 }, (_, i) => `https://example.invalid/image-${i}`), faretestArtworkUri: 'https://example.invalid/faretest.svg', faretestMetadataUri: 'https://example.invalid/faretest.json' },
    limits: { automaticStopSol: 0.7, irreversibleMaximumSol: 0.8, recoverableRentLamports: String(rent), uploadBufferRentLamports: '3400000000', programTombstoneLamports: '833120', estimatedPeakFundingLamports: '7600000000' },
  };
}

function auditOutput() {
  return [
    `PROGRAM_ID=${programId}`, `PROGRAMDATA_ADDRESS=${programData}`, `UPGRADE_AUTHORITY=${shared}`, `RECIPIENT=${shared}`,
    'PROGRAMDATA_RECOVERABLE_SOL=3.402203000', 'MAINNET_RECOVERY_DRY_RUN=PASS', '',
  ].join('\n');
}

function result(stdout: string, code = 0, stderr = ''): CommandResult { return { code, stdout, stderr }; }
