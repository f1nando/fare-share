import { MongoClient, type Collection, type Db } from 'mongodb';
import type { DrivingSceneDocument } from './drivingScenes.js';
import type { TradeHolderDocument, TradeStateDocument, TradeTransactionDocument } from './trade.js';
import type { AdminLoginLimitDocument } from './adminAuth.js';
import type { TokenConfigDocument } from './tokenConfig.js';

export const FLEET_EARNING_RETENTION_SECONDS = 45 * 24 * 60 * 60;
export const ERROR_LOG_RETENTION_SECONDS = 30 * 24 * 60 * 60;

export interface ErrorLogDocument {
  errorId: string;
  source: 'server' | 'client';
  level: 'error' | 'warning';
  name: string;
  message: string;
  stack?: string;
  method?: string;
  path?: string;
  status?: number;
  context?: Record<string, string | number | boolean | null>;
  createdAt: Date;
  expiresAt: Date;
}

export interface CampaignDocument {
  campaignId: string;
  label: string;
  displayWord?: string;
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
  kind: 'claim' | 'deposit' | 'bind_mint' | 'reset_mint' | 'rescue_fare' | 'set_team' | 'pause' | 'unpause' | 'emergency_rescue';
  mint: string;
  amountLamports: string;
  signature: string;
  cluster: 'mainnet-beta' | 'devnet';
  slot?: number;
  bondingLamports?: string;
  ammLamports?: string;
  walletBalanceBefore?: string;
  walletBalanceAfter?: string;
  recipient?: string;
  rescuedTokens?: Array<{ mint: string; amount: string }>;
  createdAt: Date;
}

