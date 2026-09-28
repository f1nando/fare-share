import { address } from '@solana/kit';

const DEFAULT_PROGRAM_ID = '9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv';

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

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = integer(name, fallback, minimum);
  if (value > maximum) throw new Error(`${name} must be <= ${maximum}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export type ServerConfig = ReturnType<typeof loadServerConfig>;

export function loadServerConfig() {
  const programId = address(process.env.TAXI_PROGRAM_ID?.trim() || DEFAULT_PROGRAM_ID);
  return {
    port: integer('PORT', 8787, 1),
    mongoUri: required('MONGODB_URI'),
    mongoDatabase: process.env.MONGODB_DATABASE?.trim() || 'taxi_park',
    solanaRpcUrl: process.env.SOLANA_RPC_URL?.trim() || 'https://api.devnet.solana.com',
    heliusApiKey: optional('HELIUS_API_KEY'),
    tradeMint: optional('TRADE_MINT') || optional('FARE_MINT'),
    tradePollIntervalMs: integer('TRADE_POLL_INTERVAL_MS', 10_000, 1_000),
    tradeHolderRefreshMs: integer('TRADE_HOLDER_REFRESH_MS', 30_000, 10_000),
    tradeStateRefreshMs: integer('TRADE_STATE_REFRESH_MS', 60_000, 5_000),
    programId,
    signerSecret: required('BACKEND_SIGNER_SECRET_KEY'),
    workerSecret: optional('WORKER_KEYPAIR_SECRET_KEY'),
    wordPepper: required('TRAINEE_WORD_PEPPER'),
    voucherTtlSeconds: integer('VOUCHER_TTL_SECONDS', 180, 30),
    allowedOrigin: process.env.ALLOWED_ORIGIN?.trim() || 'http://localhost:5173',
    trustProxy: process.env.TRUST_PROXY === 'true',
    jupiterApiKey: optional('JUPITER_API_KEY'),
    jupiterRequestsPerSecond: boundedInteger('JUPITER_REQUESTS_PER_SECOND', 5, 1, 5),
    solanaRpcMaxRequestsPerSecond: boundedInteger('SOLANA_RPC_MAX_REQUESTS_PER_SECOND', 20, 1, 20),
    solanaSendTransactionMaxRequestsPerSecond: boundedInteger('SOLANA_SEND_TRANSACTION_MAX_REQUESTS_PER_SECOND', 2, 1, 2),
    solanaDasMaxRequestsPerSecond: boundedInteger('SOLANA_DAS_MAX_REQUESTS_PER_SECOND', 10, 1, 10),
    swapMinimumLamports: BigInt(integer('SWAP_MINIMUM_LAMPORTS', 1_000_000, 1)),
    swapSlippageBps: boundedInteger('SWAP_SLIPPAGE_BPS', 500, 1, 10_000),
    swapPlanTtlSeconds: integer('SWAP_PLAN_TTL_SECONDS', 600, 30),
    jupiterMaxAccounts: boundedInteger('JUPITER_MAX_ACCOUNTS', 48, 1, 64),
    burnScanIntervalMs: integer('BURN_SCAN_INTERVAL_MS', 300_000, 60_000),
    burnCleanupLimit: boundedInteger('BURN_CLEANUP_LIMIT', 10, 1, 50),
  };
}
