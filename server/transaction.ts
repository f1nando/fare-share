import {
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
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
  const rpc = createSolanaRpc(rpcUrl);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'finalized' }).send();
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
  const signature = await rpc.sendTransaction(encoded, {
    encoding: 'base64',
    maxRetries: 3n,
    preflightCommitment: 'finalized',
  }).send();
  await waitForFinalized(rpc, signature);
  return signature;
}

async function waitForFinalized(rpc: ReturnType<typeof createSolanaRpc>, signature: string) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const result = await rpc.getSignatureStatuses([signature as never], { searchTransactionHistory: true }).send();
    const status = result.value[0];
    if (status?.err) throw new Error(`Solana transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'finalized') return;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Solana transaction ${signature} was not finalized within 45 seconds`);
}
