import { createHmac, createPrivateKey, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import { address, getAddressEncoder, type Address } from '@solana/kit';

const VOUCHER_DOMAIN = Buffer.from('TAXI_TRAINEE_V1');
const MINT_QUOTE_DOMAIN = Buffer.from('TAXI_MINT_Q_V2');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const addressEncoder = getAddressEncoder();

export interface VoucherArgs {
  campaignId: bigint;
  nonce: bigint;
  durationMinutes: number;
  expiresAt: bigint;
  activeFrom: bigint;
  activeUntil: bigint;
  pageIndex: number;
}

export interface BackendSigner {
  publicKey: Address;
  sign(message: Uint8Array): Uint8Array;
}

export interface MintQuoteFields {
  owner: Address;
  asset: Address;
  assignmentIndex: number;
  classIndex: number;
  variantIndex: number;
  fareMint: Address;
  amountFareRaw: bigint;
  priceUsdCents: bigint;
  expiresAt: bigint;
}

export function parseBackendSigner(serialized: string): BackendSigner {
  const secret = parseSecretBytes(serialized, 'BACKEND_SIGNER_SECRET_KEY');
  const publicBytes = secret.slice(32);
  const publicKey = addressFromBytes(publicBytes);
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(secret.slice(0, 32))]),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    publicKey,
    sign(message) {
      return Uint8Array.from(sign(null, Buffer.from(message), privateKey));
    },
  };
}

export function parseSecretBytes(serialized: string, name = 'secret key'): Uint8Array {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 64) throw new Error('expected 64 bytes');
    const values = parsed.map(Number);
    if (values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error('contains an invalid byte');
    }
    return Uint8Array.from(values);
  } catch (error) {
    throw new Error(`${name} must be a JSON array with 64 bytes: ${String(error)}`);
  }
}

export function buildTraineeVoucherMessage(
  programId: Address,
  deploymentId: Uint8Array,
  wallet: Address,
  args: VoucherArgs,
): Uint8Array {
  if (deploymentId.length !== 32) throw new Error('deploymentId must contain 32 bytes');
  return concat(
    VOUCHER_DOMAIN,
    Uint8Array.from(addressEncoder.encode(programId)),
    deploymentId,
    Uint8Array.from(addressEncoder.encode(wallet)),
    u64(args.campaignId),
    u64(args.nonce),
    u16(args.durationMinutes),
    i64(args.expiresAt),
    i64(args.activeFrom),
    i64(args.activeUntil),
  );
}

export function buildMintQuoteMessage(
  programId: Address,
  deploymentId: Uint8Array,
  fields: MintQuoteFields,
): Uint8Array {
  if (deploymentId.length !== 32) throw new Error('deploymentId must contain 32 bytes');
  if (!Number.isInteger(fields.assignmentIndex) || fields.assignmentIndex < 0 || fields.assignmentIndex > 65_535) {
    throw new Error('assignmentIndex must fit in two bytes');
  }
  if (![fields.classIndex, fields.variantIndex].every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
    throw new Error('classIndex and variantIndex must fit in one byte');
  }
  return concat(
    MINT_QUOTE_DOMAIN,
    Uint8Array.from(addressEncoder.encode(programId)),
    deploymentId,
    Uint8Array.from(addressEncoder.encode(fields.owner)),
    Uint8Array.from(addressEncoder.encode(fields.asset)),
    u16(fields.assignmentIndex),
    Uint8Array.of(fields.classIndex, fields.variantIndex),
    Uint8Array.from(addressEncoder.encode(fields.fareMint)),
    u64(fields.amountFareRaw),
    u64(fields.priceUsdCents),
    i64(fields.expiresAt),
  );
}

export function normalizeKeyword(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ru-RU');
}

export function keywordHash(keyword: string, pepper: string): string {
  return createHmac('sha256', pepper).update(normalizeKeyword(keyword)).digest('hex');
}

export function keywordMatches(keyword: string, expectedHex: string, pepper: string): boolean {
  const actual = Buffer.from(keywordHash(keyword, pepper), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function randomU64(): bigint {
  return randomBytes(8).readBigUInt64LE();
}

function addressFromBytes(bytes: Uint8Array): Address {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = alphabet[remainder] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return address(encoded || '1');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function u16(value: number): Uint8Array {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value, true);
  return result;
}

function u64(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value, true);
  return result;
}

function i64(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigInt64(0, value, true);
  return result;
}
