import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { findAssociatedTokenPda } from '@solana-program/token';
import { address, createKeyPairSignerFromBytes, getAddressDecoder, type Address } from '@solana/kit';
import { protocolAddresses } from '../server/setup.js';
import { decodeWorkerConfiguration } from '../server/solanaState.js';
import { solanaRpcCall } from '../server/solanaRpc.js';

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const ZERO_ADDRESS = '11111111111111111111111111111111';
const TOKEN_PROGRAMS = [
  address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
] as const;
const WSOL_MINT = address('So11111111111111111111111111111111111111112');
const decoder = getAddressDecoder();

export interface RecoveryRewardPool {
  obligations: bigint[];
  seriesActive: boolean;
}

export interface OwnedTokenAccount {
  address: Address;
  tokenProgram: Address;
  mint: Address;
  amount: bigint;
}

interface RpcAccount {
  owner: string;
  executable: boolean;
  lamports: number;
  data: Uint8Array;
}

type RpcCaller = <T>(url: string, method: string, params: unknown[]) => Promise<T>;

async function main() {
  const rpcUrl = required('SOLANA_RPC_URL');
  const expected = {
    program: address(required('RECOVERY_PROGRAM_ID')),
    programData: address(required('RECOVERY_PROGRAMDATA_ADDRESS')),
    authority: address(required('RECOVERY_AUTHORITY_ADDRESS')),
    feePayer: address(required('RECOVERY_FEE_PAYER_ADDRESS')),
    recipient: address(required('RECOVERY_RECIPIENT_ADDRESS')),
    buffer: address(required('RECOVERY_BUFFER_ADDRESS')),
    worker: address(required('RECOVERY_WORKER_ADDRESS')),
    backend: address(required('RECOVERY_BACKEND_ADDRESS')),
  };

  await verifyKeypair('authority', required('RECOVERY_AUTHORITY_KEYPAIR_PATH'), expected.authority);
  await verifyKeypair('fee payer', required('RECOVERY_FEE_PAYER_KEYPAIR_PATH'), expected.feePayer);
  await verifyKeypair('buffer', required('RECOVERY_BUFFER_KEYPAIR_PATH'), expected.buffer);
  await verifyKeypair('worker', required('RECOVERY_WORKER_KEYPAIR_PATH'), expected.worker);
  await verifyKeypair('backend', required('RECOVERY_BACKEND_KEYPAIR_PATH'), expected.backend);

  const genesis = await solanaRpcCall<string>(rpcUrl, 'getGenesisHash', []);
  if (genesis !== MAINNET_GENESIS) throw new Error(`RPC is not mainnet-beta: ${genesis}`);

  const protocol = await protocolAddresses(expected.program);
  const requested = [
    expected.program,
    expected.programData,
    expected.buffer,
    expected.authority,
    expected.feePayer,
    expected.recipient,
    expected.worker,
    expected.backend,
    protocol.config,
    protocol.pool,
    protocol.traineePool,
    protocol.feeVault,
  ];
  const accounts = await getAccounts(rpcUrl, requested);
  const [program, programData, buffer, authority, feePayer, recipient, worker, backend, configurationAccount, mainPoolAccount, traineePoolAccount, feeVault] = accounts;
  if (!program || !programData) throw new Error('Program or ProgramData account is missing');
  if (program.owner !== UPGRADEABLE_LOADER || !program.executable) throw new Error('Program is not an executable loader-v3 account');
  if (readU32(program.data, 0) !== 2 || String(readAddress(program.data, 4)) !== String(expected.programData)) {
    throw new Error('Program does not point to the expected ProgramData account');
  }
  if (programData.owner !== UPGRADEABLE_LOADER || readU32(programData.data, 0) !== 3) throw new Error('Invalid ProgramData account');
  if (programData.data[12] !== 1 || String(readAddress(programData.data, 13)) !== String(expected.authority)) {
    throw new Error('Upgrade authority mismatch or authority was revoked');
  }
  if (buffer) {
    if (buffer.owner !== UPGRADEABLE_LOADER || readU32(buffer.data, 0) !== 1) throw new Error('Configured buffer exists but is not a loader-v3 buffer');
    if (buffer.data[4] !== 1 || String(readAddress(buffer.data, 5)) !== String(expected.authority)) throw new Error('Buffer authority mismatch');
  }
  if (!configurationAccount || !mainPoolAccount || !traineePoolAccount || !feeVault) {
    throw new Error('Configuration, reward pool, trainee reward pool, or FeeVault account is missing');
  }

  const configuration = decodeWorkerConfiguration(configurationAccount.data);
  const mainPool = decodeRecoveryRewardPool(mainPoolAccount.data);
  const traineePool = decodeRecoveryRewardPool(traineePoolAccount.data);
  const mints = [
    WSOL_MINT,
    ...(String(configuration.fareMint) === ZERO_ADDRESS ? [] : [configuration.fareMint]),
    ...configuration.stockMints,
  ];
  const mintAccounts = await getAccounts(rpcUrl, mints);
  if (mintAccounts.some(account => !account)) throw new Error('A configured reserve mint is missing');
  const configuredVaults = await Promise.all(mints.map((mint, index) => findAssociatedTokenPda({
    owner: protocol.config,
    mint,
    tokenProgram: address(mintAccounts[index]!.owner),
  }).then(([vault]) => String(vault))));
  const tokenAccounts = await discoverConfigurationTokenAccounts(rpcUrl, protocol.config);
  const discoveredAddresses = new Set(tokenAccounts.map(account => String(account.address)));
  if (configuredVaults.some(vault => !discoveredAddresses.has(vault))) throw new Error('A configured token vault is missing');
  const tokenAmounts = tokenAccounts.map(account => account.amount);
  const feeVaultRent = await solanaRpcCall<number>(rpcUrl, 'getMinimumBalanceForRentExemption', [feeVault.data.length, { commitment: 'finalized' }]);
  const feeVaultRecoverable = Math.max(0, feeVault.lamports - feeVaultRent);

  console.log(`MAINNET_GENESIS=${genesis}`);
  console.log(`PROGRAM_ID=${expected.program}`);
  console.log(`PROGRAMDATA_ADDRESS=${expected.programData}`);
  console.log(`UPGRADE_AUTHORITY=${expected.authority}`);
  console.log(`RECIPIENT=${expected.recipient}`);
  console.log(`PROGRAMDATA_RECOVERABLE_SOL=${sol(programData.lamports)}`);
  console.log(`PROGRAM_TOMBSTONE_SOL=${sol(program.lamports)}`);
  console.log(`BUFFER_STATUS=${buffer ? `open:${sol(buffer.lamports)} SOL` : 'closed'}`);
  console.log(`AUTHORITY_SOL=${sol(authority?.lamports || 0)}`);
  console.log(`FEE_PAYER_SOL=${sol(feePayer?.lamports || 0)}`);
  console.log(`RECIPIENT_SOL=${sol(recipient?.lamports || 0)}`);
  console.log(`WORKER_RECOVERABLE_SOL=${sol(worker?.lamports || 0)}`);
  console.log(`BACKEND_RECOVERABLE_SOL=${sol(backend?.lamports || 0)}`);
  console.log(`FEE_VAULT_RECOVERABLE_SOL=${sol(feeVaultRecoverable)}`);
  console.log(`MAIN_POOL_OBLIGATIONS=${mainPool.obligations.join(',')}`);
  console.log(`MAIN_POOL_SERIES_ACTIVE=${mainPool.seriesActive}`);
  console.log(`TRAINEE_POOL_OBLIGATIONS=${traineePool.obligations.join(',')}`);
  console.log(`TRAINEE_POOL_SERIES_ACTIVE=${traineePool.seriesActive}`);
  console.log(`TOKEN_ACCOUNT_COUNT=${tokenAccounts.length}`);
  for (const account of tokenAccounts) {
    console.log(`TOKEN_ACCOUNT=${account.address},PROGRAM=${account.tokenProgram},MINT=${account.mint},RAW_AMOUNT=${account.amount}`);
  }
  console.log(`TOKEN_VAULT_RAW_AMOUNTS=${tokenAmounts.join(',')}`);

  if (process.argv.includes('--require-paused') && configuration.pausedAt === 0n) throw new Error('Protocol is not paused');
  if (process.argv.includes('--require-empty-vaults')) {
    assertFinalCloseReady({ feeVaultRecoverable, tokenAccounts, mainPool, traineePool });
  }
  console.log('MAINNET_RECOVERY_DRY_RUN=PASS');
}