export interface AdminFeeOperationDocument {
  operationId: string;
  lock?: 'creator-fee-write' | 'fare-migration';
  kind: 'claim' | 'deposit' | 'replace_mint';
  mint: string;
  targetMint?: string;
  targetTicker?: string;
  cashOut?: boolean;
  amountLamports: string;
  status: 'executing' | 'submitted' | 'finalized' | 'failed';
  stage?: 'starting' | 'paused' | 'vaults-ready' | 'rescued' | 'sold' | 'unwrapping' | 'cashed-out' | 'bought' | 'reset' | 'unpaused';
  wasPaused?: boolean;
  oldTokenAmount?: string;
  oldWalletBalanceBefore?: string;
  wsolBalanceBefore?: string;
  wsolProceeds?: string;
  signatures?: Record<string, string>;
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

export interface WorkerStatusDocument {
  key: 'protocol-worker';
  state: 'running' | 'idle' | 'disabled' | 'error';
  enabled?: boolean;
  intervalMs?: number;
  minimumLamports?: string;
  currentAction?: string;
  runSource?: 'automatic' | 'manual';
  cycleStartedAt?: Date;
  lastSuccessAt?: Date;
  lastErrorAt?: Date;
  nextRunAt?: Date;
  error?: string;
  updatedAt: Date;
}

export interface TelegramAlertDocument {
  key: 'telegram-alerts';
  adminChatId?: string;
  updateOffset: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TelegramAlertStateDocument {
  key: string;
  failures: number;
  active: boolean;
  lastSentAt?: Date;
  updatedAt: Date;
}

export interface TelegramAuditDocument {
  action: 'claim' | 'clear';
  chatId?: string;
  createdAt: Date;
}

export interface RehearsalBudgetReservation {
  actionClass: 'ordinary' | 'recovery';
  fundingWallet: string;
  maximumDebitLamports: string;
  signature?: string;
  createdAt: Date;
}

export interface RehearsalBudgetEntry extends RehearsalBudgetReservation {
  reservationId: string;
  netDebitLamports: string;
  finalizedAt: Date;
}

export interface RehearsalBudgetDocument {
  key: 'disposable-rehearsal';
  ordinaryLimitLamports: number;
  hardLimitLamports: number;
  spentLamports: number;
  reservedLamports: number;
  reservations: Record<string, RehearsalBudgetReservation>;
  entries: RehearsalBudgetEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FleetMachineDocument {
  asset: string;
  machine: string;
  owner: string;
  name: string;
  image: string;
  className: string;
  classIndex: number;
  weight: number;
  activeUntil: string;
  rewardActive: boolean;
  closed: boolean;
  claimable: string[];
  pending: string[];
  fareBase: string;
  mintSignature?: string;
  mintedAt?: Date;
  lastSeenAt: Date;
  updatedAt: Date;
}

export interface FleetTraineeDocument {
  asset: string;
  trainee: string;
  owner: string;
  name: string;
  image: string;
  campaignId: string;
  activeFrom: string;
  activeUntil: string;
  lastSeenAt: Date;
  updatedAt: Date;
}

export interface PublicSnapshotDocument {
  key: 'overview';
  protocol: Record<string, unknown>;
  distribution: Record<string, unknown>;
  vaults: Record<string, unknown>;
  overview?: Record<string, unknown>;
  observedAt: Date;
  updatedAt: Date;
}

export interface FleetMintReceiptDocument {
  signature: string;
  asset: string;
  owner: string;
  slot: number;
  blockTime: Date;
  status: 'pending' | 'indexed';
  createdAt: Date;
  updatedAt: Date;
}

export interface FleetEarningSnapshotDocument {
  owner: string;
  bucketAt: Date;
  observedAt: Date;
  claimable: string[];
  cars: number;
  activeWeight: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketListingDocument {
  asset: string;
  seller: string;
  priceLamports: string;
  status: 'active' | 'cancelled';
  listedAt: Date;
  updatedAt: Date;
  transactionSignature?: string;
}

export interface MarketOfferDocument {
  offer: string;
  buyer: string;
  kind: 'asset' | 'class' | 'model';
  asset?: string;
  weight?: number;
  modelName?: string;
  priceLamports: string;
  status: 'active' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
  transactionSignature?: string;
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
  workerStatus: Collection<WorkerStatusDocument>;
  telegramAlerts: Collection<TelegramAlertDocument>;
  telegramAlertStates: Collection<TelegramAlertStateDocument>;
  telegramAudit: Collection<TelegramAuditDocument>;
  rehearsalBudget: Collection<RehearsalBudgetDocument>;
  fleetMachines: Collection<FleetMachineDocument>;
  fleetTrainees: Collection<FleetTraineeDocument>;
  publicSnapshots: Collection<PublicSnapshotDocument>;
  fleetMintReceipts: Collection<FleetMintReceiptDocument>;
  fleetEarningSnapshots: Collection<FleetEarningSnapshotDocument>;
  marketListings: Collection<MarketListingDocument>;
  marketOffers: Collection<MarketOfferDocument>;
  errorLogs: Collection<ErrorLogDocument>;
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
  const workerStatus = db.collection<WorkerStatusDocument>('worker_status');
  const telegramAlerts = db.collection<TelegramAlertDocument>('telegram_alerts');
  const telegramAlertStates = db.collection<TelegramAlertStateDocument>('telegram_alert_states');
  const telegramAudit = db.collection<TelegramAuditDocument>('telegram_alert_audit');
  const rehearsalBudget = db.collection<RehearsalBudgetDocument>('rehearsal_budget');
  const fleetMachines = db.collection<FleetMachineDocument>('fleet_machines');
  const fleetTrainees = db.collection<FleetTraineeDocument>('fleet_trainees');
  const publicSnapshots = db.collection<PublicSnapshotDocument>('public_snapshots');
  const fleetMintReceipts = db.collection<FleetMintReceiptDocument>('fleet_mint_receipts');
  const fleetEarningSnapshots = db.collection<FleetEarningSnapshotDocument>('fleet_earning_snapshots');
  const marketListings = db.collection<MarketListingDocument>('market_listings');
  const marketOffers = db.collection<MarketOfferDocument>('market_offers');
  const errorLogs = db.collection<ErrorLogDocument>('error_logs');
  await Promise.all([
    campaigns.createIndex({ campaignId: 1 }, { unique: true }),
    campaigns.createIndex({ keywordHash: 1 }, { unique: true }),
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
    workerStatus.createIndex({ key: 1 }, { unique: true }),
    telegramAlerts.createIndex({ key: 1 }, { unique: true }),
    telegramAlertStates.createIndex({ key: 1 }, { unique: true }),
    telegramAudit.createIndex({ createdAt: -1 }),
    rehearsalBudget.createIndex({ key: 1 }, { unique: true }),
    fleetMachines.createIndex({ asset: 1 }, { unique: true }),
    fleetMachines.createIndex({ owner: 1, closed: 1 }),
    fleetMachines.createIndex({ classIndex: 1, closed: 1 }),
    fleetMachines.createIndex({ mintSignature: 1 }, { unique: true, sparse: true }),
    fleetTrainees.createIndex({ asset: 1 }, { unique: true }),
    fleetTrainees.createIndex({ owner: 1, activeUntil: -1 }),
    publicSnapshots.createIndex({ key: 1 }, { unique: true }),
    fleetMintReceipts.createIndex({ signature: 1 }, { unique: true }),
    fleetMintReceipts.createIndex({ asset: 1, status: 1 }),
    fleetEarningSnapshots.createIndex({ owner: 1, bucketAt: 1 }, { unique: true }),
    fleetEarningSnapshots.createIndex({ bucketAt: 1 }),
    ensureFleetEarningRetention(fleetEarningSnapshots),
    marketListings.createIndex({ asset: 1 }, { unique: true }),
    marketListings.createIndex({ status: 1, listedAt: -1 }),
    marketOffers.createIndex({ offer: 1 }, { unique: true }),
    marketOffers.createIndex({ status: 1, updatedAt: -1 }),
    marketOffers.createIndex({ buyer: 1, status: 1 }),
    marketOffers.createIndex({ asset: 1, status: 1 }, { sparse: true }),
    marketOffers.createIndex({ weight: 1, status: 1 }, { sparse: true }),
    errorLogs.createIndex({ errorId: 1 }, { unique: true }),
    errorLogs.createIndex({ createdAt: -1 }),
    errorLogs.createIndex({ source: 1, status: 1, createdAt: -1 }),
    errorLogs.createIndex({ expiresAt: 1 }, { name: 'error_logs_ttl', expireAfterSeconds: 0 }),
  ]);
  return { client, db, campaigns, voucherIssues, rateLimits, drivingScenes, tradeTransactions, tradeHolders, tradeState, adminLoginLimits, adminFeeActions, adminFeeOperations, tokenConfig, workerStatus, telegramAlerts, telegramAlertStates, telegramAudit, rehearsalBudget, fleetMachines, fleetTrainees, publicSnapshots, fleetMintReceipts, fleetEarningSnapshots, marketListings, marketOffers, errorLogs };
}

export function ensureFleetEarningRetention(
  collection: Pick<Collection<FleetEarningSnapshotDocument>, 'createIndex'>,
) {
  return collection.createIndex(
    { observedAt: 1 },
    { name: 'earning_history_ttl', expireAfterSeconds: FLEET_EARNING_RETENTION_SECONDS },
  );
}
