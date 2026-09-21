import assert from 'node:assert/strict';
import test from 'node:test';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';

import {
  PROGRAM_ID,
  calculateRepairQuote,
  protocolAddresses,
  shortAddress,
} from '../src/protocol/solana.js';
import {
  buildActivateTraineeInstructions,
  buildClaimInstructions,
  chooseEventPage,
  TAXI_DISCRIMINATORS,
} from '../src/protocol/anchorClient.js';

const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

test('protocol PDAs are deterministic and distinct', async () => {
  const first = await protocolAddresses();
  const second = await protocolAddresses();

  assert.deepEqual(first, second);
  assert.equal(new Set(Object.values(first)).size, Object.keys(first).length);
  assert.notEqual(String(first.config), String(PROGRAM_ID));
});

test('mint routing chooses a page with room for both machine events', () => {
  const queue = { pages: [{ index: 0, count: 127 }, { index: 1, count: 126 }] };
  assert.equal(chooseEventPage(queue, 2), 1);
  assert.deepEqual([...TAXI_DISCRIMINATORS.mintMachine], [163, 170, 168, 54, 183, 79, 113, 45]);
});

test('wallet addresses are shortened for the primitive UI', () => {
  assert.equal(shortAddress('7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY'), '7SpH…KwnY');
  assert.equal(shortAddress('short'), 'short');
});

test('repair quote mirrors the on-chain 25% five-day formula', () => {
  assert.equal(calculateRepairQuote(20_000_000n, 0n, 4 * 24 * 60 * 60), 1_000_000n);
  assert.equal(calculateRepairQuote(18_000_000n, 2_000_000n, 0), 5_000_000n);
  assert.equal(calculateRepairQuote(20_000_000n, 0n, 5 * 24 * 60 * 60), 0n);
});

test('trainee activation puts Ed25519 verification immediately before the program instruction', async () => {
  const programAddress = PROGRAM_ID;
  const owner = '11111111111111111111111111111111';
  const instructions = await buildActivateTraineeInstructions({
    programAddress,
    owner,
    configAddress: (await protocolAddresses()).config,
    traineeQueue: (await protocolAddresses()).traineeQueue,
    voucher: {
      backendSigner: owner,
      signature: Buffer.alloc(64, 7).toString('base64'),
      message: Buffer.from('signed voucher').toString('base64'),
      args: {
        campaignId: '12', nonce: '34', durationMinutes: 360,
        expiresAt: '1000', activeFrom: '1020', activeUntil: '22620', pageIndex: 2,
      },
    },
  });
  assert.equal(instructions.length, 2);
  assert.equal(String(instructions[0].programAddress), 'Ed25519SigVerify111111111111111111111111111');
  assert.deepEqual([...instructions[1].data.slice(0, 8)], [...TAXI_DISCRIMINATORS.activateTrainee]);
  assert.equal(instructions[1].accounts.length, 9);
});

test('claim transaction size is measured with five missing destination accounts', async () => {
  const signers = await Promise.all(Array.from({ length: 10 }, () => generateKeyPairSigner()));
  const [owner, config, pool, machine, asset, ...mints] = signers.map(signer => signer.address);
  const instructions = await buildClaimInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress: config,
    pool,
    machine,
    asset,
    mints,
    tokenPrograms: [TOKEN_PROGRAM, ...Array(4).fill(TOKEN_2022_PROGRAM)],
  });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    transaction => setTransactionMessageFeePayer(owner, transaction),
    transaction => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 1n,
    }, transaction),
    transaction => appendTransactionMessageInstructions(instructions, transaction),
  );
  const bytes = getTransactionEncoder().encode(compileTransaction(message));
  assert.ok(bytes.length <= 1100, `claim transaction is ${bytes.length} bytes`);
});