export async function discoverConfigurationTokenAccounts(
  rpcUrl: string,
  configuration: Address,
  rpcCall: RpcCaller = solanaRpcCall,
): Promise<OwnedTokenAccount[]> {
  const scans = await Promise.all(TOKEN_PROGRAMS.map(async tokenProgram => {
    const result = await rpcCall<{ value: Array<{ pubkey: string; account: { owner: string; data: [string, string] } }> }>(
      rpcUrl,
      'getTokenAccountsByOwner',
      [String(configuration), { programId: String(tokenProgram) }, { encoding: 'base64', commitment: 'finalized' }],
    );
    return result.value.map(item => decodeOwnedTokenAccount(item, tokenProgram, configuration));
  }));
  const accounts = scans.flat();
  const unique = new Set(accounts.map(account => String(account.address)));
  if (unique.size !== accounts.length) throw new Error('Duplicate token account returned by owner scans');
  return accounts.sort((left, right) => String(left.address).localeCompare(String(right.address)));
}

export function decodeRecoveryRewardPool(data: Uint8Array): RecoveryRewardPool {
  if (data.length < 297) throw new Error('Invalid reward pool account');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const obligationsOffset = 8 + 8 + 8 + 16 * 5;
  const obligations = Array.from({ length: 5 }, (_, index) => view.getBigUint64(obligationsOffset + index * 8, true));
  const seriesActiveOffset = obligationsOffset + 8 * 5 * 4 + 8 * 3 + 8;
  return { obligations, seriesActive: data[seriesActiveOffset] !== 0 };
}

