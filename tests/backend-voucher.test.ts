import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import test from 'node:test';
import { address } from '@solana/kit';
import {
  buildTraineeVoucherMessage,
  keywordHash,
  keywordMatches,
  normalizeKeyword,
  parseBackendSigner,
} from '../server/signing.js';
import { decodeClockFields } from '../server/solanaState.js';
import { consumeRateLimit, VoucherError, voucherExpiresAt } from '../server/voucherService.js';

test('voucher message matches the Rust field order and little-endian values', () => {
  const message = buildTraineeVoucherMessage(
    address('7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY'),
    Uint8Array.from({ length: 32 }, (_, index) => index),
    address('11111111111111111111111111111111'),
    {
      campaignId: 7n,
      nonce: 9n,
      durationMinutes: 360,
      expiresAt: 1000n,
      activeFrom: 1020n,
      activeUntil: 22620n,
      pageIndex: 4,
    },
  );
  assert.equal(Buffer.from(message.slice(0, 15)).toString(), 'TAXI_TRAINEE_V1');
  const tail = new DataView(message.buffer, message.byteOffset + message.length - 42, 42);
  assert.equal(tail.getBigUint64(0, true), 7n);
  assert.equal(tail.getBigUint64(8, true), 9n);
  assert.equal(tail.getUint16(16, true), 360);
  assert.equal(tail.getBigInt64(18, true), 1000n);
  assert.equal(tail.getBigInt64(26, true), 1020n);
  assert.equal(tail.getBigInt64(34, true), 22620n);
});

test('voucher bytes can be signed and verified with Ed25519', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const message = Buffer.from('voucher');
  const signature = sign(null, message, privateKey);
  assert.equal(verify(null, message, publicKey, signature), true);
});

test('keywords are normalized and compared without storing plaintext', () => {
  const pepper = 'private-pepper';
  const expected = keywordHash('  ТАКСИ  ', pepper);
  assert.equal(normalizeKeyword(' Такси '), 'такси');
  assert.equal(keywordMatches('такси', expected, pepper), true);
  assert.equal(keywordMatches('автобус', expected, pepper), false);
});

test('backend signer accepts the standard Solana 64-byte secret format', () => {
  const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
  const publicBytes = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex');
  const signer = parseBackendSigner(JSON.stringify([...seed, ...publicBytes]));
  const signature = signer.sign(new Uint8Array());
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicBytes]),
    format: 'der', type: 'spki',
  });
  assert.equal(verify(null, Buffer.alloc(0), publicKey, signature), true);
});

test('server decodes protocol pause clock after variable metadata strings', () => {
  const chunks = [Buffer.alloc(8), Buffer.alloc(32 * 5), Buffer.alloc(32, 9), Buffer.alloc(8 + 8 * 4 + 32 * 6)];
  for (const text of ['a', 'longer-uri', '', 'z']) {
    const value = Buffer.from(text);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(value.length);
    chunks.push(length, value);
  }
  chunks.push(Buffer.alloc(8 * 4 + 2 * 4 + 1));
  const pause = Buffer.alloc(16);
  pause.writeBigInt64LE(500n, 0);
  pause.writeBigInt64LE(40n, 8);
  chunks.push(pause, Buffer.alloc(1));
  const decoded = decodeClockFields(Buffer.concat(chunks));
  assert.deepEqual([...decoded.deploymentId], Array(32).fill(9));
  assert.equal(decoded.pausedAt, 500n);
  assert.equal(decoded.totalPausedSeconds, 40n);
});

test('voucher expiry follows finalized Solana time instead of the server clock', () => {
  assert.equal(voucherExpiresAt(1_000n, 180), 1_180n);
});

test('parallel first requests cannot bypass the ten-attempt rate limit', async () => {
  let document: { key: string; attempts: number; expiresAt: Date } | null = null;
  const rateLimits = {
    async updateOne(filter: Record<string, any>, update: Record<string, any>) {
      if (document && document.key === filter.key && document.expiresAt <= filter.expiresAt.$lte) {
        document = { ...document, ...update.$set };
      }
    },
    async findOneAndUpdate(filter: Record<string, any>, update: Record<string, any>) {
      if (!document || document.key !== filter.key || document.attempts >= filter.attempts.$lt) return null;
      document = { ...document, attempts: document.attempts + update.$inc.attempts };
      return document;
    },
    async insertOne(value: { key: string; attempts: number; expiresAt: Date }) {
      if (document?.key === value.key) throw Object.assign(new Error('duplicate'), { code: 11000 });
      document = { ...value };
    },
  };
  const database = { rateLimits } as any;
  const results = await Promise.allSettled(
    Array.from({ length: 25 }, () => consumeRateLimit(database, 'same-ip:same-wallet')),
  );
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 10);
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(rejected.length, 15);
  assert.ok(rejected.every(result => result.reason instanceof VoucherError && result.reason.status === 429));
});
