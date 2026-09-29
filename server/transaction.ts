import {
  appendTransactionMessageInstructions,
  blockhash,
  compressTransactionMessageUsingAddressLookupTables,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
  type KeyPairSigner,
  type AddressesByLookupTableAddress,
} from '@solana/kit';
import { AmbiguousSolanaWriteError, solanaRpcCall, solanaSendTransactionCall } from './solanaRpc.js';

export class UnresolvedSolanaTransactionError extends Error {
  constructor(public readonly signature: string, cause?: unknown) {
    super(`Solana transaction ${signature} has an unresolved finalized status`, { cause });
    this.name = 'UnresolvedSolanaTransactionError';
  }
}

export class SolanaTransactionTooLargeError extends Error {
  constructor(public readonly wireBytes: number) {
    super(`Solana transaction is ${wireBytes} bytes; maximum is 1232`);
    this.name = 'SolanaTransactionTooLargeError';
  }
}

export class SolanaTransactionSimulationError extends Error {
  constructor(public readonly transactionError: unknown, logs: string[] = []) {
    super(`Solana transaction simulation failed: ${JSON.stringify(transactionError)}${logs.length ? `\n${logs.join('\n')}` : ''}`);
    this.name = 'SolanaTransactionSimulationError';
  }
}

export interface SignedTransactionDetails {
  signature: string;
  lastValidBlockHeight: number;
}

export async function createWorkerSigner(secret: Uint8Array) {
  return createKeyPairSignerFromBytes(secret);
}

export async function sendInstructions(
  rpcUrl: string,
  signer: KeyPairSigner,
  instructions: Instruction[],
  additionalSigners: KeyPairSigner[] = [],
  lookupTables: AddressesByLookupTableAddress = {},
  options: { onSigned?: (details: SignedTransactionDetails) => Promise<void> } = {},
) {
  const { value: rawLatestBlockhash } = await solanaRpcCall<{
    value: { blockhash: string; lastValidBlockHeight: number };
  }>(rpcUrl, 'getLatestBlockhash', [{ commitment: 'finalized' }]);
  const latestBlockhash = {
    blockhash: blockhash(rawLatestBlockhash.blockhash),
    lastValidBlockHeight: BigInt(rawLatestBlockhash.lastValidBlockHeight),
  };
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    transaction => setTransactionMessageFeePayerSigner(signer, transaction),
    transaction => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transaction),
    transaction => appendTransactionMessageInstructions(instructions, transaction),
    transaction => compressTransactionMessageUsingAddressLookupTables(transaction, lookupTables),
  );
  const compiled = compileTransaction(message);
  const signed = await partiallySignTransaction(
    [signer, ...additionalSigners].map(item => item.keyPair),
    compiled,
  );
  const expectedSignature = String(getSignatureFromTransaction(signed));
  const encoded = getBase64EncodedWireTransaction(signed);
  assertWireTransactionSize(String(encoded));
  const simulation = await solanaRpcCall<{ value: { err: unknown; logs?: string[] | null } }>(rpcUrl, 'simulateTransaction', [encoded, {
    encoding: 'base64',
    commitment: 'finalized',
    sigVerify: true,
  }]);
  if (simulation.value.err) {
    throw new SolanaTransactionSimulationError(simulation.value.err, simulation.value.logs || []);
  }
  await options.onSigned?.({
    signature: expectedSignature,
    lastValidBlockHeight: rawLatestBlockhash.lastValidBlockHeight,
  });
  try {
    const signature = await solanaSendTransactionCall<string>(rpcUrl, [encoded, {
      encoding: 'base64',
      maxRetries: 3,
      preflightCommitment: 'finalized',
    }]);
    if (signature !== expectedSignature) throw new UnresolvedSolanaTransactionError(expectedSignature, new Error(`RPC returned unexpected transaction signature ${signature}`));
    await waitForFinalized(rpcUrl, expectedSignature);
    return expectedSignature;
  } catch (error) {
    if (!(error instanceof AmbiguousSolanaWriteError)) throw error;
    try {
      await waitForFinalized(rpcUrl, expectedSignature);
      return expectedSignature;
    } catch (reconciliationError) {
      throw new UnresolvedSolanaTransactionError(expectedSignature, reconciliationError);
    }
  }
}

export function assertWireTransactionSize(encoded: string) {
  const wireBytes = Buffer.byteLength(encoded, 'base64');
  if (wireBytes > 1232) throw new SolanaTransactionTooLargeError(wireBytes);
}

async function waitForFinalized(rpcUrl: string, signature: string) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    let result: { value: Array<{ err: unknown; confirmationStatus?: string | null } | null> };
    try {
      result = await solanaRpcCall(rpcUrl, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
    } catch (error) {
      throw new UnresolvedSolanaTransactionError(signature, error);
    }
    const status = result.value[0];
    if (status?.err) throw new Error(`Solana transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'finalized') return;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new UnresolvedSolanaTransactionError(signature);
}

export async function finalizedTransactionOutcome(rpcUrl: string, signature: string, lastValidBlockHeight: number) {
  const result = await solanaRpcCall<{ value: Array<{
    err: unknown;
    confirmationStatus?: string | null;
    slot: number;
  } | null> }>(rpcUrl, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  const status = result.value[0];
  if (status?.err) return { state: 'failed' as const, error: status.err };
  if (status?.confirmationStatus === 'finalized') return { state: 'finalized' as const, slot: status.slot };
  const blockHeight = await solanaRpcCall<number>(rpcUrl, 'getBlockHeight', [{ commitment: 'finalized' }]);
  if (blockHeight > lastValidBlockHeight) return { state: 'expired' as const };
  return { state: 'pending' as const };
}
