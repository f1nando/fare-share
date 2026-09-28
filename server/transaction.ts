import {
  appendTransactionMessageInstructions,
  blockhash,
  compressTransactionMessageUsingAddressLookupTables,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
  type KeyPairSigner,
  type AddressesByLookupTableAddress,
} from '@solana/kit';
import { solanaRpcCall, solanaSendTransactionCall } from './solanaRpc.js';

export async function createWorkerSigner(secret: Uint8Array) {
  return createKeyPairSignerFromBytes(secret);
}

export async function sendInstructions(
  rpcUrl: string,
  signer: KeyPairSigner,
  instructions: Instruction[],
  additionalSigners: KeyPairSigner[] = [],
  lookupTables: AddressesByLookupTableAddress = {},
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
  const encoded = getBase64EncodedWireTransaction(signed);
  const signature = await solanaSendTransactionCall<string>(rpcUrl, [encoded, {
    encoding: 'base64',
    maxRetries: 3,
    preflightCommitment: 'finalized',
  }]);
  await waitForFinalized(rpcUrl, signature);
  return signature;
}

async function waitForFinalized(rpcUrl: string, signature: string) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const result = await solanaRpcCall<{ value: Array<{
      err: unknown;
      confirmationStatus?: string | null;
    } | null> }>(rpcUrl, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
    const status = result.value[0];
    if (status?.err) throw new Error(`Solana transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'finalized') return;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Solana transaction ${signature} was not finalized within 45 seconds`);
}
