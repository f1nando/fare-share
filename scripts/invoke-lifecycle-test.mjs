import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  address,
} from '@solana/kit';
import { readFileSync } from 'node:fs';

const [programId, rpcArgument] = process.argv.slice(2);
if (!programId) throw new Error('Program ID is required');
const secret = process.env.LIFECYCLE_TEST_KEYPAIR_SECRET || readFileSync(0, 'utf8').trim();
if (!secret) throw new Error('Signer keypair must be provided through the environment or stdin');

const rpcUrl = rpcArgument || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const signer = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(secret)),
);
const rpc = createSolanaRpc(rpcUrl);
const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'finalized' }).send();
const message = pipe(
  createTransactionMessage({ version: 0 }),
  transaction => setTransactionMessageFeePayerSigner(signer, transaction),
  transaction => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transaction),
  transaction => appendTransactionMessageInstructions([{
    programAddress: address(programId),
    accounts: [],
    data: Uint8Array.of(1, 2, 3),
  }], transaction),
);
const signed = await partiallySignTransaction([signer.keyPair], compileTransaction(message));
const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), {
  encoding: 'base64',
  maxRetries: 3n,
  preflightCommitment: 'finalized',
}).send();

for (let attempt = 0; attempt < 60; attempt += 1) {
  const status = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send()).value[0];
  if (status?.err) throw new Error(`Invocation failed: ${JSON.stringify(status.err)}`);
  if (status?.confirmationStatus === 'finalized') {
    console.log(`INVOKE_SIGNATURE=${signature}`);
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 1_000));
}
throw new Error(`Invocation was not finalized: ${signature}`);
