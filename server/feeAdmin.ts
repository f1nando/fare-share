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
import { buildRescueSolInstruction, buildRescueTokenInstruction, buildSetFareMintInstruction, buildSimpleAdminInstruction } from './admin.js';
import type { AdminFeeActionDocument, AdminFeeOperationDocument, WorkerStatusDocument } from './database.js';
import { buildPumpAmmFeeCollection, buildPumpBondingFeeCollection, buildPumpSharedAmmFeeTransfer, buildPumpSharedFeeDistribution, derivePumpBondingCurve, derivePumpFeeAddresses, derivePumpFeeSharingConfig, PUMP_AMM_PROGRAM, PUMP_FEE_PROGRAM, PUMP_PROGRAM, TOKEN_PROGRAM, WSOL_MINT } from './pump.js';
import { parseSecretBytes } from './signing.js';
import { solanaRpcCall } from './solanaRpc.js';
import { decodeWorkerConfiguration } from './solanaState.js';
import { protocolAddresses } from './setup.js';
import { loadProtocolDashboard } from './protocolDashboard.js';
import { finalizedTransactionOutcome, sendInstructions, UnresolvedSolanaTransactionError } from './transaction.js';
import { normalizeTicker, savePrimaryTokenConfig, type TokenConfigDocument } from './tokenConfig.js';

