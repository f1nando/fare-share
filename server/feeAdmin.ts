import { createHash } from 'node:crypto';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
} from '@solana-program/token';
import {
  AccountRole,
  address,
  createKeyPairSignerFromBytes,
  getAddressDecoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
  type Instruction,
} from '@solana/kit';
import type { Collection } from 'mongodb';
import { buildSetFareMintInstruction } from './admin.js';
import type { AdminFeeActionDocument } from './database.js';
import { buildPumpAmmFeeCollection, buildPumpBondingFeeCollection, derivePumpBondingCurve, derivePumpFeeAddresses, PUMP_AMM_PROGRAM, PUMP_PROGRAM, TOKEN_PROGRAM } from './pump.js';
import { parseSecretBytes } from './signing.js';
import { solanaRpcCall } from './solanaRpc.js';
import { decodeWorkerConfiguration } from './solanaState.js';
import { protocolAddresses } from './setup.js';
import { sendInstructions } from './transaction.js';

export const FIXED_FEE_RECIPIENT = address('2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const PUMP_FEE_PROGRAM = address('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const ZERO_ADDRESS = '11111111111111111111111111111111';
const BONDING_CURVE_DISCRIMINATOR = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
const utf8 = getUtf8Encoder();
const addressDecoder = getAddressDecoder();

interface FeeAdminConfig {
  rpcUrl: string;
  programId: Address;
  adminSecret: string;
  feeRecipientSecret: string;
  cluster: 'mainnet-beta' | 'devnet';
  minimumWalletLamports?: bigint;
}

interface RpcAccount {
  owner: string;
  executable?: boolean;
  lamports: bigint;
  data: Uint8Array;
}

export class FeeAdminError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'FeeAdminError';
  }
}

