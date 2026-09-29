import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token';
import { AccountRole, address, appendTransactionMessageInstructions, compileTransaction, createTransactionMessage, generateKeyPairSigner, getTransactionEncoder, getAddressEncoder, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, type Instruction } from '@solana/kit';
import { TOKEN_PROGRAM } from '../server/pump.js';
import {
  buildRescueSolInstruction,
  buildRescueTokenInstruction,
  buildSetFareMintInstruction,
  buildSimpleAdminInstruction,
} from '../server/admin.js';

const PROGRAM = address('GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4');
const ADMIN = address('11111111111111111111111111111111');
const CONFIG = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const VALUE = address('So11111111111111111111111111111111111111112');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

test('simple admin commands encode Anchor discriminators and arguments', () => {
  const pause = buildSimpleAdminInstruction(PROGRAM, ADMIN, CONFIG, { name: 'pause' });
  assert.equal(pause.accounts?.[0].role, AccountRole.READONLY_SIGNER);
  assert.equal(pause.accounts?.[1].role, AccountRole.WRITABLE);
  assert.deepEqual(Buffer.from(pause.data!), discriminator('pause'));

  const team = buildSimpleAdminInstruction(PROGRAM, ADMIN, CONFIG, { name: 'set-team', value: VALUE });
  assert.deepEqual(Buffer.from(team.data!.slice(0, 8)), discriminator('set_team_account'));
  assert.deepEqual(Buffer.from(team.data!.slice(8)), Buffer.from(getAddressEncoder().encode(VALUE)));

  const prices = buildSimpleAdminInstruction(PROGRAM, ADMIN, CONFIG, {
    name: 'set-mint-prices', prices: [1n, 2n, 3n, 4n],
  });
  assert.equal(prices.data!.length, 40);
  assert.deepEqual([0, 1, 2, 3].map(index => (
    new DataView(prices.data!.buffer, prices.data!.byteOffset).getBigUint64(8 + index * 8, true)
  )), [1n, 2n, 3n, 4n]);
});

test('FARE mint binding uses the pre-sale Anchor instruction account order', () => {
  const instruction = buildSetFareMintInstruction({
    programId: PROGRAM,
    admin: ADMIN,
    feeRecipient: ADMIN,
    config: CONFIG,
    fareMint: VALUE,
    fareVault: PROGRAM,
    bondingCurve: CONFIG,
    feeSharingConfig: ADMIN,
    tokenProgram: VALUE,
  });
  assert.deepEqual(instruction.accounts?.map(account => account.role), [
    AccountRole.READONLY_SIGNER,
    AccountRole.READONLY_SIGNER,
    AccountRole.WRITABLE,
    AccountRole.READONLY,
    AccountRole.READONLY,
    AccountRole.READONLY,
    AccountRole.READONLY,
    AccountRole.READONLY,
  ]);
  assert.deepEqual(Buffer.from(instruction.data!), discriminator('set_fare_mint'));
});

test('rescue commands use paused-contract account order and raw u64 amount', () => {
  const sol = buildRescueSolInstruction(PROGRAM, ADMIN, CONFIG, VALUE, ADMIN, 25n);
  assert.deepEqual(sol.accounts?.map(account => account.role), [
    AccountRole.READONLY_SIGNER,
    AccountRole.READONLY,
    AccountRole.WRITABLE,
    AccountRole.WRITABLE,
  ]);
  assert.equal(new DataView(sol.data!.buffer, sol.data!.byteOffset).getBigUint64(8, true), 25n);

  const token = buildRescueTokenInstruction({
    programId: PROGRAM,
    admin: ADMIN,
    config: CONFIG,
    mint: VALUE,
    vault: CONFIG,
    destination: ADMIN,
    tokenProgram: PROGRAM,
    amount: 30n,
  });
  assert.equal(token.accounts?.length, 6);
  assert.deepEqual(Buffer.from(token.data!.slice(0, 8)), discriminator('rescue_token'));
  assert.equal(new DataView(token.data!.buffer, token.data!.byteOffset).getBigUint64(8, true), 30n);
});

test('one emergency transaction can rescue SOL and all five token vaults', async () => {
  const payer = await generateKeyPairSigner();
  const recipient = (await generateKeyPairSigner()).address;
  const mints = [
    VALUE,
    address('XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB'),
    address('XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB'),
    address('XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN'),
    address('Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg'),
  ];
  const instructions: Instruction[] = [];
  for (const [index, mint] of mints.entries()) {
    const tokenProgram = index === 0 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
    const [vault] = await findAssociatedTokenPda({ owner: CONFIG, mint, tokenProgram });
    const [destination] = await findAssociatedTokenPda({ owner: recipient, mint, tokenProgram });
    instructions.push(
      getCreateAssociatedTokenIdempotentInstruction({ payer, ata: destination, owner: recipient, mint, tokenProgram }),
      buildRescueTokenInstruction({ programId: PROGRAM, admin: payer.address, config: CONFIG, mint, vault, destination, tokenProgram, amount: 1n }),
    );
  }
  instructions.push(buildRescueSolInstruction(PROGRAM, payer.address, CONFIG, VALUE, recipient, 1n));
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    transaction => setTransactionMessageFeePayer(payer.address, transaction),
    transaction => setTransactionMessageLifetimeUsingBlockhash({ blockhash: '11111111111111111111111111111111' as never, lastValidBlockHeight: 1n }, transaction),
    transaction => appendTransactionMessageInstructions(instructions, transaction),
  );
  const bytes = getTransactionEncoder().encode(compileTransaction(message));
  assert.ok(bytes.length <= 1232, `emergency rescue transaction is ${bytes.length} bytes`);
});

function discriminator(name: string) {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
