import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBufferWrite } from '../scripts/upload-pda-buffer-mainnet.mjs';
import { AccountRole, address, generateKeyPairSigner, createTransactionMessage, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, signTransactionMessageWithSigners, getTransactionEncoder } from '@solana/kit';

test('loader buffer write encodes bounded offset and bincode vector length', () => {
  const data = encodeBufferWrite(900, Buffer.from([1, 2, 3]));
  assert.equal(data.readUInt32LE(0), 1);
  assert.equal(data.readUInt32LE(4), 900);
  assert.equal(data.readBigUInt64LE(8), 3n);
  assert.deepEqual([...data.subarray(16)], [1, 2, 3]);
  assert.throws(() => encodeBufferWrite(-1, Buffer.alloc(1)));
  assert.throws(() => encodeBufferWrite(881680, Buffer.alloc(1)));
  assert.throws(() => encodeBufferWrite(0, Buffer.alloc(901)));
});

test('900-byte upload chunk with compute budget fits the packet and has one signer', async () => {
  const signer = await generateKeyPairSigner();
  const budget = address('ComputeBudget111111111111111111111111111111');
  const limit = Buffer.alloc(5); limit[0] = 2; limit.writeUInt32LE(15000, 1);
  const price = Buffer.alloc(9); price[0] = 3; price.writeBigUInt64LE(1000n, 1);
  let message = createTransactionMessage({ version: 0 });
  message = setTransactionMessageFeePayerSigner(signer, message);
  message = setTransactionMessageLifetimeUsingBlockhash({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n }, message);
  message = appendTransactionMessageInstructions([
    { programAddress: budget, data: limit }, { programAddress: budget, data: price },
    { programAddress: address('BPFLoaderUpgradeab1e11111111111111111111111'), data: encodeBufferWrite(0, Buffer.alloc(900)), accounts: [
      { address: address('9FxHoCC6jTocECMZmRKqKYoZSDzN3yhHPTEVHoAffeVY'), role: AccountRole.WRITABLE },
      { address: signer.address, role: AccountRole.READONLY_SIGNER, signer },
    ] },
  ], message);
  const transaction = await signTransactionMessageWithSigners(message);
  assert.equal(Object.keys(transaction.signatures).length, 1);
  assert.ok(getTransactionEncoder().encode(transaction).length <= 1232);
});
