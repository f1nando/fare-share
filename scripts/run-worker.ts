import { loadServerConfig } from '../server/config.js';
import { connectDatabase } from '../server/database.js';
import { createFeeAdminService } from '../server/feeAdmin.js';
import { performWorkerAction } from '../server/workerAutomation.js';
import { loadWorkerSettings, runWorkerAction } from '../server/workerControl.js';

const config = loadServerConfig();
const database = await connectDatabase(config.mongoUri, config.mongoDatabase);
if (!config.protocolAdminSecret || !config.pumpFeeRecipientSecret) {
  throw new Error('ADMIN_KEYPAIR_SECRET_KEY and PUMP_FEE_RECIPIENT_SECRET_KEY are required for full worker automation');
}
const feeAdmin = await createFeeAdminService({
  rpcUrl: config.solanaRpcUrl,
  programId: config.programId,
  adminSecret: config.protocolAdminSecret,
  feeRecipientSecret: config.pumpFeeRecipientSecret,
  cluster: config.solanaCluster,
  minimumWalletLamports: config.adminMinimumWalletLamports,
  workerIntervalMs: config.workerIntervalMs,
}, database.adminFeeActions, database.adminFeeOperations, database.tokenConfig, database.workerStatus);
const defaults = { enabled: false, intervalMs: config.workerIntervalMs, minimumLamports: config.swapMinimumLamports };

let stopping = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

while (!stopping) {
  const settings = await loadWorkerSettings(database.workerStatus, defaults);
  if (!settings.enabled && !process.argv.includes('--once')) {
    await database.workerStatus.updateOne({ key: 'protocol-worker', state: { $ne: 'running' } }, {
      $set: { state: 'disabled', updatedAt: new Date() }, $unset: { nextRunAt: '' },
    });
    await wait(5_000);
    continue;
  }
  const started = Date.now();
  try {
    await runWorkerAction(database.workerStatus, defaults, 'full', 'automatic', (active, runId) => (
      performWorkerAction('full', 'automatic', active, runId, feeAdmin)
    ));
  } catch (error) {
    console.error('Worker cycle failed:', error);
  }
  if (process.argv.includes('--once')) break;
  const current = await loadWorkerSettings(database.workerStatus, defaults);
  await wait(Math.max(0, current.intervalMs - (Date.now() - started)));
}

await database.client.close();

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