export function assertFinalCloseReady(input: {
  feeVaultRecoverable: number;
  tokenAccounts: OwnedTokenAccount[];
  mainPool: RecoveryRewardPool;
  traineePool: RecoveryRewardPool;
}) {
  if (input.feeVaultRecoverable > 0) throw new Error('FeeVault contains recoverable SOL');
  const nonempty = input.tokenAccounts.find(account => account.amount > 0n);
  if (nonempty) throw new Error(`Configuration-owned token account ${nonempty.address} is not empty`);
  assertPoolSettled('Main reward pool', input.mainPool);
  assertPoolSettled('Trainee reward pool', input.traineePool);
}

function decodeOwnedTokenAccount(
  item: { pubkey: string; account: { owner: string; data: [string, string] } },
  tokenProgram: Address,
  configuration: Address,
): OwnedTokenAccount {
  if (item.account.owner !== String(tokenProgram)) throw new Error(`Token account ${item.pubkey} has an unexpected program owner`);
  const data = Uint8Array.from(Buffer.from(item.account.data[0], 'base64'));
  if (data.length < 165 || data[108] === 0) throw new Error(`Invalid token account ${item.pubkey}`);
  if (String(readAddress(data, 32)) !== String(configuration)) throw new Error(`Token account ${item.pubkey} is not owned by Configuration PDA`);
  return {
    address: address(item.pubkey),
    tokenProgram,
    mint: readAddress(data, 0),
    amount: new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true),
  };
}

function assertPoolSettled(label: string, pool: RecoveryRewardPool) {
  if (pool.seriesActive) throw new Error(`${label} has an active reward series`);
  if (pool.obligations.some(amount => amount > 0n)) throw new Error(`${label} has outstanding obligations`);
}

async function getAccounts(rpcUrl: string, addresses: Address[]): Promise<Array<RpcAccount | null>> {
  const result = await solanaRpcCall<{ value: Array<{ owner: string; executable: boolean; lamports: number; data: [string, string] } | null> }>(
    rpcUrl,
    'getMultipleAccounts',
    [addresses.map(String), { encoding: 'base64', commitment: 'finalized' }],
  );
  return result.value.map(account => account ? { ...account, data: Buffer.from(account.data[0], 'base64') } : null);
}

async function verifyKeypair(label: string, path: string, expectedAddress: Address) {
  const bytes = Uint8Array.from(JSON.parse(await readFile(path, 'utf8')) as number[]);
  const signer = await createKeyPairSignerFromBytes(bytes);
  if (String(signer.address) !== String(expectedAddress)) throw new Error(`${label} keypair does not match ${expectedAddress}`);
}

function readU32(data: Uint8Array, offset: number) {
  if (data.length < offset + 4) throw new Error('Invalid loader-v3 account data');
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function readAddress(data: Uint8Array, offset: number) {
  if (data.length < offset + 32) throw new Error('Invalid account data');
  return address(decoder.decode(data.subarray(offset, offset + 32)));
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set explicitly`);
  return value;
}

function sol(lamports: number) {
  return (lamports / 1_000_000_000).toFixed(9);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
