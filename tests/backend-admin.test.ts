import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AccountRole, address, getAddressEncoder } from '@solana/kit';
import {
  buildRescueSolInstruction,
  buildRescueTokenInstruction,
  buildSimpleAdminInstruction,
} from '../server/admin.js';

const PROGRAM = address('9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv');
const ADMIN = address('11111111111111111111111111111111');
const CONFIG = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const VALUE = address('So11111111111111111111111111111111111111112');

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

function discriminator(name: string) {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
