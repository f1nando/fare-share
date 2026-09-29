import { address, type Address } from '@solana/kit';
import type { Collection } from 'mongodb';
import { solanaRpcCall } from './solanaRpc.js';
import { decodeWorkerConfiguration } from './solanaState.js';
import { protocolAddresses } from './setup.js';

const PRIMARY_TOKEN_KEY = 'primary';
const ZERO_ADDRESS = '11111111111111111111111111111111';

export interface TokenConfigDocument {
  key: typeof PRIMARY_TOKEN_KEY;
  mint: string;
  ticker: string;
  bindSignature: string;
  updatedAt: Date;
}

export interface PublicTokenConfig {
  configured: boolean;
  mint: string | null;
  ticker: string | null;
}

export function normalizeTicker(value: unknown) {
  if (typeof value !== 'string') throw new Error('Ticker is required.');
  const ticker = value.trim().replace(/^\$+/, '').toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(ticker)) {
    throw new Error('Ticker must contain 1–10 Latin letters or digits.');
  }
  return ticker;
}

export async function savePrimaryTokenConfig(
  collection: Collection<TokenConfigDocument>,
  mint: Address,
  ticker: string,
  bindSignature: string,
) {
  const document: TokenConfigDocument = {
    key: PRIMARY_TOKEN_KEY,
    mint: String(mint),
    ticker: normalizeTicker(ticker),
    bindSignature,
    updatedAt: new Date(),
  };
  await collection.updateOne({ key: PRIMARY_TOKEN_KEY }, { $set: document }, { upsert: true });
  return document;
}

export async function loadPublicTokenConfig(
  rpcUrl: string,
  programId: Address,
  collection: Collection<TokenConfigDocument>,
): Promise<PublicTokenConfig> {
  const addresses = await protocolAddresses(programId);
  const result = await solanaRpcCall<{ value: { data: [string, string] } | null }>(rpcUrl, 'getAccountInfo', [
    addresses.config,
    { commitment: 'finalized', encoding: 'base64' },
  ]);
  if (!result.value) return { configured: false, mint: null, ticker: null };
  const configuration = decodeWorkerConfiguration(Uint8Array.from(Buffer.from(result.value.data[0], 'base64')));
  if (String(configuration.fareMint) === ZERO_ADDRESS) return { configured: false, mint: null, ticker: null };
  const stored = await collection.findOne({ key: PRIMARY_TOKEN_KEY });
  if (!stored || stored.mint !== String(configuration.fareMint)) return { configured: false, mint: null, ticker: null };
  return { configured: true, mint: stored.mint, ticker: stored.ticker };
}

export function tokenConfigFromDocument(document: TokenConfigDocument | null): PublicTokenConfig {
  if (!document) return { configured: false, mint: null, ticker: null };
  return { configured: true, mint: document.mint, ticker: document.ticker };
}