export async function createFeeAdminService(config: FeeAdminConfig, actions: Collection<AdminFeeActionDocument>) {
  const admin = await createKeyPairSignerFromBytes(parseSecretBytes(config.adminSecret, 'ADMIN_KEYPAIR_SECRET_KEY'));
  const feeRecipient = await createKeyPairSignerFromBytes(parseSecretBytes(config.feeRecipientSecret, 'PUMP_FEE_RECIPIENT_SECRET_KEY'));
  if (String(feeRecipient.address) !== String(FIXED_FEE_RECIPIENT)) {
    throw new Error(`PUMP_FEE_RECIPIENT_SECRET_KEY must resolve to ${FIXED_FEE_RECIPIENT}`);
  }
  const addresses = await protocolAddresses(config.programId);
  const minimumWalletLamports = config.minimumWalletLamports ?? 10_000_000n;

  async function configuredMint() {
    const account = await getAccount(config.rpcUrl, addresses.config);
    return decodeWorkerConfiguration(account.data).fareMint;
  }

  async function inspectMint(rawMint: unknown) {
    if (typeof rawMint !== 'string') throw new FeeAdminError('CA is required.');
    let mint: Address;
    try { mint = address(rawMint.trim()); } catch { throw new FeeAdminError('CA is not a valid Solana address.'); }
    const bondingCurve = await derivePumpBondingCurve(mint);
    const [mintAccount, curveAccount, sharingConfig] = await Promise.all([
      getOptionalAccount(config.rpcUrl, mint),
      getOptionalAccount(config.rpcUrl, bondingCurve),
      derivePda(PUMP_FEE_PROGRAM, ['sharing-config', mint]).then(value => getOptionalAccount(config.rpcUrl, value)),
    ]);
    if (!mintAccount || ![String(TOKEN_PROGRAM), String(TOKEN_2022_PROGRAM)].includes(mintAccount.owner)) {
      throw new FeeAdminError('CA is not an initialized SPL mint.');
    }
    if (mintAccount.data.length < 82 || mintAccount.data[45] !== 1) throw new FeeAdminError('CA mint is not initialized.');
    if (!curveAccount || curveAccount.owner !== String(PUMP_PROGRAM)) throw new FeeAdminError('Pump bonding curve was not found for this CA.');
    const curve = decodePumpBondingCurve(curveAccount.data);
    if (String(curve.creator) !== String(FIXED_FEE_RECIPIENT)) throw new FeeAdminError(`Creator must be ${FIXED_FEE_RECIPIENT}.`);
    if (curve.cashback) throw new FeeAdminError('Cashback tokens cannot be used as FARE.');
    if (String(curve.quoteMint) !== ZERO_ADDRESS) throw new FeeAdminError('FARE must use the SOL quote.');
    if (sharingConfig) throw new FeeAdminError('Pump fee sharing is enabled for this CA.');
    if (curve.complete) throw new FeeAdminError('CA must be fixed before pump.fun graduation.');
    const current = await configuredMint();
    if (String(current) !== ZERO_ADDRESS && String(current) !== String(mint)) throw new FeeAdminError(`Another CA is already fixed: ${current}.`, 409);
    return { mint, bondingCurve, tokenProgram: address(mintAccount.owner), creator: curve.creator, complete: curve.complete };
  }

  async function feeSnapshot(mint?: Address) {
    const pump = await derivePumpFeeAddresses(FIXED_FEE_RECIPIENT);
    const [bonding, amm, claimedWsol, walletBalance] = await Promise.all([
      getOptionalAccount(config.rpcUrl, pump.bondingCreatorVault),
      getOptionalAccount(config.rpcUrl, pump.ammCreatorVaultWsolAta),
      getOptionalAccount(config.rpcUrl, pump.creatorWsolAta),
      getBalance(config.rpcUrl, FIXED_FEE_RECIPIENT),
    ]);
    const bondingLamports = bonding ? availableLamports(bonding, await rent(config.rpcUrl, bonding.data.length)) : 0n;
    const ammLamports = amm ? tokenAmount(amm.data) : 0n;
    const pendingUnwrapLamports = claimedWsol ? tokenAmount(claimedWsol.data) : 0n;
    return {
      mint: mint ? String(mint) : null,
      feeRecipient: String(FIXED_FEE_RECIPIENT),
      bondingLamports: bondingLamports.toString(),
      ammLamports: ammLamports.toString(),
      pendingUnwrapLamports: pendingUnwrapLamports.toString(),
      availableLamports: (bondingLamports + ammLamports).toString(),
      walletLamports: walletBalance.toString(),
    };
  }

  return {
    inspectMint,
    async status() {
      const current = await configuredMint();
      const mint = String(current) === ZERO_ADDRESS ? undefined : current;
      const [fees, history] = await Promise.all([
        feeSnapshot(mint),
        actions.find({}, { sort: { createdAt: -1 }, limit: 20 }).toArray(),
      ]);
      const lastClaim = history.find(item => item.kind === 'claim');
      return { ...fees, lastClaimLamports: lastClaim?.amountLamports || '0', history: history.map(publicAction) };
    },
    async bindMint(rawMint: unknown) {
      const inspected = await inspectMint(rawMint);
      const [fareVault] = await findAssociatedTokenPda({ owner: addresses.config, mint: inspected.mint, tokenProgram: inspected.tokenProgram });
      const instructions: Instruction[] = [
        getCreateAssociatedTokenIdempotentInstruction({ payer: admin, ata: fareVault, owner: addresses.config, mint: inspected.mint, tokenProgram: inspected.tokenProgram }),
        buildSetFareMintInstruction({
          programId: config.programId,
          admin: admin.address,
          feeRecipient: feeRecipient.address,
          config: addresses.config,
          fareMint: inspected.mint,
          fareVault,
          bondingCurve: inspected.bondingCurve,
          tokenProgram: inspected.tokenProgram,
        }),
      ];
      const additional = String(admin.address) === String(feeRecipient.address) ? [] : [feeRecipient];
      const signature = String(await sendInstructions(config.rpcUrl, admin, instructions, additional));
      await actions.insertOne({ kind: 'bind_mint', mint: String(inspected.mint), amountLamports: '0', signature, cluster: config.cluster, createdAt: new Date() });
      return { signature, mint: String(inspected.mint) };
    },
    async claim() {
      const mint = await requireConfiguredMint();
      const before = await feeSnapshot(mint);
      const bondingLamports = BigInt(before.bondingLamports);
      const ammLamports = BigInt(before.ammLamports);
      const pendingUnwrap = BigInt(before.pendingUnwrapLamports);
      if (bondingLamports + ammLamports + pendingUnwrap === 0n) throw new FeeAdminError('There are no creator fees to claim.', 409);
      const pump = await derivePumpFeeAddresses(FIXED_FEE_RECIPIENT);
      const instructions: Instruction[] = [];
      if (bondingLamports > 0n) instructions.push(buildPumpBondingFeeCollection(FIXED_FEE_RECIPIENT, pump));
      if (ammLamports > 0n) {
        instructions.push(getCreateAssociatedTokenIdempotentInstruction({ payer: feeRecipient, ata: pump.creatorWsolAta, owner: feeRecipient.address, mint: address('So11111111111111111111111111111111111111112'), tokenProgram: TOKEN_PROGRAM }));
        instructions.push(buildPumpAmmFeeCollection(FIXED_FEE_RECIPIENT, pump));
      }
      if (ammLamports + pendingUnwrap > 0n) {
        instructions.push(getCloseAccountInstruction({ account: pump.creatorWsolAta, destination: feeRecipient.address, owner: feeRecipient }));
      }
      const signature = String(await sendInstructions(config.rpcUrl, feeRecipient, instructions));
      const walletAfter = await getBalance(config.rpcUrl, FIXED_FEE_RECIPIENT);
      const amount = bondingLamports + ammLamports + pendingUnwrap;
      await actions.insertOne({
        kind: 'claim', mint: String(mint), amountLamports: amount.toString(), signature, cluster: config.cluster,
        bondingLamports: bondingLamports.toString(), ammLamports: ammLamports.toString(),
        walletBalanceBefore: before.walletLamports, walletBalanceAfter: walletAfter.toString(), createdAt: new Date(),
      });
      return { signature, amountLamports: amount.toString() };
    },
    async deposit(rawAmount: unknown) {
      const mint = await requireConfiguredMint();
      if (typeof rawAmount !== 'string' || !/^[1-9]\d*$/.test(rawAmount)) throw new FeeAdminError('Amount must be a positive raw lamport string.');
      const amount = BigInt(rawAmount);
      const balanceBefore = await getBalance(config.rpcUrl, FIXED_FEE_RECIPIENT);
      if (balanceBefore < amount + minimumWalletLamports) throw new FeeAdminError('Amount leaves too little SOL for network fees.', 409);
      const configuration = decodeWorkerConfiguration((await getAccount(config.rpcUrl, addresses.config)).data);
      const instructions: Instruction[] = [
        getTransferSolInstruction({ source: feeRecipient, destination: addresses.feeVault, amount }),
        collectFeesInstruction(config.programId, feeRecipient.address, addresses.config, addresses.feeVault, configuration.teamAccount),
      ];
      const signature = String(await sendInstructions(config.rpcUrl, feeRecipient, instructions));
      const balanceAfter = await getBalance(config.rpcUrl, FIXED_FEE_RECIPIENT);
      await actions.insertOne({
        kind: 'deposit', mint: String(mint), amountLamports: amount.toString(), signature, cluster: config.cluster,
        walletBalanceBefore: balanceBefore.toString(), walletBalanceAfter: balanceAfter.toString(), createdAt: new Date(),
      });
      return { signature, amountLamports: amount.toString() };
    },
  };

  async function requireConfiguredMint() {
    const mint = await configuredMint();
    if (String(mint) === ZERO_ADDRESS) throw new FeeAdminError('FARE CA has not been fixed.', 409);
    return mint;
  }
}

