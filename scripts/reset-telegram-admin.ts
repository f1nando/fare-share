import { loadServerConfig } from '../server/config.js';
import { connectDatabase } from '../server/database.js';

const config = loadServerConfig();
const database = await connectDatabase(config.mongoUri, config.mongoDatabase);
const clearedAt = new Date();
const result = await database.telegramAlerts.updateOne(
  { key: 'telegram-alerts', adminChatId: { $exists: true } },
  { $unset: { adminChatId: '' }, $set: { updatedAt: clearedAt } },
);
if (result.modifiedCount) await database.telegramAudit.insertOne({ action: 'clear', createdAt: clearedAt });
await database.client.close();
console.log(result.modifiedCount ? 'Telegram alert administrator cleared.' : 'Telegram alert administrator was not configured.');
