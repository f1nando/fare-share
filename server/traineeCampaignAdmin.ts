import type { TaxiDatabase } from './database.js';
import { keywordHash, normalizeKeyword } from './signing.js';
import { solanaRpcCall } from './solanaRpc.js';

const TRAINEE_ACCOUNT_SIZE = 90;
const CAMPAIGN_ID_OFFSET = 40;
const DEFAULT_DURATION_MINUTES = 360;
const MAX_U64 = (1n << 64n) - 1n;

export class TraineeCampaignAdminError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function createTraineeCampaignAdmin(
  config: { solanaRpcUrl: string; programId: string; wordPepper: string },
  database: TaxiDatabase,
) {
  async function ensurePrimary(wordValue: string) {
    const word = wordValue.normalize('NFKC').trim().replace(/^\$+/, '').toUpperCase();
    if (!word) throw new TraineeCampaignAdminError('Primary token ticker is required.');
    const now = new Date();
    await database.campaigns.updateOne(
      { campaignId: '1' },
      {
        $set: {
          label: word,
          displayWord: word,
          keywordHash: keywordHash(word, config.wordPepper),
          durationMinutes: DEFAULT_DURATION_MINUTES,
          enabled: true,
          updatedAt: now,
        },
        $setOnInsert: { campaignId: '1', createdAt: now },
      },
      { upsert: true },
    );
  }

  async function list() {
    const [campaigns, activations] = await Promise.all([
      database.campaigns.find({}).sort({ createdAt: -1 }).toArray(),
      loadActivationCounts(config.solanaRpcUrl, config.programId),
    ]);
    return campaigns.map(campaign => ({
      word: campaign.displayWord || campaign.label,
      durationMinutes: campaign.durationMinutes,
      enabled: campaign.enabled,
      activationCount: activations.get(campaign.campaignId) || 0,
      createdAt: campaign.createdAt,
    }));
  }

  async function create(input: unknown) {
    const word = validateWord(input);
    const normalized = normalizeKeyword(word);
    const hash = keywordHash(word, config.wordPepper);
    if (await database.campaigns.findOne({ keywordHash: hash })) {
      throw new TraineeCampaignAdminError('This code word already exists.', 409);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const campaignId = await nextCampaignId(database);
      const now = new Date();
      try {
        await database.campaigns.insertOne({
          campaignId,
          label: word,
          displayWord: word,
          keywordHash: hash,
          durationMinutes: DEFAULT_DURATION_MINUTES,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
        return { word, durationMinutes: DEFAULT_DURATION_MINUTES, enabled: true, activationCount: 0, createdAt: now };
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        if (await database.campaigns.findOne({ keywordHash: hash })) {
          throw new TraineeCampaignAdminError('This code word already exists.', 409);
        }
        if (attempt === 2) throw error;
      }
    }
    throw new Error(`Could not create ${normalized}`);
  }

  return { list, create, ensurePrimary };
}

export async function loadActivationCounts(rpcUrl: string, programId: string, fetchImplementation?: typeof fetch) {
  const accounts = await solanaRpcCall<Array<{ account: { data: [string, string] } }>>(rpcUrl, 'getProgramAccounts', [
    programId,
    {
      commitment: 'finalized',
      encoding: 'base64',
      filters: [{ dataSize: TRAINEE_ACCOUNT_SIZE }],
      dataSlice: { offset: CAMPAIGN_ID_OFFSET, length: 8 },
    },
  ], { fetchImplementation });
  const counts = new Map<string, number>();
  for (const item of accounts) {
    const bytes = Buffer.from(item.account.data[0], 'base64');
    if (bytes.length !== 8) continue;
    const campaignId = bytes.readBigUInt64LE().toString();
    counts.set(campaignId, (counts.get(campaignId) || 0) + 1);
  }
  return counts;
}

async function nextCampaignId(database: TaxiDatabase) {
  const campaigns = await database.campaigns.find({}, { projection: { campaignId: 1 } }).toArray();
  const maximum = campaigns.reduce((value, campaign) => {
    const current = BigInt(campaign.campaignId);
    return current > value ? current : value;
  }, 0n);
  if (maximum >= MAX_U64) throw new TraineeCampaignAdminError('No campaign IDs remain.', 409);
  return (maximum + 1n).toString();
}

function validateWord(input: unknown) {
  if (!input || typeof input !== 'object') throw new TraineeCampaignAdminError('JSON object is required.');
  const word = String((input as Record<string, unknown>).word || '').normalize('NFKC').trim();
  if (!word || word.length > 128) throw new TraineeCampaignAdminError('Enter a code word with no more than 128 characters.');
  return word;
}

function isDuplicateKey(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
