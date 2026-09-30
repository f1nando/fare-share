import { createHash } from 'node:crypto';
import {
  AccountRole,
  address,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
  type AddressesByLookupTableAddress,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token';
import { solanaRpcCall } from './solanaRpc.js';
import { parseBackendSigner } from './signing.js';
import { sendInstructions } from './transaction.js';

const utf8 = getUtf8Encoder();
const addressEncoder = getAddressEncoder();
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const MPL_CORE_PROGRAM = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const WSOL_MINT = address('So11111111111111111111111111111111111111112');
export const CLASS_COUNT = 4;
export const VARIANTS_PER_CLASS = 4;
export const METADATA_URI_COUNT = CLASS_COUNT * VARIANTS_PER_CLASS;

export interface InitializeProtocolInput {
  rpcUrl: string;
  programId: Address;
  admin: KeyPairSigner;
  backendSignerSecret: string;
  teamAccount: Address;
  jupiterProgram: Address;
  deploymentId: Uint8Array;
  collectionName: string;
  collectionUri: string;
  stockMints: [Address, Address, Address, Address];
  mintPricesUsdCents: [bigint, bigint, bigint, bigint];
  metadataUris: readonly string[];
  traineeMetadataUri: string;
  lookupTables?: AddressesByLookupTableAddress;
}

export async function initializeProtocol(input: InitializeProtocolInput) {
  if (input.deploymentId.length !== 32) throw new Error('deploymentId must contain 32 bytes');
  assertMetadataUris(input.metadataUris);
  assertMetadataUri(input.traineeMetadataUri, 'traineeMetadataUri');
  const addresses = await protocolAddresses(input.programId);
  const existing = await getAccount(input.rpcUrl, addresses.config);
  let initializeSignature: string | undefined;
  let collection: Address | undefined;

  if (!existing) {
    const collectionSigner = await generateKeyPairSigner();
    collection = collectionSigner.address;
    const instruction = buildInitializeInstruction(input, addresses, collectionSigner.address);
    initializeSignature = String(await sendInstructions(
      input.rpcUrl,
      input.admin,
      [instruction],
      [collectionSigner],
      input.lookupTables || {},
    ));
  }

  const metadataSignatures: string[] = [];
  for (let classIndex = 0; classIndex < CLASS_COUNT; classIndex += 1) {
    const start = classIndex * VARIANTS_PER_CLASS;
    metadataSignatures.push(String(await sendInstructions(input.rpcUrl, input.admin, [
      buildSetMetadataUrisInstruction(
        input.programId,
        input.admin.address,
        addresses.config,
        classIndex,
        input.metadataUris.slice(start, start + VARIANTS_PER_CLASS),
      ),
    ])));
  }
  metadataSignatures.push(String(await sendInstructions(input.rpcUrl, input.admin, [
    buildSetTraineeMetadataUriInstruction(
      input.programId,
      input.admin.address,
      addresses.config,
      input.traineeMetadataUri,
    ),
  ])));

  const mints = [WSOL_MINT, ...input.stockMints];
  const mintAccounts = await Promise.all(mints.map(mint => getAccount(input.rpcUrl, mint)));
  if (mintAccounts.some(account => !account)) throw new Error('One or more configured token mints do not exist');
  const tokenPrograms = mintAccounts.map(account => address(account!.owner));
  const ataInstructions: Instruction[] = [];
  const vaults: Address[] = [];
  for (let index = 0; index < mints.length; index += 1) {
    const [ata] = await findAssociatedTokenPda({
      owner: addresses.config,
      mint: mints[index],
      tokenProgram: tokenPrograms[index],
    });
    vaults.push(ata);
    ataInstructions.push(getCreateAssociatedTokenIdempotentInstruction({
      payer: input.admin,
      ata,
      owner: addresses.config,
      mint: mints[index],
      tokenProgram: tokenPrograms[index],
    }));
  }
  const vaultSignature = String(await sendInstructions(input.rpcUrl, input.admin, ataInstructions));
  return { addresses, collection, vaults, initializeSignature, metadataSignatures, vaultSignature };
}

export function buildInitializeInstruction(
  input: InitializeProtocolInput,
  addresses: Awaited<ReturnType<typeof protocolAddresses>>,
  collection: Address,
): Instruction {
  const backendSigner = parseBackendSigner(input.backendSignerSecret).publicKey;
  const data = concat(
    anchorDiscriminator('initialize'),
    key(backendSigner),
    key(input.teamAccount),
    key(input.jupiterProgram),
    input.deploymentId,
    stringBytes(input.collectionName),
    stringBytes(input.collectionUri),
    ...input.stockMints.map(key),
    ...input.mintPricesUsdCents.map(u64),
  );
  return {
    programAddress: input.programId,
    accounts: [
      meta(input.admin.address, AccountRole.WRITABLE_SIGNER),
      meta(addresses.config, AccountRole.WRITABLE),
      meta(addresses.pool, AccountRole.WRITABLE),
      meta(addresses.traineePool, AccountRole.WRITABLE),
      meta(addresses.queue, AccountRole.WRITABLE),
      meta(addresses.traineeQueue, AccountRole.WRITABLE),
      meta(addresses.feeVault, AccountRole.WRITABLE),
      meta(collection, AccountRole.WRITABLE_SIGNER),
      meta(MPL_CORE_PROGRAM, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM, AccountRole.READONLY),
    ],
    data,
  };
}

export function buildSetMetadataUrisInstruction(
  programId: Address,
  admin: Address,
  config: Address,
  classIndex: number,
  metadataUris: readonly string[],
): Instruction {
  if (!Number.isInteger(classIndex) || classIndex < 0 || classIndex >= CLASS_COUNT) {
    throw new Error('classIndex must be an integer from 0 to 3');
  }
  if (metadataUris.length !== VARIANTS_PER_CLASS
    || metadataUris.some(uri => !uri || Buffer.byteLength(uri, 'utf8') > 200)
    || new Set(metadataUris).size !== VARIANTS_PER_CLASS) {
    throw new Error('metadataUris must contain exactly four distinct variant URIs of 1 to 200 UTF-8 bytes');
  }
  return {
    programAddress: programId,
    accounts: [
      meta(admin, AccountRole.READONLY_SIGNER),
      meta(config, AccountRole.WRITABLE),
    ],
    data: concat(
      anchorDiscriminator('set_metadata_uris'),
      Uint8Array.of(classIndex),
      ...metadataUris.map(stringBytes),
    ),
  };
}

export function assertMetadataUris(metadataUris: readonly string[]) {
  if (metadataUris.length !== METADATA_URI_COUNT) {
    throw new Error('metadataUris must contain exactly 16 values in class/variant order');
  }
  if (metadataUris.some(uri => !uri || Buffer.byteLength(uri, 'utf8') > 200)) {
    throw new Error('every metadata URI must contain 1 to 200 UTF-8 bytes');
  }
  if (new Set(metadataUris).size !== METADATA_URI_COUNT) {
    throw new Error('every class/variant metadata URI must be distinct');
  }
}

export function buildSetTraineeMetadataUriInstruction(
  programId: Address,
  admin: Address,
  config: Address,
  uri: string,
): Instruction {
  assertMetadataUri(uri, 'traineeMetadataUri');
  return {
    programAddress: programId,
    accounts: [
      meta(admin, AccountRole.READONLY_SIGNER),
      meta(config, AccountRole.WRITABLE),
    ],
    data: concat(anchorDiscriminator('set_trainee_metadata_uri'), stringBytes(uri)),
  };
}

function assertMetadataUri(uri: string, name: string) {
  if (!uri || Buffer.byteLength(uri, 'utf8') > 200) {
    throw new Error(`${name} must contain 1 to 200 UTF-8 bytes`);
  }
}

export async function protocolAddresses(programAddress: Address) {
  const derive = (...seeds: string[]) => getProgramDerivedAddress({
    programAddress,
    seeds: seeds.map(seed => utf8.encode(seed)),
  }).then(([result]) => result);
  const [config, pool, traineePool, queue, traineeQueue, feeVault] = await Promise.all([
    derive('config'), derive('pool', 'main'), derive('pool', 'trainee'),
    derive('queue', 'main'), derive('queue', 'trainee'), derive('fees'),
  ]);
  return { config, pool, traineePool, queue, traineeQueue, feeVault };
}

function anchorDiscriminator(name: string) {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
function key(value: Address) { return Uint8Array.from(addressEncoder.encode(value)); }
function u64(value: bigint) {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value, true);
  return result;
}
function stringBytes(value: string) {
  const bytes = Uint8Array.from(utf8.encode(value));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, bytes.length, true);
  return concat(length, bytes);
}
function concat(...parts: readonly Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function meta(value: Address, role: AccountRole) { return { address: value, role }; }

async function getAccount(rpcUrl: string, account: Address) {
  const result = await solanaRpcCall<{ value: { owner: string } | null }>(rpcUrl, 'getAccountInfo', [
    account,
    { commitment: 'finalized', encoding: 'base64' },
  ], { timeoutMs: 10_000 });
  return result.value;
}
