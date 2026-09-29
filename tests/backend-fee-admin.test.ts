import assert from 'node:assert/strict';
import test from 'node:test';
import { address, getAddressEncoder } from '@solana/kit';
import { decodePumpBondingCurve, normalizeOperationId, tokenAmount } from '../server/feeAdmin.js';
import { normalizeTicker, tokenConfigFromDocument } from '../server/tokenConfig.js';

test('Pump curve decoder reads direct creator and all prohibited reward flags', () => {
  const creator = address('2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF');
  const data = new Uint8Array(125);
  data.set([23, 183, 248, 55, 96, 216, 172, 96]);
  data.set(getAddressEncoder().encode(creator), 49);
  const decoded = decodePumpBondingCurve(data);
  assert.equal(decoded.creator, creator);
  assert.equal(decoded.complete, false);
  assert.equal(decoded.mayhem, false);
  assert.equal(decoded.cashback, false);
  assert.equal(decoded.quoteMint, '11111111111111111111111111111111');
  assert.equal(decoded.creatorFeeBps, 0n);
  assert.equal(decoded.canEditCreatorFee, false);
  assert.equal(decoded.holderRewards, false);
  data[124] = 1;
  assert.equal(decodePumpBondingCurve(data).holderRewards, true);
});

test('Pump curve decoder rejects legacy layouts that cannot prove reward settings', () => {
  const data = new Uint8Array(115);
  data.set([23, 183, 248, 55, 96, 216, 172, 96]);
  assert.throws(() => decodePumpBondingCurve(data), /outdated Pump bonding curve/);
});

test('token amount parser reads initialized legacy and Token-2022 base layouts', () => {
  const data = new Uint8Array(200);
  data[108] = 1;
  new DataView(data.buffer).setBigUint64(64, 123456n, true);
  assert.equal(tokenAmount(data), 123456n);
  data[108] = 0;
  assert.throws(() => tokenAmount(data), /Invalid token account/);
});

test('admin fee operation IDs are bounded and safe for idempotent lookup', () => {
  assert.equal(normalizeOperationId('0199aabb-ccdd-7eef-8899-aabbccddeeff'), '0199aabb-ccdd-7eef-8899-aabbccddeeff');
  assert.throws(() => normalizeOperationId('short'), /operation ID/);
  assert.throws(() => normalizeOperationId('unsafe operation id!'), /operation ID/);
});

test('public token ticker is normalized and rejects unsafe labels', () => {
  assert.equal(normalizeTicker('$fare'), 'FARE');
  assert.equal(normalizeTicker('TAXI2026'), 'TAXI2026');
  assert.throws(() => normalizeTicker('FARE COIN'), /1–10 Latin letters or digits/);
  assert.throws(() => normalizeTicker('TOO-LONG-TICKER'), /1–10 Latin letters or digits/);
  assert.deepEqual(tokenConfigFromDocument(null), { configured: false, mint: null, ticker: null });
  assert.deepEqual(tokenConfigFromDocument({
    key: 'primary', mint: 'mint', ticker: 'FARE', bindSignature: 'signature', updatedAt: new Date(0),
  }), { configured: true, mint: 'mint', ticker: 'FARE' });
});
