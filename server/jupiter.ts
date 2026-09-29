import { createHash } from 'node:crypto';
import {
  AccountRole,
  address,
  getAddressEncoder,
  type Address,
  type AddressesByLookupTableAddress,
  type Instruction,
} from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';
import type { BackendSigner } from './signing.js';
import { jupiterRequest } from './jupiterHttp.js';

const SWAP_DOMAIN = Uint8Array.from(Buffer.from('TAXI_SWAP_V1'));
const ED25519_PROGRAM = address('Ed25519SigVerify111111111111111111111111111');
const COMPUTE_BUDGET_PROGRAM = address('ComputeBudget111111111111111111111111111111');
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);
const addressEncoder = getAddressEncoder();

export interface SwapPlan {
  kind: number;
  assetIndex: number;
  nonce: bigint;
  amountIn: bigint;
  minOut: bigint;
  deadline: bigint;
  routeHash: Uint8Array;
}

interface ApiAccount {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

interface ApiInstruction {
  programId: string;
  accounts: ApiAccount[];
  data: string;
}

interface BuildResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapInstruction: ApiInstruction;
  setupInstructions?: ApiInstruction[];
  cleanupInstruction?: ApiInstruction | null;
  otherInstructions?: ApiInstruction[];
  tipInstruction?: ApiInstruction | null;
  addressesByLookupTableAddress?: Record<string, string[]> | null;
  error?: string;
}

export interface BuildJupiterSwapInput {
  apiBaseUrl?: string;
  apiKey?: string;
  inputMint: Address;
  outputMint: Address;
  amountIn: bigint;
  taker: Address;
  payer: Address;
  destinationTokenAccount: Address;
  jupiterProgram: Address;
  slippageBps: number;
  maxAccounts: number;
  fixedWritableAccounts: ReadonlySet<string>;
  fetchImplementation?: typeof fetch;
}

export interface JupiterRoute {
  setupInstructions: Instruction[];
  routeData: Uint8Array;
  routeAccounts: NonNullable<Instruction['accounts']>;
  minOut: bigint;
  lookupTables: AddressesByLookupTableAddress;
}

export async function buildJupiterRoute(input: BuildJupiterSwapInput): Promise<JupiterRoute> {
  const query = new URLSearchParams({
    inputMint: String(input.inputMint),
    outputMint: String(input.outputMint),
    amount: input.amountIn.toString(),
    taker: String(input.taker),
    payer: String(input.payer),
    destinationTokenAccount: String(input.destinationTokenAccount),
    slippageBps: String(input.slippageBps),
    maxAccounts: String(input.maxAccounts),
    wrapAndUnwrapSol: 'false',
    restrictIntermediateTokens: 'true',
  });
  const headers: Record<string, string> = { accept: 'application/json' };
  if (input.apiKey) headers['x-api-key'] = input.apiKey;
  const response = await jupiterRequest(`${input.apiBaseUrl || 'https://api.jup.ag/swap/v2'}/build?${query}`, {
    headers,
  }, {
    fetchImplementation: input.fetchImplementation,
    operation: '/build',
  });
  const build = await response.json() as BuildResponse;
  if (build.error) throw new Error(`Jupiter /build failed: ${build.error}`);
  await validateBuildResponse(build, input);

  const routeData = Uint8Array.from(Buffer.from(build.swapInstruction.data, 'base64'));
  if (routeData.length === 0) throw new Error('Jupiter returned empty swap instruction data');
  const writable = new Set(input.fixedWritableAccounts);
  for (const account of build.swapInstruction.accounts) {
    if (account.isWritable) writable.add(account.pubkey);
  }
  const routeAccounts = build.swapInstruction.accounts.map(accountMeta => {
    const accountAddress = address(accountMeta.pubkey);
    if (accountMeta.isSigner && accountAddress !== input.taker && accountAddress !== input.payer) {
      throw new Error(`Jupiter route requires unsupported signer ${accountAddress}`);
    }
    return {
      address: accountAddress,
      role: writable.has(accountMeta.pubkey) ? AccountRole.WRITABLE : AccountRole.READONLY,
    };
  });
  if (!build.swapInstruction.accounts.some(accountMeta => accountMeta.pubkey === input.taker && accountMeta.isSigner)) {
    throw new Error('Jupiter route does not use the configuration PDA as swap authority');
  }
  const lookupTables: AddressesByLookupTableAddress = Object.fromEntries(
    Object.entries(build.addressesByLookupTableAddress || {}).map(([key, values]) => [
      address(key), values.map(value => address(value)),
    ]),
  );
  return {
    setupInstructions: (build.setupInstructions || []).map(apiInstruction),
    routeData,
    routeAccounts,
    minOut: BigInt(build.otherAmountThreshold),
    lookupTables,
  };
}

export function buildSwapPlanMessage(
  programId: Address,
  deploymentId: Uint8Array,
  plan: SwapPlan,
): Uint8Array {
  if (deploymentId.length !== 32 || plan.routeHash.length !== 32) throw new Error('Invalid swap plan byte length');
  return concat(
    SWAP_DOMAIN,
    key(programId),
    deploymentId,
    Uint8Array.of(plan.kind, plan.assetIndex),
    u64(plan.nonce),
    u64(plan.amountIn),
    u64(plan.minOut),
    i64(plan.deadline),
    plan.routeHash,
  );
}