export const FIXED_FEE_RECIPIENT = address('2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
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
  workerIntervalMs: number;
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

export async function createFeeAdminService(
  config: FeeAdminConfig,
  actions: Collection<AdminFeeActionDocument>,
  operations: Collection<AdminFeeOperationDocument>,
  tokenConfig: Collection<TokenConfigDocument>,
  workerStatus: Collection<WorkerStatusDocument>,
) {
  const admin = await createKeyPairSignerFromBytes(parseSecretBytes(config.adminSecret, 'ADMIN_KEYPAIR_SECRET_KEY'));
  const feeRecipient = await createKeyPairSignerFromBytes(parseSecretBytes(config.feeRecipientSecret, 'PUMP_FEE_RECIPIENT_SECRET_KEY'));
  if (String(feeRecipient.address) !== String(FIXED_FEE_RECIPIENT)) {
    throw new Error(`PUMP_FEE_RECIPIENT_SECRET_KEY must resolve to ${FIXED_FEE_RECIPIENT}`);
  }
  const addresses = await protocolAddresses(config.programId);
  const minimumWalletLamports = config.minimumWalletLamports ?? 100_000_000n;

  async function configuredMint() {
    return (await configuredState()).fareMint;
  }

  async function configuredState() {
    const account = await getAccount(config.rpcUrl, addresses.config);
    return decodeWorkerConfiguration(account.data);
  }

  async function inspectMint(rawMint: unknown) {
    if (typeof rawMint !== 'string') throw new FeeAdminError('CA is required.');
    let mint: Address;
    try { mint = address(rawMint.trim()); } catch { throw new FeeAdminError('CA is not a valid Solana address.'); }
    const bondingCurve = await derivePumpBondingCurve(mint);
    const [mintAccount, curveAccount, sharingConfig] = await Promise.all([
      getOptionalAccount(config.rpcUrl, mint),
      getOptionalAccount(config.rpcUrl, bondingCurve),
      derivePumpFeeSharingConfig(mint).then(value => getOptionalAccount(config.rpcUrl, value)),
    ]);
    if (!mintAccount || ![String(TOKEN_PROGRAM), String(TOKEN_2022_PROGRAM)].includes(mintAccount.owner)) {
      throw new FeeAdminError('CA is not an initialized SPL mint.');
    }
    if (mintAccount.data.length < 82 || mintAccount.data[45] !== 1) throw new FeeAdminError('CA mint is not initialized.');
    if (!curveAccount || curveAccount.owner !== String(PUMP_PROGRAM)) throw new FeeAdminError('Pump bonding curve was not found for this CA.');
    const curve = decodePumpBondingCurve(curveAccount.data);
    let feeMode: 'direct' | 'sharing' = 'direct';
    if (sharingConfig) {
      validateFixedFeeSharing(sharingConfig, mint);
      if (String(curve.creator) !== String(await derivePumpFeeSharingConfig(mint))) throw new FeeAdminError('Pump creator does not point to the canonical fee sharing config.');
      feeMode = 'sharing';
    } else if (String(curve.creator) !== String(FIXED_FEE_RECIPIENT)) {
      throw new FeeAdminError(`Creator must be ${FIXED_FEE_RECIPIENT} or an immutable 100% fee sharing config for that wallet.`);
    }
    if (curve.mayhem) throw new FeeAdminError('Mayhem Mode tokens cannot be used as FARE.');
    if (curve.cashback) throw new FeeAdminError('Cashback tokens cannot be used as FARE.');
    if (curve.holderRewards) throw new FeeAdminError('Holder Rewards tokens cannot be used as FARE.');
    if (curve.creatorFeeBps !== 0n || curve.canEditCreatorFee) throw new FeeAdminError('Custom editable creator fees cannot be used as FARE.');
    if (String(curve.quoteMint) !== ZERO_ADDRESS) throw new FeeAdminError('FARE must use the SOL quote.');
    if (curve.complete) throw new FeeAdminError('CA must be fixed before pump.fun graduation.');
    return { mint, bondingCurve, tokenProgram: address(mintAccount.owner), decimals: mintAccount.data[44], creator: curve.creator, complete: curve.complete, feeMode };
  }

  async function feeSnapshot(mint?: Address) {
    const route = await feeRoute(mint);
    const pump = await derivePumpFeeAddresses(route.creator);
    const [bonding, amm, claimedWsol, walletBalance] = await Promise.all([
      getOptionalAccount(config.rpcUrl, pump.bondingCreatorVault),
      getOptionalAccount(config.rpcUrl, pump.ammCreatorVaultWsolAta),
      route.mode === 'direct' ? getOptionalAccount(config.rpcUrl, pump.creatorWsolAta) : Promise.resolve(null),
      getBalance(config.rpcUrl, FIXED_FEE_RECIPIENT),
    ]);
    const bondingLamports = bonding ? availableLamports(bonding, await rent(config.rpcUrl, bonding.data.length)) : 0n;
    const ammLamports = amm ? tokenAmount(amm.data) : 0n;
    const pendingUnwrapLamports = claimedWsol ? tokenAmount(claimedWsol.data) : 0n;
    return {
      mint: mint ? String(mint) : null,
      feeMode: route.mode,
      feeRecipient: String(FIXED_FEE_RECIPIENT),
      bondingLamports: bondingLamports.toString(),
      ammLamports: ammLamports.toString(),
      pendingUnwrapLamports: pendingUnwrapLamports.toString(),
      availableLamports: (bondingLamports + ammLamports).toString(),
      walletLamports: walletBalance.toString(),
    };
  }

  async function feeRoute(mint?: Address) {
    if (!mint) return { mode: 'direct' as const, creator: FIXED_FEE_RECIPIENT, bondingCurve: null, sharingConfig: null };
    const bondingCurve = await derivePumpBondingCurve(mint);
    const sharingConfigAddress = await derivePumpFeeSharingConfig(mint);
    const [curveAccount, sharingConfig] = await Promise.all([
      getAccount(config.rpcUrl, bondingCurve),
      getOptionalAccount(config.rpcUrl, sharingConfigAddress),
    ]);
    const curve = decodePumpBondingCurve(curveAccount.data);
    if (!sharingConfig) {
      if (String(curve.creator) !== String(FIXED_FEE_RECIPIENT)) throw new FeeAdminError('Configured token no longer pays creator fees to the fixed recipient.', 409);
      return { mode: 'direct' as const, creator: FIXED_FEE_RECIPIENT, bondingCurve, sharingConfig: null };
    }
    validateFixedFeeSharing(sharingConfig, mint);
    if (String(curve.creator) !== String(sharingConfigAddress)) throw new FeeAdminError('Configured token does not route creator fees through its canonical sharing config.', 409);
    return { mode: 'sharing' as const, creator: sharingConfigAddress, bondingCurve, sharingConfig: sharingConfigAddress };
  }

  async function reconcileActiveOperation() {
    const active = await operations.findOne({ lock: 'creator-fee-write' });
    if (!active) return null;
    if (active.status === 'submitted') {
      try {
        return await reconcileSubmittedOperation(active);
      } catch (error) {
        if (error instanceof FeeAdminError && error.status === 409) return active;
        throw error;
      }
    }
    if (active.status === 'executing' && Date.now() - active.updatedAt.getTime() >= 120_000) {
      await operations.updateOne(
        { operationId: active.operationId, status: 'executing', updatedAt: active.updatedAt },
        { $set: { status: 'failed', error: 'Unsigned operation expired after backend interruption.', updatedAt: new Date() }, $unset: { lock: '' } },
      );
      return null;
    }
    return active;
  }

  async function acquireOperation(rawOperationId: unknown, kind: 'claim' | 'deposit', mint: Address, amountLamports = '0') {
    const operationId = normalizeOperationId(rawOperationId);
    const now = new Date();
    const operation: AdminFeeOperationDocument = {
      operationId,
      lock: 'creator-fee-write',
      kind,
      mint: String(mint),
      amountLamports,
      status: 'executing',
      createdAt: now,
      updatedAt: now,
    };
    try {
      await operations.insertOne(operation);
      return { operation, replay: null };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }

    let existing: AdminFeeOperationDocument | null = await operations.findOne({ operationId });
    if (!existing) throw new FeeAdminError('Another creator-fee operation is still active.', 409);
    if (existing.kind !== kind || existing.mint !== String(mint) || (kind === 'deposit' && existing.amountLamports !== amountLamports)) {
      throw new FeeAdminError('Idempotency key was already used for different operation parameters.', 409);
    }
    if (existing.status === 'finalized') return { operation: existing, replay: operationResult(existing) };
    if (existing.status === 'submitted') {
      const reconciled = await reconcileSubmittedOperation(existing);
      if (reconciled.status === 'finalized') return { operation: reconciled, replay: operationResult(reconciled) };
      existing = reconciled;
    }
    if (existing.status === 'executing' && Date.now() - existing.updatedAt.getTime() < 120_000) {
      throw new FeeAdminError('This operation is already being processed. Retry with the same operation ID.', 409);
    }
    let reacquired: AdminFeeOperationDocument | null;
    try {
      reacquired = await operations.findOneAndUpdate(
        { operationId, status: existing.status, updatedAt: existing.updatedAt },
        { $set: { status: 'executing', lock: 'creator-fee-write', updatedAt: new Date() }, $unset: { error: '' } },
        { returnDocument: 'after' },
      );
    } catch (error) {
      if (isDuplicateKey(error)) throw new FeeAdminError('Another creator-fee operation is still active.', 409);
      throw error;
    }
    if (!reacquired) throw new FeeAdminError('This operation is already being processed.', 409);
    return { operation: reacquired, replay: null };
  }

  async function reconcileSubmittedOperation(operation: AdminFeeOperationDocument): Promise<AdminFeeOperationDocument> {
    if (!operation.signature || operation.lastValidBlockHeight === undefined) {
      throw new FeeAdminError('Submitted operation is missing reconciliation data.', 500);
    }
    const outcome = await finalizedTransactionOutcome(config.rpcUrl, operation.signature, operation.lastValidBlockHeight);
    if (outcome.state === 'pending') throw new FeeAdminError('Transaction is still pending. Retry with the same operation ID.', 409);
    if (outcome.state === 'finalized') return finalizeOperation({ ...operation, slot: outcome.slot });
    const error = outcome.state === 'expired' ? 'Transaction expired before finalization.' : `Transaction failed: ${JSON.stringify(outcome.error)}`;
    await operations.updateOne(
      { operationId: operation.operationId },
      { $set: { status: 'failed', error, updatedAt: new Date() }, $unset: { lock: '' } },
    );
    return { ...operation, status: 'failed' as const, error, updatedAt: new Date(), lock: undefined };
  }

  async function markSubmitted(operationId: string, details: { signature: string; lastValidBlockHeight: number }) {
    const result = await operations.updateOne(
      { operationId, status: 'executing' },
      { $set: { status: 'submitted', signature: details.signature, lastValidBlockHeight: details.lastValidBlockHeight, updatedAt: new Date() } },
    );
    if (result.modifiedCount !== 1) throw new Error(`Could not persist signed transaction for operation ${operationId}`);
  }

  async function finalizeOperation(operation: AdminFeeOperationDocument) {
    if (!operation.signature) throw new Error(`Operation ${operation.operationId} has no transaction signature`);
    let slot = operation.slot;
    if (slot === undefined && operation.lastValidBlockHeight !== undefined) {
      const outcome = await finalizedTransactionOutcome(config.rpcUrl, operation.signature, operation.lastValidBlockHeight);
      if (outcome.state !== 'finalized') throw new UnresolvedSolanaTransactionError(operation.signature);
      slot = outcome.slot;
    }
    if (slot === undefined) {
      const statuses = await solanaRpcCall<{ value: Array<{ err: unknown; confirmationStatus?: string | null; slot: number } | null> }>(
        config.rpcUrl,
        'getSignatureStatuses',
        [[operation.signature], { searchTransactionHistory: true }],
      );
      const status = statuses.value[0];
      if (status?.err) throw new Error(`Finalized operation ${operation.operationId} failed: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === 'finalized') slot = status.slot;
    }
    if (slot === undefined) throw new Error(`Finalized operation ${operation.operationId} has no slot`);
    const walletAfter = await getBalance(config.rpcUrl, FIXED_FEE_RECIPIENT);
    const action: AdminFeeActionDocument = {
      kind: operation.kind,
      mint: operation.mint,
      amountLamports: operation.amountLamports,
      signature: operation.signature,
      cluster: config.cluster,
      slot,
      bondingLamports: operation.bondingLamports,
      ammLamports: operation.ammLamports,
      walletBalanceBefore: operation.walletBalanceBefore,
      walletBalanceAfter: walletAfter.toString(),
      createdAt: operation.createdAt,
    };
    await actions.updateOne({ signature: operation.signature }, { $setOnInsert: action }, { upsert: true });
    await operations.updateOne(
      { operationId: operation.operationId },
      { $set: { status: 'finalized', slot, walletBalanceAfter: walletAfter.toString(), updatedAt: new Date() }, $unset: { lock: '', error: '' } },
    );
    return { ...operation, status: 'finalized' as const, slot, walletBalanceAfter: walletAfter.toString(), lock: undefined, updatedAt: new Date() };
  }

  async function failOperation(operationId: string, error: unknown) {
    if (error instanceof UnresolvedSolanaTransactionError) return;
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
    await operations.updateOne(
      { operationId },
      { $set: { status: 'failed', error: message, updatedAt: new Date() }, $unset: { lock: '' } },
    );
  }

  return {
    payerAddress: admin.address,
    inspectMint,
    async creatorFeeSnapshot() {
      const current = await configuredMint();
      return feeSnapshot(String(current) === ZERO_ADDRESS ? undefined : current);
    },
    async status() {
      const activeOperation = await reconcileActiveOperation();
      const current = await configuredMint();
      const mint = String(current) === ZERO_ADDRESS ? undefined : current;
      const [fees, history, storedToken, worker, lastRescue, lastUnpause] = await Promise.all([
        feeSnapshot(mint),
        actions.find({}, { sort: { createdAt: -1 }, limit: 20 }).toArray(),
        tokenConfig.findOne({ key: 'primary' }),
        workerStatus.findOne({ key: 'protocol-worker' }),
        actions.findOne({ kind: 'emergency_rescue' }, { sort: { createdAt: -1 } }),
        actions.findOne({ kind: 'unpause' }, { sort: { createdAt: -1 } }),
      ]);
      const ticker = mint && storedToken?.mint === String(mint) ? storedToken.ticker : null;
      const dashboard = await loadProtocolDashboard(config.rpcUrl, config.programId, worker, config.workerIntervalMs, ticker || 'FARE');
      const lastClaim = history.find(item => item.kind === 'claim');
      return {
        ...fees,
        ticker,
        lastClaimLamports: lastClaim?.amountLamports || '0',
        activeOperation: activeOperation ? {
          operationId: activeOperation.operationId,
          kind: activeOperation.kind,
          status: activeOperation.status,
          signature: activeOperation.signature || null,
        } : null,
        dashboard,
        rescuePendingMigration: Boolean(lastRescue && (!lastUnpause || lastRescue.createdAt > lastUnpause.createdAt)),
        history: history.map(publicAction),
      };
    },
    async bindMint(rawMint: unknown, rawTicker: unknown) {
      let ticker: string;
      try { ticker = normalizeTicker(rawTicker); } catch (error) { throw new FeeAdminError((error as Error).message); }
      const inspected = await inspectMint(rawMint);
      const storedToken = await tokenConfig.findOne({ key: 'primary' });
      const current = await configuredMint();
      if (String(current) === String(inspected.mint)) {
        if (storedToken?.mint === String(inspected.mint) && storedToken.ticker === ticker) {
          return { signature: storedToken.bindSignature, mint: storedToken.mint, ticker: storedToken.ticker, unchanged: true };
        }
        const previous = await actions.findOne({ kind: 'bind_mint', mint: String(inspected.mint) }, { sort: { createdAt: -1 } });
        const signature = previous?.signature || '';
        await savePrimaryTokenConfig(tokenConfig, inspected.mint, ticker, signature);
        return { signature, mint: String(inspected.mint), ticker, unchanged: false };
      }
      const [fareVault] = await findAssociatedTokenPda({ owner: addresses.config, mint: inspected.mint, tokenProgram: inspected.tokenProgram });
      const feeSharingConfig = await derivePumpFeeSharingConfig(inspected.mint);
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
          feeSharingConfig,
          tokenProgram: inspected.tokenProgram,
        }),
      ];
      const additional = String(admin.address) === String(feeRecipient.address) ? [] : [feeRecipient];
      const signature = String(await sendInstructions(config.rpcUrl, admin, instructions, additional));
      await savePrimaryTokenConfig(tokenConfig, inspected.mint, ticker, signature);
      await actions.insertOne({ kind: 'bind_mint', mint: String(inspected.mint), amountLamports: '0', signature, cluster: config.cluster, createdAt: new Date() });
      return { signature, mint: String(inspected.mint), ticker, unchanged: false };
    },
    async setMintPrices(rawPrices: unknown) {
      if (!Array.isArray(rawPrices) || rawPrices.length !== 4) throw new FeeAdminError('Four USD prices are required.');
      const prices = rawPrices.map((value, index) => {
        const dollars = Number(value);
        const cents = Math.round(dollars * 100);
        if (!Number.isFinite(dollars) || dollars <= 0 || !Number.isSafeInteger(cents)) throw new FeeAdminError(`Class ${index + 1} price is invalid.`);
        return BigInt(cents);
      }) as [bigint, bigint, bigint, bigint];
      if (!prices.every(price => price === 2_500n)) throw new FeeAdminError('Every taxi mint must cost exactly $25.');
      const current = await configuredState();
      if (current.saleStarted) throw new FeeAdminError('Mint prices are locked after the sale starts.', 409);
      const signature = String(await sendInstructions(config.rpcUrl, admin, [
        buildSimpleAdminInstruction(config.programId, admin.address, addresses.config, { name: 'set-mint-prices', prices }),
      ]));
      return { signature, mintPricesUsdCents: prices.map(String) };
    },
    async setTeamAccount(rawTeamAccount: unknown) {
      if (typeof rawTeamAccount !== 'string') throw new FeeAdminError('Team wallet is required.');
      let teamAccount: Address;
      try { teamAccount = address(rawTeamAccount.trim()); } catch { throw new FeeAdminError('Team wallet is not a valid Solana address.'); }
      if (String(teamAccount) === ZERO_ADDRESS) throw new FeeAdminError('Team wallet cannot be the system address.');
      const currentConfiguration = decodeWorkerConfiguration((await getAccount(config.rpcUrl, addresses.config)).data);
      if (String(currentConfiguration.teamAccount) === String(teamAccount)) {
        return { signature: '', teamAccount: String(teamAccount), unchanged: true };
      }
      const activeOperation = await reconcileActiveOperation();
      if (activeOperation) throw new FeeAdminError('Wait for the active creator-fee operation to finalize before changing the team wallet.', 409);
      const instruction = buildSimpleAdminInstruction(config.programId, admin.address, addresses.config, { name: 'set-team', value: teamAccount });
      const signature = String(await sendInstructions(config.rpcUrl, admin, [instruction]));
      await actions.insertOne({
        kind: 'set_team', mint: String(currentConfiguration.fareMint), amountLamports: '0', signature,
        cluster: config.cluster, createdAt: new Date(),
      });
      return { signature, teamAccount: String(teamAccount), unchanged: false };
    },
    async setPaused(rawPaused: unknown, migrationConfirmed: unknown) {
      if (typeof rawPaused !== 'boolean') throw new FeeAdminError('Paused state must be true or false.');
      const current = await configuredState();
      const isPaused = current.pausedAt !== 0n;
      if (isPaused === rawPaused) return { signature: '', paused: isPaused, unchanged: true };
      if (!rawPaused) {
        const lastRescue = await actions.findOne({ kind: 'emergency_rescue' }, { sort: { createdAt: -1 } });
        const lastUnpause = await actions.findOne({ kind: 'unpause' }, { sort: { createdAt: -1 } });
        if (lastRescue && (!lastUnpause || lastRescue.createdAt > lastUnpause.createdAt) && migrationConfirmed !== true) {
          throw new FeeAdminError('Assets were rescued after the last pause. Confirm completed migration before unpausing this deployment.', 409);
        }
      }
      const activeOperation = await reconcileActiveOperation();
      if (activeOperation) throw new FeeAdminError('Wait for the active creator-fee operation to finalize before changing protocol state.', 409);
      const kind = rawPaused ? 'pause' : 'unpause';
      const signature = String(await sendInstructions(config.rpcUrl, admin, [
        buildSimpleAdminInstruction(config.programId, admin.address, addresses.config, { name: kind }),
      ]));
      await actions.insertOne({ kind, mint: String(current.fareMint), amountLamports: '0', signature, cluster: config.cluster, createdAt: new Date() });
      return { signature, paused: rawPaused, unchanged: false };
    },
    async emergencyRescue(rawRecipient: unknown) {
      if (typeof rawRecipient !== 'string') throw new FeeAdminError('Emergency recipient is required.');
      let recipient: Address;
      try { recipient = address(rawRecipient.trim()); } catch { throw new FeeAdminError('Emergency recipient is not a valid Solana address.'); }
      if (String(recipient) === ZERO_ADDRESS) throw new FeeAdminError('Emergency recipient cannot be the system address.');
      const current = await configuredState();
      if (current.pausedAt === 0n) throw new FeeAdminError('Pause the protocol before rescuing assets.', 409);
      const activeOperation = await reconcileActiveOperation();
      if (activeOperation) throw new FeeAdminError('Wait for the active creator-fee operation to finalize before rescuing assets.', 409);
      const feeVault = await getAccount(config.rpcUrl, addresses.feeVault);
      const solAmount = availableLamports(feeVault, await rent(config.rpcUrl, feeVault.data.length));
      const instructions: Instruction[] = [];
      const rescuedTokens: Array<{ mint: string; amount: string }> = [];
      const mints = [current.fareMint, ...current.stockMints].filter(mint => String(mint) !== ZERO_ADDRESS);
      for (const mint of mints) {
        const mintAccount = await getAccount(config.rpcUrl, mint);
        if (![String(TOKEN_PROGRAM), String(TOKEN_2022_PROGRAM)].includes(mintAccount.owner)) throw new FeeAdminError(`Unsupported token program for ${mint}.`, 409);
        const tokenProgram = address(mintAccount.owner);
        const [vault] = await findAssociatedTokenPda({ owner: addresses.config, mint, tokenProgram });
        const vaultAccount = await getOptionalAccount(config.rpcUrl, vault);
        const amount = vaultAccount ? tokenAmount(vaultAccount.data) : 0n;
        if (amount === 0n) continue;
        const [destination] = await findAssociatedTokenPda({ owner: recipient, mint, tokenProgram });
        instructions.push(
          getCreateAssociatedTokenIdempotentInstruction({ payer: admin, ata: destination, owner: recipient, mint, tokenProgram }),
          buildRescueTokenInstruction({ programId: config.programId, admin: admin.address, config: addresses.config, mint, vault, destination, tokenProgram, amount }),
        );
        rescuedTokens.push({ mint: String(mint), amount: amount.toString() });
      }
      if (solAmount > 0n) instructions.push(buildRescueSolInstruction(config.programId, admin.address, addresses.config, addresses.feeVault, recipient, solAmount));
      if (instructions.length === 0) throw new FeeAdminError('The protocol vaults do not contain rescuable assets.', 409);
      const signature = String(await sendInstructions(config.rpcUrl, admin, instructions));
      await actions.insertOne({
        kind: 'emergency_rescue', mint: String(current.fareMint), amountLamports: solAmount.toString(), signature,
        cluster: config.cluster, recipient: String(recipient), rescuedTokens, createdAt: new Date(),
      });
      return { signature, recipient: String(recipient), solLamports: solAmount.toString(), tokens: rescuedTokens };
    },
    async claim(rawOperationId: unknown) {
      const mint = await requireConfiguredMint();
      const acquired = await acquireOperation(rawOperationId, 'claim', mint);
      if (acquired.replay) return acquired.replay;
      const before = await feeSnapshot(mint);
      const route = await feeRoute(mint);
      const bondingLamports = BigInt(before.bondingLamports);
      const ammLamports = BigInt(before.ammLamports);
      const pendingUnwrap = BigInt(before.pendingUnwrapLamports);
      if (pendingUnwrap > 0n) {
        await failOperation(acquired.operation.operationId, new Error('Creator WSOL account is not empty.'));
        throw new FeeAdminError('Creator WSOL account contains an existing balance. Unwrap or move it before claiming fees.', 409);
      }
      if (bondingLamports + ammLamports === 0n) {
        await failOperation(acquired.operation.operationId, new Error('There are no creator fees to claim.'));
        throw new FeeAdminError('There are no creator fees to claim.', 409);
      }
      const amount = bondingLamports + ammLamports;
      const operation = {
        ...acquired.operation,
        amountLamports: amount.toString(),
        bondingLamports: bondingLamports.toString(),
        ammLamports: ammLamports.toString(),
        pendingUnwrapLamports: pendingUnwrap.toString(),
        walletBalanceBefore: before.walletLamports,
      };
      await operations.updateOne({ operationId: operation.operationId }, { $set: {
        amountLamports: operation.amountLamports,
        bondingLamports: operation.bondingLamports,
        ammLamports: operation.ammLamports,
        pendingUnwrapLamports: operation.pendingUnwrapLamports,
        walletBalanceBefore: operation.walletBalanceBefore,
        updatedAt: new Date(),
      } });
      const pump = await derivePumpFeeAddresses(route.creator);
      const instructions: Instruction[] = [];
      if (route.mode === 'sharing') {
        if (ammLamports > 0n) instructions.push(buildPumpSharedAmmFeeTransfer(feeRecipient.address, route.creator, pump));
        instructions.push(buildPumpSharedFeeDistribution({
          payer: feeRecipient.address,
          mint,
          bondingCurve: route.bondingCurve,
          sharingConfig: route.creator,
          recipient: FIXED_FEE_RECIPIENT,
          addresses: pump,
        }));
      } else {
        instructions.push(getCreateAssociatedTokenIdempotentInstruction({ payer: feeRecipient, ata: pump.creatorWsolAta, owner: feeRecipient.address, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM }));
        if (bondingLamports > 0n) instructions.push(buildPumpBondingFeeCollection(FIXED_FEE_RECIPIENT, pump));
        if (ammLamports > 0n) instructions.push(buildPumpAmmFeeCollection(FIXED_FEE_RECIPIENT, pump));
        instructions.push(getCloseAccountInstruction({ account: pump.creatorWsolAta, destination: feeRecipient.address, owner: feeRecipient }));
      }
      try {
        const signature = String(await sendInstructions(config.rpcUrl, feeRecipient, instructions, [], {}, {
          onSigned: details => markSubmitted(operation.operationId, details),
        }));
        return operationResult(await finalizeOperation({ ...operation, signature, status: 'submitted' }));
      } catch (error) {
        await failOperation(operation.operationId, error);
        throw error;
      }
    },
    async deposit(rawAmount: unknown, rawOperationId: unknown) {
      const mint = await requireConfiguredMint();
      if (typeof rawAmount !== 'string' || !/^[1-9]\d*$/.test(rawAmount)) throw new FeeAdminError('Amount must be a positive raw lamport string.');
      const amount = BigInt(rawAmount);
      const acquired = await acquireOperation(rawOperationId, 'deposit', mint, amount.toString());
      if (acquired.replay) return acquired.replay;
      const balanceBefore = await getBalance(config.rpcUrl, FIXED_FEE_RECIPIENT);
      if (balanceBefore < amount + minimumWalletLamports) {
        await failOperation(acquired.operation.operationId, new Error('Amount leaves too little SOL for network fees.'));
        throw new FeeAdminError('Amount leaves too little SOL for network fees.', 409);
      }
      const operation = { ...acquired.operation, walletBalanceBefore: balanceBefore.toString() };
      await operations.updateOne({ operationId: operation.operationId }, { $set: { walletBalanceBefore: operation.walletBalanceBefore, updatedAt: new Date() } });
      const configuration = decodeWorkerConfiguration((await getAccount(config.rpcUrl, addresses.config)).data);
      const instructions: Instruction[] = [
        getTransferSolInstruction({ source: feeRecipient, destination: addresses.feeVault, amount }),
        collectFeesInstruction(config.programId, feeRecipient.address, addresses.config, addresses.feeVault, configuration.teamAccount),
      ];
      try {
        const signature = String(await sendInstructions(config.rpcUrl, feeRecipient, instructions, [], {}, {
          onSigned: details => markSubmitted(operation.operationId, details),
        }));
        return operationResult(await finalizeOperation({ ...operation, signature, status: 'submitted' }));
      } catch (error) {
        await failOperation(operation.operationId, error);
        throw error;
      }
    },
  };

  async function requireConfiguredMint() {
    const mint = await configuredMint();
    if (String(mint) === ZERO_ADDRESS) throw new FeeAdminError('FARE CA has not been fixed.', 409);
    return mint;
  }
}

export function decodePumpBondingCurve(data: Uint8Array) {
  if (data.length < 125 || !Buffer.from(data.subarray(0, 8)).equals(BONDING_CURVE_DISCRIMINATOR)) throw new FeeAdminError('Invalid or outdated Pump bonding curve account.');
  return {
    complete: data[48] !== 0,
    creator: addressDecoder.decode(data.subarray(49, 81)),
    mayhem: data[81] !== 0,
    cashback: data[82] !== 0,
    quoteMint: addressDecoder.decode(data.subarray(83, 115)),
    creatorFeeBps: new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(115, true),
    canEditCreatorFee: data[123] !== 0,
    holderRewards: data[124] !== 0,
  };
}

export function decodePumpFeeSharingConfig(data: Uint8Array) {
  const discriminator = Buffer.from([216, 74, 9, 0, 56, 140, 93, 75]);
  if (data.length < 80 || !Buffer.from(data.subarray(0, 8)).equals(discriminator)) throw new FeeAdminError('Invalid Pump fee sharing config.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const shareholderCount = view.getUint32(76, true);
  if (shareholderCount > 10 || data.length < 80 + shareholderCount * 34) throw new FeeAdminError('Invalid Pump fee sharing shareholders.');
  return {
    version: data[9],
    active: data[10] === 1,
    mint: addressDecoder.decode(data.subarray(11, 43)),
    admin: addressDecoder.decode(data.subarray(43, 75)),
    adminRevoked: data[75] !== 0,
    shareholders: Array.from({ length: shareholderCount }, (_, index) => {
      const offset = 80 + index * 34;
      return {
        address: addressDecoder.decode(data.subarray(offset, offset + 32)),
        shareBps: view.getUint16(offset + 32, true),
      };
    }),
  };
}

function validateFixedFeeSharing(account: RpcAccount, mint: Address) {
  if (account.owner !== String(PUMP_FEE_PROGRAM)) throw new FeeAdminError('Fee sharing config is not owned by the official Pump Fees program.');
  const sharing = decodePumpFeeSharingConfig(account.data);
  if (sharing.version !== 2 || !sharing.active || !sharing.adminRevoked) {
    throw new FeeAdminError('Fee sharing must be active, version 2, and permanently immutable.');
  }
  if (String(sharing.mint) !== String(mint)) throw new FeeAdminError('Fee sharing config belongs to another mint.');
  if (sharing.shareholders.length !== 1
    || String(sharing.shareholders[0].address) !== String(FIXED_FEE_RECIPIENT)
    || sharing.shareholders[0].shareBps !== 10_000) {
    throw new FeeAdminError(`Fee sharing must assign exactly 100% to ${FIXED_FEE_RECIPIENT}.`);
  }
  return sharing;
}

export function tokenAmount(data: Uint8Array) {
  if (data.length < 165 || data[108] === 0) throw new FeeAdminError('Invalid token account.');
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
}

export function normalizeOperationId(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value)) {
    throw new FeeAdminError('A valid idempotency operation ID is required.');
  }
  return value;
}

function operationResult(operation: AdminFeeOperationDocument) {
  if (!operation.signature) throw new Error(`Finalized operation ${operation.operationId} has no signature`);
  return { signature: operation.signature, amountLamports: operation.amountLamports, operationId: operation.operationId };
}

function isDuplicateKey(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 11000);
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
    cluster: action.cluster, bondingLamports: action.bondingLamports, ammLamports: action.ammLamports,
    recipient: action.recipient, rescuedTokens: action.rescuedTokens, createdAt: action.createdAt,
  };
}
