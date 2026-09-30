import { createHash } from 'node:crypto';
import { address } from '@solana/kit';
import type { TaxiDatabase } from './database.js';
import type { ServerConfig } from './config.js';
import { loadProtocolClock } from './solanaState.js';
import {
  buildTraineeVoucherMessage,
  keywordHash,
  parseBackendSigner,
  randomU64,
  type VoucherArgs,
} from './signing.js';

const MAX_ATTEMPTS = 10;
const RATE_WINDOW_MS = 10 * 60 * 1_000;

export class VoucherError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function createVoucherService(config: ServerConfig, database: TaxiDatabase) {
  const signer = parseBackendSigner(config.signerSecret);

  return async function issueVoucher(input: unknown, remoteAddress: string) {
    const body = validateInput(input);
    await consumeRateLimit(database, `${remoteAddress}:${body.wallet}`);
    const campaign = await database.campaigns.findOne({ keywordHash: keywordHash(body.keyword, config.wordPepper), enabled: true });
    if (!campaign) {
      throw new VoucherError('Code word not found.', 403);
    }
    const clock = await loadProtocolClock(config.solanaRpcUrl, config.programId);
    if (clock.paused) throw new VoucherError('The protocol is temporarily paused.', 503);
    if (clock.backendSigner !== signer.publicKey) {
      throw new Error('BACKEND_SIGNER_SECRET_KEY does not match the on-chain backend signer');
    }

    const activeFrom = ((clock.protocolTime / 60n) + 1n) * 60n;
    const activeUntil = activeFrom + BigInt(campaign.durationMinutes * 60);
    const expiresAt = voucherExpiresAt(clock.chainTime, config.voucherTtlSeconds);
    const args: VoucherArgs = {
      campaignId: BigInt(campaign.campaignId),
      nonce: randomU64(),
      durationMinutes: campaign.durationMinutes,
      expiresAt,
      activeFrom,
      activeUntil,
      pageIndex: body.pageIndex,
    };
    const wallet = address(body.wallet);
    const message = buildTraineeVoucherMessage(config.programId, clock.deploymentId, wallet, args);
    const signature = signer.sign(message);

    await database.voucherIssues.insertOne({
      wallet: body.wallet,
      campaignId: campaign.campaignId,
      nonce: args.nonce.toString(),
      issuedAt: new Date(),
      expiresAt: new Date(Number(expiresAt) * 1_000),
    });

    return {
      wallet: body.wallet,
      backendSigner: signer.publicKey,
      message: Buffer.from(message).toString('base64'),
      signature: Buffer.from(signature).toString('base64'),
      args: {
        campaignId: args.campaignId.toString(),
        nonce: args.nonce.toString(),
        durationMinutes: args.durationMinutes,
        expiresAt: args.expiresAt.toString(),
        activeFrom: args.activeFrom.toString(),
        activeUntil: args.activeUntil.toString(),
        pageIndex: args.pageIndex,
      },
    };
  };
}

export function voucherExpiresAt(chainTime: bigint, ttlSeconds: number) {
  return chainTime + BigInt(ttlSeconds);
}

export async function consumeRateLimit(database: TaxiDatabase, identity: string) {
  const now = new Date();
  const key = createHash('sha256').update(identity).digest('hex');
  const expiresAt = new Date(now.getTime() + RATE_WINDOW_MS);
  await database.rateLimits.updateOne(
    { key, expiresAt: { $lte: now } },
    { $set: { attempts: 0, expiresAt } },
  );
  let result = await database.rateLimits.findOneAndUpdate(
    { key, attempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  );
  if (result) return;
  try {
    await database.rateLimits.insertOne({ key, attempts: 1, expiresAt });
    return;
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
  result = await database.rateLimits.findOneAndUpdate(
    { key, attempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  );
  if (!result) throw new VoucherError('Too many attempts. Try again later.', 429);
}

function isDuplicateKey(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

function validateInput(input: unknown) {
  if (!input || typeof input !== 'object') throw new VoucherError('Invalid JSON.', 400);
  const value = input as Record<string, unknown>;
  const wallet = String(value.wallet || '').trim();
  const keyword = String(value.keyword || '');
  const pageIndex = Number(value.pageIndex);
  try { address(wallet); } catch { throw new VoucherError('Invalid wallet address.', 400); }
  if (!keyword.trim() || keyword.length > 128) throw new VoucherError('Invalid code word.', 400);
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= 80) {
    throw new VoucherError('Invalid queue page.', 400);
  }
  return { wallet, keyword, pageIndex };
}
