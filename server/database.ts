import { MongoClient, type Collection, type Db } from 'mongodb';
import type { DrivingSceneDocument } from './drivingScenes.js';

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

export interface TaxiDatabase {
  client: MongoClient;
  db: Db;
  campaigns: Collection<CampaignDocument>;
  voucherIssues: Collection<VoucherIssueDocument>;
  rateLimits: Collection<RateLimitDocument>;
  drivingScenes: Collection<DrivingSceneDocument>;
}

export async function connectDatabase(uri: string, databaseName: string): Promise<TaxiDatabase> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  const db = client.db(databaseName);
  const campaigns = db.collection<CampaignDocument>('trainee_campaigns');
  const voucherIssues = db.collection<VoucherIssueDocument>('trainee_voucher_issues');
  const rateLimits = db.collection<RateLimitDocument>('trainee_rate_limits');
  const drivingScenes = db.collection<DrivingSceneDocument>('driving_scenes');
  await Promise.all([
    campaigns.createIndex({ campaignId: 1 }, { unique: true }),
    voucherIssues.createIndex({ wallet: 1, campaignId: 1, issuedAt: -1 }),
    rateLimits.createIndex({ key: 1 }, { unique: true }),
    rateLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    drivingScenes.createIndex({ updatedAt: -1 }),
  ]);
  return { client, db, campaigns, voucherIssues, rateLimits, drivingScenes };
}
