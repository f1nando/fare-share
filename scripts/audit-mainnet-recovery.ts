import { readFile } from 'node:fs/promises';
import { findAssociatedTokenPda } from '@solana-program/token';
import { address, createKeyPairSignerFromBytes, getAddressDecoder, type Address } from '@solana/kit';
import { protocolAddresses } from '../server/setup.js';
import { decodeWorkerConfiguration } from '../server/solanaState.js';
import { solanaRpcCall } from '../server/solanaRpc.js';

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const ZERO_ADDRESS = '11111111111111111111111111111111';
const WSOL_MINT = address('So11111111111111111111111111111111111111112');
const decoder = getAddressDecoder();

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
  protocol.feeVault,
];
const accounts = await getAccounts(requested);
const [program, programData, buffer, authority, feePayer, recipient, worker, backend, configurationAccount, feeVault] = accounts;
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
if (!configurationAccount || !feeVault) throw new Error('Configuration or FeeVault account is missing');

const configuration = decodeWorkerConfiguration(configurationAccount.data);
const mints = [
  WSOL_MINT,
  ...(String(configuration.fareMint) === ZERO_ADDRESS ? [] : [configuration.fareMint]),
  ...configuration.stockMints,
];
const mintAccounts = await getAccounts(mints);
if (mintAccounts.some(account => !account)) throw new Error('A configured reserve mint is missing');
const vaults = await Promise.all(mints.map((mint, index) => findAssociatedTokenPda({
  owner: protocol.config,
  mint,
  tokenProgram: address(mintAccounts[index]!.owner),
}).then(([vault]) => vault)));
const vaultAccounts = await getAccounts(vaults);
if (vaultAccounts.some(account => !account)) throw new Error('A configured token vault is missing');
const tokenAmounts = vaultAccounts.map(account => tokenAmount(account!.data));
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
console.log(`TOKEN_VAULT_RAW_AMOUNTS=${tokenAmounts.join(',')}`);

if (process.argv.includes('--require-paused') && configuration.pausedAt === 0n) throw new Error('Protocol is not paused');
if (process.argv.includes('--require-empty-vaults')) {
  if (feeVaultRecoverable > 0) throw new Error('FeeVault contains recoverable SOL');
  if (tokenAmounts.some(amount => amount > 0n)) throw new Error('A token vault is not empty');
}
console.log('MAINNET_RECOVERY_DRY_RUN=PASS');

interface RpcAccount {
  owner: string;
  executable: boolean;
  lamports: number;
  data: Uint8Array;
}

async function getAccounts(addresses: Address[]): Promise<Array<RpcAccount | null>> {
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
  if (data.length < offset + 32) throw new Error('Invalid loader-v3 account data');
  return decoder.decode(data.subarray(offset, offset + 32));
}

function tokenAmount(data: Uint8Array) {
  if (data.length < 165 || data[108] === 0) throw new Error('Invalid token vault account');
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set explicitly`);
  return value;
}

function sol(lamports: number) {
  return (lamports / 1_000_000_000).toFixed(9);
}
