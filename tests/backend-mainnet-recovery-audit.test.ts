import assert from 'node:assert/strict';
import test from 'node:test';
import { address, getAddressEncoder, type Address } from '@solana/kit';
import {
  assertFinalCloseReady,
  decodeRecoveryRewardPool,
  discoverConfigurationTokenAccounts,
  type OwnedTokenAccount,
} from '../scripts/audit-mainnet-recovery.js';

const configuration = address('GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4');
const legacyFareMint = address('So11111111111111111111111111111111111111112');
const currentMint = address('2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF');
const legacyVault = address('56acKgFW1Tn9vzcsBysWiYNjQYBzTySdLfZzUk1NCctp');
const currentVault = address('4Z2mUq8Y3BYqg6f1a2WMbLsGGBYbXmRYXKf7q5R1ft2m');
const tokenProgram = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const token2022Program = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

test('discovers Configuration-owned accounts under both token programs, including a legacy FARE vault', async () => {
  const calls: unknown[][] = [];
  const rpc = async <T>(_url: string, method: string, params: unknown[]): Promise<T> => {
    assert.equal(method, 'getTokenAccountsByOwner');
    calls.push(params);
    const program = (params[1] as { programId: string }).programId;
    const value = program === String(tokenProgram)
      ? [rpcTokenAccount(legacyVault, tokenProgram, legacyFareMint, 17n)]
      : [rpcTokenAccount(currentVault, token2022Program, currentMint, 23n, 200)];
    return { value } as T;
  };

  const accounts = await discoverConfigurationTokenAccounts('https://rpc.invalid', configuration, rpc);

  assert.equal(calls.length, 2);
  assert.deepEqual(new Set(calls.map(params => (params[1] as { programId: string }).programId)), new Set([
    String(tokenProgram),
    String(token2022Program),
  ]));
  assert.deepEqual(accounts.map(account => [String(account.mint), account.amount]), [
    [String(currentMint), 23n],
    [String(legacyFareMint), 17n],
  ]);
});

test('decodes reward obligations and active-series state used by final-close gate', () => {
  const pool = rewardPoolBytes([1n, 2n, 3n, 4n, 5n], true);
  assert.deepEqual(decodeRecoveryRewardPool(pool), {
    obligations: [1n, 2n, 3n, 4n, 5n],
    seriesActive: true,
  });
});

test('final-close gate rejects obligations and active series in either reward pool', () => {
  const settled = { obligations: [0n, 0n, 0n, 0n, 0n], seriesActive: false };
  assert.throws(() => assertFinalCloseReady({
    feeVaultRecoverable: 0,
    tokenAccounts: [],
    mainPool: { ...settled, obligations: [0n, 7n, 0n, 0n, 0n] },
    traineePool: settled,
  }), /Main reward pool has outstanding obligations/);
  assert.throws(() => assertFinalCloseReady({
    feeVaultRecoverable: 0,
    tokenAccounts: [],
    mainPool: settled,
    traineePool: { ...settled, seriesActive: true },
  }), /Trainee reward pool has an active reward series/);
});

test('final-close gate rejects any discovered nonempty token account', () => {
  const settled = { obligations: [0n, 0n, 0n, 0n, 0n], seriesActive: false };
  const account: OwnedTokenAccount = { address: legacyVault, tokenProgram, mint: legacyFareMint, amount: 1n };
  assert.throws(() => assertFinalCloseReady({
    feeVaultRecoverable: 0,
    tokenAccounts: [account],
    mainPool: settled,
    traineePool: settled,
  }), new RegExp(`Configuration-owned token account ${legacyVault} is not empty`));
});

function rpcTokenAccount(pubkey: Address, owner: Address, mint: Address, amount: bigint, size = 165) {
  const data = new Uint8Array(size);
  data.set(getAddressEncoder().encode(mint), 0);
  data.set(getAddressEncoder().encode(configuration), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1;
  return { pubkey: String(pubkey), account: { owner: String(owner), data: [Buffer.from(data).toString('base64'), 'base64'] as [string, string] } };
}

function rewardPoolBytes(obligations: bigint[], seriesActive: boolean) {
  const data = new Uint8Array(298);
  const view = new DataView(data.buffer);
  const obligationsOffset = 8 + 8 + 8 + 16 * 5;
  obligations.forEach((amount, index) => view.setBigUint64(obligationsOffset + index * 8, amount, true));
  const seriesActiveOffset = obligationsOffset + 8 * 5 * 4 + 8 * 3 + 8;
  data[seriesActiveOffset] = Number(seriesActive);
  return data;
}
