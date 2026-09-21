import { address } from '@solana/kit';

const DEFAULT_PROGRAM_ID = '7SpHocA8dThiUTfkv9iv63bhJnzWysk2bFgKbT4WKwnY';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function integer(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

export type ServerConfig = ReturnType<typeof loadServerConfig>;

export function loadServerConfig() {
  const programId = address(process.env.TAXI_PROGRAM_ID?.trim() || DEFAULT_PROGRAM_ID);
  return {
    port: integer('PORT', 8787, 1),
    mongoUri: required('MONGODB_URI'),
    mongoDatabase: process.env.MONGODB_DATABASE?.trim() || 'taxi_park',
    solanaRpcUrl: process.env.SOLANA_RPC_URL?.trim() || 'https://api.devnet.solana.com',
    programId,
    signerSecret: required('BACKEND_SIGNER_SECRET_KEY'),
    wordPepper: required('TRAINEE_WORD_PEPPER'),
    voucherTtlSeconds: integer('VOUCHER_TTL_SECONDS', 180, 30),
    allowedOrigin: process.env.ALLOWED_ORIGIN?.trim() || 'http://localhost:5173',
    trustProxy: process.env.TRUST_PROXY === 'true',
  };
}
