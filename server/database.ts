import { MongoClient, type Collection, type Db } from 'mongodb';
import type { DrivingSceneDocument } from './drivingScenes.js';
import type { TradeHolderDocument, TradeStateDocument, TradeTransactionDocument } from './trade.js';
import type { AdminLoginLimitDocument } from './adminAuth.js';
import type { TokenConfigDocument } from './tokenConfig.js';

export interface CampaignDocument {
  campaignId: string;
  label: string;
  keywordHash: string;
  durationMinutes: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VoucherIssueDocument {
  wallet: string;
  campaignId: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface RateLimitDocument {
  key: string;
  attempts: number;
  expiresAt: Date;
}

export interface AdminFeeActionDocument {
  kind: 'claim' | 'deposit' | 'bind_mint';
  mint: string;
  amountLamports: string;
  signature: string;
  cluster: 'mainnet-beta' | 'devnet';
  slot?: number;
  bondingLamports?: string;
  ammLamports?: string;
  walletBalanceBefore?: string;
  walletBalanceAfter?: string;
  createdAt: Date;
}

export interface AdminFeeOperationDocument {
  operationId: string;
  lock?: 'creator-fee-write';
  kind: 'claim' | 'deposit';
  mint: string;
  amountLamports: string;
  status: 'executing' | 'submitted' | 'finalized' | 'failed';
  signature?: string;
  slot?: number;
  lastValidBlockHeight?: number;
  bondingLamports?: string;
  ammLamports?: string;
  pendingUnwrapLamports?: string;
  walletBalanceBefore?: string;
  walletBalanceAfter?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaxiDatabase {
  client: MongoClient;
  db: Db;
  campaigns: Collection<CampaignDocument>;
  voucherIssues: Collection<VoucherIssueDocument>;
  rateLimits: Collection<RateLimitDocument>;
  drivingScenes: Collection<DrivingSceneDocument>;
  tradeTransactions: Collection<TradeTransactionDocument>;
  tradeHolders: Collection<TradeHolderDocument>;
  tradeState: Collection<TradeStateDocument>;
  adminLoginLimits: Collection<AdminLoginLimitDocument>;
  adminFeeActions: Collection<AdminFeeActionDocument>;
  adminFeeOperations: Collection<AdminFeeOperationDocument>;
  tokenConfig: Collection<TokenConfigDocument>;
}

export async function connectDatabase(uri: string, databaseName: string): Promise<TaxiDatabase> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  const db = client.db(databaseName);
  const campaigns = db.collection<CampaignDocument>('trainee_campaigns');
  const voucherIssues = db.collection<VoucherIssueDocument>('trainee_voucher_issues');
  const rateLimits = db.collection<RateLimitDocument>('trainee_rate_limits');
  const drivingScenes = db.collection<DrivingSceneDocument>('driving_scenes');
  const tradeTransactions = db.collection<TradeTransactionDocument>('trade_transactions');
  const tradeHolders = db.collection<TradeHolderDocument>('trade_holders');
  const tradeState = db.collection<TradeStateDocument>('trade_state');
  const adminLoginLimits = db.collection<AdminLoginLimitDocument>('admin_login_limits');
  const adminFeeActions = db.collection<AdminFeeActionDocument>('admin_fee_actions');
  const adminFeeOperations = db.collection<AdminFeeOperationDocument>('admin_fee_operations');
  const tokenConfig = db.collection<TokenConfigDocument>('token_config');
  await Promise.all([
    campaigns.createIndex({ campaignId: 1 }, { unique: true }),
    voucherIssues.createIndex({ wallet: 1, campaignId: 1, issuedAt: -1 }),
    rateLimits.createIndex({ key: 1 }, { unique: true }),
    rateLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    drivingScenes.createIndex({ updatedAt: -1 }),
    tradeTransactions.createIndex({ mint: 1, signature: 1 }, { unique: true }),
    tradeTransactions.createIndex({ mint: 1, blockTime: -1 }),
    tradeTransactions.createIndex({ mint: 1, wallet: 1, blockTime: -1 }),
    tradeHolders.createIndex({ mint: 1, owner: 1 }, { unique: true }),
    tradeHolders.createIndex({ mint: 1, balance: -1 }),
    tradeState.createIndex({ mint: 1 }, { unique: true }),
    adminLoginLimits.createIndex({ key: 1 }, { unique: true }),
    adminLoginLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    adminFeeActions.createIndex({ createdAt: -1 }),
    adminFeeActions.createIndex({ signature: 1 }, { unique: true }),
    adminFeeOperations.createIndex({ operationId: 1 }, { unique: true }),
    adminFeeOperations.createIndex({ lock: 1 }, { unique: true, sparse: true }),
    adminFeeOperations.createIndex({ updatedAt: 1 }),
    tokenConfig.createIndex({ key: 1 }, { unique: true }),
  ]);
  return { client, db, campaigns, voucherIssues, rateLimits, drivingScenes, tradeTransactions, tradeHolders, tradeState, adminLoginLimits, adminFeeActions, adminFeeOperations, tokenConfig };
}
