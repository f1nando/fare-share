import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { findAssociatedTokenPda } from '@solana-program/token';
import { address } from '@solana/kit';
import {
  liquidateDisposableFaretest,
  type CheckedLiquidationRoute,
  type LiquidationRuntime,
} from '../scripts/liquidate-disposable-faretest.js';

const MINT = 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4';
const SHARED = 'F3jKZokibZiN5SJM5JM4T3a99HVb4zueDTGPR5hbn8tR';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const WSOL = 'So11111111111111111111111111111111111111112';

async function fixture(overrides: Partial<{
  tokenMint: string; tokenOwner: string; routeDestination: string; route: boolean;
}> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'faretest-liquidation-'));
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    validationMode: 'complete', releaseSha: 'a'.repeat(40), sbf: { sha256: 'b'.repeat(64), sizeBytes: 1 },
    cluster: { chain: 'solana:mainnet', genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' },
    database: 'fare_share_disposable_rehearsal', workerInitiallyEnabled: false, mintPricesUsdCents: [2500, 2500, 2500, 2500],
    addresses: {
      programId: MINT, programData: MINT, buffer: MINT, collection: MINT, userWallet: MINT, fareMint: MINT, replacementFareMint: MINT,
      jupiterProgramId: JUPITER,
      stockMints: ['XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB', 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg'],
      sharedRole: SHARED, feePayer: SHARED, upgradeAuthority: SHARED, admin: SHARED, backendSigner: SHARED,
      worker: SHARED, team: SHARED, pumpCreatorFeeRecipient: SHARED, recoveryRecipient: SHARED,
    },
    assignmentRootHex: '1'.repeat(24),
    assignmentManifestSha256: '2'.repeat(64), deploymentIdHex: '3'.repeat(64),
    metadata: { collectionUri: 'https://example.com/c', machineUris: Array.from({ length: 16 }, (_, i) => `https://example.com/${i}`), traineeUri: 'https://example.com/t', imageUris: Array.from({ length: 18 }, (_, i) => `https://example.com/image-${i}`), faretestArtworkUri: 'https://example.com/fa.svg', faretestMetadataUri: 'https://example.com/fa.json' },
    limits: { automaticStopSol: 0.7, irreversibleMaximumSol: 0.8, recoverableRentLamports: '1', uploadBufferRentLamports: '1', programTombstoneLamports: '1', estimatedPeakFundingLamports: '3' },
  }));
  const [ata] = await findAssociatedTokenPda({ owner: address(SHARED), mint: address(MINT), tokenProgram: address(TOKEN) });
  let submissions = 0;
  const route: CheckedLiquidationRoute = {
    inputMint: MINT, outputMint: WSOL, amountIn: 25n, minimumOutputLamports: 10n,
    sourceTokenAccount: String(ata), destination: overrides.routeDestination ?? SHARED,
    routerProgram: JUPITER, signerAddresses: [SHARED], programAddresses: [JUPITER, TOKEN], opaqueRoute: {},
  };
  const runtime: LiquidationRuntime = {
    async inspectMint() { return { programOwner: TOKEN }; },
    async inspectTokenAccount() { return { programOwner: TOKEN, mint: overrides.tokenMint ?? MINT, owner: overrides.tokenOwner ?? SHARED, amount: 25n }; },
    async getCheckedJupiterRoute() { return overrides.route === false ? null : route; },
    async rehearsalBudget() { return { spentLamports: 790_000_000n, reservedLamports: 0n }; },
    async submitCheckedRoute() { submissions += 1; return { signature: 'sig', finalized: true, recipient: SHARED, recipientPreBalanceLamports: 1n, recipientPostBalanceLamports: 11n }; },
  };
  return { manifestPath, runtime, submissions: () => submissions };
}

test('rejects a source ATA with the wrong mint', async () => {
  const value = await fixture({ tokenMint: SHARED });
  await assert.rejects(() => liquidateDisposableFaretest({ manifestPath: value.manifestPath, slippageBps: 500 }, value.runtime), /wrong mint/);
});

test('rejects a source ATA with the wrong owner', async () => {
  const value = await fixture({ tokenOwner: MINT });
  await assert.rejects(() => liquidateDisposableFaretest({ manifestPath: value.manifestPath, slippageBps: 500 }, value.runtime), /wrong owner/);
});

test('rejects an unexpected native SOL destination', async () => {
  const value = await fixture({ routeDestination: MINT });
  await assert.rejects(() => liquidateDisposableFaretest({ manifestPath: value.manifestPath, slippageBps: 500 }, value.runtime), /unexpected native SOL destination/);
});

test('rejects unexpected route signers and programs', async () => {
  const signer = await fixture();
  const signerRoute = await signer.runtime.getCheckedJupiterRoute({} as never);
  signerRoute!.signerAddresses.push(MINT);
  await assert.rejects(() => liquidateDisposableFaretest({ manifestPath: signer.manifestPath, slippageBps: 500 }, signer.runtime), /unexpected signer/);

  const program = await fixture();
  const programRoute = await program.runtime.getCheckedJupiterRoute({} as never);
  programRoute!.programAddresses.push(MINT);
  await assert.rejects(() => liquidateDisposableFaretest({ manifestPath: program.manifestPath, slippageBps: 500 }, program.runtime), /unexpected program/);
});

test('rejects slippage above ten percent before asking Jupiter for a route', async () => {
  const value = await fixture();
  let routeRequests = 0;
  value.runtime.getCheckedJupiterRoute = async () => { routeRequests += 1; return null; };
  await assert.rejects(() => liquidateDisposableFaretest({ manifestPath: value.manifestPath, slippageBps: 1001 }, value.runtime), /between 0 and 1000/);
  assert.equal(routeRequests, 0);
});

test('no route is a dry-run no-op and never submits a transaction', async () => {
  const value = await fixture({ route: false });
  const result = await liquidateDisposableFaretest({ manifestPath: value.manifestPath, slippageBps: 1000 }, value.runtime);
  assert.equal(result.status, 'no-route');
  assert.equal(value.submissions(), 0);
});

test('default mode returns exact execute confirmation and never submits', async () => {
  const value = await fixture();
  const result = await liquidateDisposableFaretest({ manifestPath: value.manifestPath, slippageBps: 500 }, value.runtime);
  assert.equal(result.status, 'dry-run');
  assert.match(result.confirmation ?? '', /^LIQUIDATE-FARETEST:/);
  assert.equal(value.submissions(), 0);
});
