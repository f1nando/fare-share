import { runWorkerCycle } from '../server/worker.js';
import { loadServerConfig } from '../server/config.js';
import { connectDatabase } from '../server/database.js';

const config = loadServerConfig();
const interval = config.workerIntervalMs;
const database = await connectDatabase(config.mongoUri, config.mongoDatabase);

let stopping = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

do {
  const started = Date.now();
  await database.workerStatus.updateOne({ key: 'protocol-worker' }, { $set: {
    state: 'running', cycleStartedAt: new Date(started), updatedAt: new Date(),
  }, $unset: { error: '', nextRunAt: '' } }, { upsert: true });
  try {
    await runWorkerCycle();
    const nextRunAt = new Date(started + Math.max(interval, Date.now() - started));
    await database.workerStatus.updateOne({ key: 'protocol-worker' }, { $set: {
      state: 'idle', lastSuccessAt: new Date(), nextRunAt, updatedAt: new Date(),
    }, $unset: { error: '' } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
    console.error('Worker cycle failed:', error);
    await database.workerStatus.updateOne({ key: 'protocol-worker' }, { $set: {
      state: 'error', error: message, lastErrorAt: new Date(), nextRunAt: new Date(started + interval), updatedAt: new Date(),
    } });
  }
  if (process.argv.includes('--once')) break;
  const remaining = Math.max(0, interval - (Date.now() - started));
  await new Promise(resolve => setTimeout(resolve, remaining));
} while (!stopping);

await database.client.close();