export function hashJupiterRoute(
  routeData: Uint8Array,
  routeAccounts: NonNullable<Instruction['accounts']>,
  config: Address,
): Uint8Array {
  const parts = [routeData];
  for (const account of routeAccounts) {
    parts.push(key(account.address));
    parts.push(Uint8Array.of(
      account.role === AccountRole.WRITABLE || account.role === AccountRole.WRITABLE_SIGNER ? 1 : 0,
      account.address === config ? 1 : 0,
    ));
  }
  return Uint8Array.from(createHash('sha256').update(Buffer.concat(parts.map(part => Buffer.from(part)))).digest());
}

export function buildEd25519Instruction(signer: BackendSigner, message: Uint8Array): Instruction {
  const signature = signer.sign(message);
  const publicKey = key(signer.publicKey);
  if (signature.length !== 64 || message.length > 65_535) throw new Error('Invalid Ed25519 swap signature');
  const publicKeyOffset = 16;
  const signatureOffset = publicKeyOffset + 32;
  const messageOffset = signatureOffset + 64;
  return {
    programAddress: ED25519_PROGRAM,
    accounts: [],
    data: concat(
      Uint8Array.of(1, 0),
      u16(signatureOffset), u16(65_535),
      u16(publicKeyOffset), u16(65_535),
      u16(messageOffset), u16(message.length), u16(65_535),
      publicKey,
      signature,
      message,
    ),
  };
}

export function encodeProcessSwapData(discriminator: Uint8Array, plan: SwapPlan, routeData: Uint8Array) {
  return concat(
    discriminator,
    Uint8Array.of(plan.kind, plan.assetIndex),
    u64(plan.nonce),
    u64(plan.amountIn),
    u64(plan.minOut),
    i64(plan.deadline),
    plan.routeHash,
    u32(routeData.length),
    routeData,
  );
}

export function computeUnitLimitInstruction(units = 1_400_000): Instruction {
  return {
    programAddress: COMPUTE_BUDGET_PROGRAM,
    accounts: [],
    data: concat(Uint8Array.of(2), u32(units)),
  };
}

async function validateBuildResponse(build: BuildResponse, input: BuildJupiterSwapInput) {
  if (build.inputMint !== input.inputMint || build.outputMint !== input.outputMint) {
    throw new Error('Jupiter returned a route for different mints');
  }
  if (BigInt(build.inAmount) !== input.amountIn) throw new Error('Jupiter changed exact input amount');
  if (BigInt(build.outAmount) <= 0n || BigInt(build.otherAmountThreshold) <= 0n) {
    throw new Error('Jupiter returned an empty output');
  }
  if (!build.swapInstruction || build.swapInstruction.programId !== input.jupiterProgram) {
    throw new Error('Jupiter returned an unexpected router program');
  }
  const setupSafety = await Promise.all((build.setupInstructions || []).map(instruction => isSafeIdempotentAtaSetup(instruction, input)));
  const unsafeSetup = setupSafety.some(safe => !safe);
  const extra = (build.otherInstructions?.length || 0)
    + Number(Boolean(build.cleanupInstruction))
    + Number(Boolean(build.tipInstruction));
  if (unsafeSetup || extra !== 0) {
    throw new Error('Jupiter route requires setup, cleanup, or auxiliary instructions; pre-created vault route required');
  }
}

async function isSafeIdempotentAtaSetup(instruction: ApiInstruction, input: BuildJupiterSwapInput) {
  const accounts = instruction.accounts;
  const data = Buffer.from(instruction.data, 'base64');
  if (instruction.programId !== ASSOCIATED_TOKEN_PROGRAM || data.length !== 1 || data[0] !== 1 || accounts.length !== 6) return false;
  const [payer, ata, owner, mint, systemProgram, tokenProgram] = accounts;
  const ownerIsAllowed = owner.pubkey === String(input.taker)
    || (ata.pubkey === String(input.destinationTokenAccount) && mint.pubkey === String(input.outputMint));
  if (!(payer.pubkey === String(input.payer) && payer.isSigner && payer.isWritable
    && !ata.isSigner && ata.isWritable
    && ownerIsAllowed && !owner.isSigner && !owner.isWritable
    && !mint.isSigner && !mint.isWritable
    && systemProgram.pubkey === SYSTEM_PROGRAM && !systemProgram.isSigner && !systemProgram.isWritable
    && TOKEN_PROGRAMS.has(tokenProgram.pubkey) && !tokenProgram.isSigner && !tokenProgram.isWritable)) return false;
  const [expectedAta] = await findAssociatedTokenPda({
    owner: input.taker,
    mint: address(mint.pubkey),
    tokenProgram: address(tokenProgram.pubkey),
  });
  return String(expectedAta) === ata.pubkey;
}

function apiInstruction(instruction: ApiInstruction): Instruction {
  return {
    programAddress: address(instruction.programId),
    accounts: instruction.accounts.map(account => ({
      address: address(account.pubkey),
      role: account.isSigner
        ? (account.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER)
        : (account.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY),
    })),
    data: Uint8Array.from(Buffer.from(instruction.data, 'base64')),
  };
}

function key(value: Address) { return Uint8Array.from(addressEncoder.encode(value)); }
function u16(value: number) {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value, true);
  return result;
}
function u32(value: number) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}
function u64(value: bigint) {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value, true);
  return result;
}
function i64(value: bigint) {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigInt64(0, value, true);
  return result;
}
function concat(...parts: readonly Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
