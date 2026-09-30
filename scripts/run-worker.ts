import { loadServerConfig } from '../server/config.js';
import { connectDatabase } from '../server/database.js';
import { createFeeAdminService } from '../server/feeAdmin.js';
import { performWorkerAction } from '../server/workerAutomation.js';
import { loadWorkerSettings, runWorkerAction } from '../server/workerControl.js';
import { solanaRpcCall } from '../server/solanaRpc.js';
import { createTelegramAlertService, type TelegramAlertService } from '../server/telegramAlerts.js';

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
const REWARD_INTERVAL_MS = 60_000;
const telegram = config.telegramBotTokenFile
  ? await createTelegramAlertService(
      config.telegramBotTokenFile,
      database.telegramAlerts,
      database.telegramAlertStates,
      database.telegramAudit,
    )
  : undefined;

let stopping = false;
let lastFullCycleAt = 0;
let lastRewardCycleAt = 0;
let lastBackendHealthAt = 0;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

while (!stopping) {
  await telegramCall(telegram, service => service.pollAdminClaim());
  if (telegram && config.telegramBackendHealthUrl && Date.now() - lastBackendHealthAt >= 30_000) {
    lastBackendHealthAt = Date.now();
    try {
      const response = await fetch(config.telegramBackendHealthUrl, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await telegramCall(telegram, service => service.recovery('backend-health', 'Backend health endpoint is available again.'));
    } catch {
      await telegramCall(telegram, service => service.failure('backend-health', 'Backend health endpoint is unavailable.', 3));
    }
  }
  const settings = await loadWorkerSettings(database.workerStatus, defaults);
  if (!settings.enabled && !process.argv.includes('--once')) {
    await database.workerStatus.updateOne({ key: 'protocol-worker', state: { $ne: 'running' } }, {
      $set: { state: 'disabled', updatedAt: new Date() }, $unset: { nextRunAt: '' },
    });
    await wait(5_000);
    continue;
  }
  if (!process.argv.includes('--once')) {
    try {
      const balance = BigInt(await solanaRpcCall<number>(config.solanaRpcUrl, 'getBalance', [
        feeAdmin.payerAddress,
        { commitment: 'finalized' },
      ]));
      if (balance < config.adminMinimumWalletLamports) {
        const now = new Date();
        await database.workerStatus.updateOne({ key: 'protocol-worker' }, {
          $set: {
            enabled: false,
            state: 'disabled',
            error: `Worker disabled: payer balance ${balance} is below ${config.adminMinimumWalletLamports} lamports.`,
            lastErrorAt: now,
            updatedAt: now,
          },
          $unset: { nextRunAt: '' },
        });
        await telegramCall(telegram, service => service.failure(
          'low-sol',
          `Worker disabled because payer balance ${balance} is below ${config.adminMinimumWalletLamports} lamports.`,
        ));
        await wait(5_000);
        continue;
      }
      await telegramCall(telegram, service => service.recovery('balance-check', 'Worker payer balance checks are succeeding again.'));
      await telegramCall(telegram, service => service.recovery('low-sol', 'Worker payer balance is healthy again.'));
    } catch (error) {
      console.error('Worker balance check failed:', error);
      await telegramCall(telegram, service => service.failure('balance-check', 'Worker payer balance check failed.'));
      await wait(5_000);
      continue;
    }
  }
  const started = Date.now();
  const fullDue = process.argv.includes('--once') || started - lastFullCycleAt >= settings.intervalMs;
  const rewardsDue = started - lastRewardCycleAt >= REWARD_INTERVAL_MS;
  if (!fullDue && !rewardsDue) {
    const nextFullAt = lastFullCycleAt + settings.intervalMs;
    const nextRewardsAt = lastRewardCycleAt + REWARD_INTERVAL_MS;
    await database.workerStatus.updateOne({ key: 'protocol-worker', state: { $ne: 'running' } }, {
      $set: { nextRunAt: new Date(Math.min(nextFullAt, nextRewardsAt)), updatedAt: new Date() },
    });
    await wait(Math.max(1_000, Math.min(nextFullAt, nextRewardsAt) - started));
    continue;
  }
  const action = fullDue ? 'full' : 'rewards';
  try {
    await runWorkerAction(database.workerStatus, defaults, action, 'automatic', (active, runId) => (
      performWorkerAction(action, 'automatic', active, runId, feeAdmin)
    ));
    const finishedAt = Date.now();
    lastRewardCycleAt = finishedAt;
    if (action === 'full') lastFullCycleAt = finishedAt;
    if (action === 'full') {
      await telegramCall(telegram, service => service.recovery('worker-cycle', 'Full worker cycle is succeeding again.'));
      await telegramCall(telegram, service => service.recovery('worker-route', 'Worker swap and quote operations are succeeding again.'));
    }
  } catch (error) {
    console.error('Worker cycle failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    const routeFailure = /swap|quote|jupiter|route/i.test(message);
    await telegramCall(telegram, service => service.failure(
      routeFailure ? 'worker-route' : 'worker-cycle',
      routeFailure ? 'Worker swap or quote failed repeatedly. Check protected worker logs.' : 'Worker cycle failed. Check protected worker logs.',
      routeFailure ? 3 : 1,
    ));
    const failedAt = Date.now();
    lastRewardCycleAt = failedAt;
    if (action === 'full') lastFullCycleAt = failedAt;
  }
  if (process.argv.includes('--once')) break;
  await wait(1_000);
}

await database.client.close();

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function telegramCall(service: TelegramAlertService | undefined, call: (service: TelegramAlertService) => Promise<void>) {
  if (!service) return;
  try {
    await call(service);
  } catch (error) {
    console.error('Telegram alert operation failed:', error instanceof Error ? error.message : String(error));
  }
}
