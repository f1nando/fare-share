import { connectDatabase } from '../server/database.js';
import { keywordHash } from '../server/signing.js';

const [campaignId, durationRaw, keyword, ...labelParts] = process.argv.slice(2);
const durationMinutes = Number(durationRaw);
if (!/^\d{1,20}$/.test(campaignId || '') || !Number.isInteger(durationMinutes)
  || durationMinutes < 60 || durationMinutes > 10_080 || !keyword) {
  console.error('Usage: npm run campaign:create -- <campaignId> <durationMinutes 60..10080> <keyword> [label]');
  process.exit(1);
}
const mongoUri = process.env.MONGODB_URI?.trim();
const pepper = process.env.TRAINEE_WORD_PEPPER?.trim();
if (!mongoUri || !pepper) throw new Error('MONGODB_URI and TRAINEE_WORD_PEPPER are required');
const database = await connectDatabase(mongoUri, process.env.MONGODB_DATABASE || 'taxi_park');
const now = new Date();
await database.campaigns.updateOne(
  { campaignId },
  {
    $set: {
      label: labelParts.join(' ') || `Campaign ${campaignId}`,
      displayWord: keyword.normalize('NFKC').trim(),
      keywordHash: keywordHash(keyword, pepper),
      durationMinutes,
      enabled: true,
      updatedAt: now,
    },
    $setOnInsert: { createdAt: now },
  },
  { upsert: true },
);
await database.client.close();
console.log(`Campaign ${campaignId} saved (${durationMinutes} minutes).`);