export function decodePumpBondingCurve(data: Uint8Array) {
  if (data.length < 83 || !Buffer.from(data.subarray(0, 8)).equals(BONDING_CURVE_DISCRIMINATOR)) throw new FeeAdminError('Invalid Pump bonding curve account.');
  return {
    complete: data[48] !== 0,
    creator: addressDecoder.decode(data.subarray(49, 81)),
    cashback: data[82] !== 0,
    quoteMint: data.length >= 115 ? addressDecoder.decode(data.subarray(83, 115)) : address(ZERO_ADDRESS),
  };
}

export function tokenAmount(data: Uint8Array) {
  if (data.length < 165 || data[108] === 0) throw new FeeAdminError('Invalid token account.');
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
}

function collectFeesInstruction(programId: Address, caller: Address, config: Address, feeVault: Address, teamAccount: Address): Instruction {
  return {
    programAddress: programId,
    accounts: [
      { address: caller, role: AccountRole.READONLY_SIGNER },
      { address: config, role: AccountRole.READONLY },
      { address: feeVault, role: AccountRole.WRITABLE },
      { address: teamAccount, role: AccountRole.WRITABLE },
    ],
    data: createHash('sha256').update('global:collect_fees').digest().subarray(0, 8),
  };
}

async function derivePda(programAddress: Address, seeds: [string, Address]) {
  return (await getProgramDerivedAddress({ programAddress, seeds: [utf8.encode(seeds[0]), addressBytes(seeds[1])] }))[0];
}

function addressBytes(value: Address) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  const result = new Uint8Array(32);
  for (let index = 31; index >= 0; index -= 1) { result[index] = Number(number & 255n); number >>= 8n; }
  return result;
}

async function getBalance(rpcUrl: string, account: Address) {
  const result = await solanaRpcCall<{ value: number }>(rpcUrl, 'getBalance', [account, { commitment: 'finalized' }]);
  return BigInt(result.value);
}

async function rent(rpcUrl: string, size: number) {
  return BigInt(await solanaRpcCall<number>(rpcUrl, 'getMinimumBalanceForRentExemption', [size, { commitment: 'finalized' }]));
}

function availableLamports(account: RpcAccount, rentFloor: bigint) {
  return account.lamports > rentFloor ? account.lamports - rentFloor : 0n;
}

async function getAccount(rpcUrl: string, account: Address) {
  const value = await getOptionalAccount(rpcUrl, account);
  if (!value) throw new FeeAdminError(`Required account ${account} does not exist.`, 409);
  return value;
}

async function getOptionalAccount(rpcUrl: string, account: Address): Promise<RpcAccount | null> {
  const result = await solanaRpcCall<{ value: { owner: string; executable?: boolean; lamports: number; data: [string, string] } | null }>(rpcUrl, 'getAccountInfo', [account, { commitment: 'finalized', encoding: 'base64' }]);
  if (!result.value) return null;
  return { owner: result.value.owner, executable: result.value.executable, lamports: BigInt(result.value.lamports), data: Uint8Array.from(Buffer.from(result.value.data[0], 'base64')) };
}

function publicAction(action: AdminFeeActionDocument) {
  return {
    kind: action.kind, mint: action.mint, amountLamports: action.amountLamports, signature: action.signature,
    cluster: action.cluster, bondingLamports: action.bondingLamports, ammLamports: action.ammLamports, createdAt: action.createdAt,
  };
}
