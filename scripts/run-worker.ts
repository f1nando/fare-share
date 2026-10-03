import { loadServerConfig } from '../server/config.js';
import { connectDatabase } from '../server/database.js';
import { createFeeAdminService } from '../server/feeAdmin.js';
import { performWorkerAction } from '../server/workerAutomation.js';
import { loadWorkerSettings, runWorkerAction } from '../server/workerControl.js';
import { solanaRpcCall } from '../server/solanaRpc.js';
import { createTelegramAlertService, type TelegramAlertService } from '../server/telegramAlerts.js';
import { createRehearsalBudgetGuard, RehearsalBudgetError } from '../server/rehearsalBudget.js';
import { configureTransactionBudgetGuard } from '../server/transaction.js';

const config = loadServerConfig();
const database = await connectDatabase(config.mongoUri, config.mongoDatabase);
if (config.rehearsalMode) configureTransactionBudgetGuard(await createRehearsalBudgetGuard({
  rpcUrl: config.solanaRpcUrl,
  collection: database.rehearsalBudget,
  ordinaryLimitLamports: config.rehearsalOrdinaryBudgetLamports,
  hardLimitLamports: config.rehearsalHardBudgetLamports,
  transactionReserveLamports: config.rehearsalTransactionReserveLamports,
  initialSpentLamports: config.rehearsalInitialSpentLamports,
}));
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
const once = process.argv.includes('--once');
const manualOnce = once && process.argv.includes('--manual');
if (process.argv.includes('--manual') && !once) throw new Error('--manual requires --once');
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

if (manualOnce) console.log(`MANUAL_WORKER_BEFORE=${JSON.stringify(manualAudit(await feeAdmin.status()))}`);

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
  if (!settings.enabled && !once) {
    await database.workerStatus.updateOne({ key: 'protocol-worker', state: { $ne: 'running' } }, {
      $set: { state: 'disabled', updatedAt: new Date() }, $unset: { nextRunAt: '' },
    });
    await wait(5_000);
    continue;
  }
  if (!once) {
    try {
      const balanceResult = await solanaRpcCall<{ value: number }>(config.solanaRpcUrl, 'getBalance', [
        feeAdmin.payerAddress,
        { commitment: 'finalized' },
      ]);
      const balance = BigInt(balanceResult.value);
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
  const fullDue = once || started - lastFullCycleAt >= settings.intervalMs;
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
    const source = manualOnce ? 'manual' : 'automatic';
    const result = await runWorkerAction(database.workerStatus, defaults, action, source, (active, runId) => (
      performWorkerAction(action, source, active, runId, feeAdmin)
    ));
    if (once) console.log(`WORKER_ACTION_RESULT=${JSON.stringify(result)}`);
    const finishedAt = Date.now();
    lastRewardCycleAt = finishedAt;
    if (action === 'full') lastFullCycleAt = finishedAt;
    if (action === 'full') {
      await telegramCall(telegram, service => service.recovery('worker-cycle', 'Full worker cycle is succeeding again.'));
      await telegramCall(telegram, service => service.recovery('worker-route', 'Worker swap and quote operations are succeeding again.'));
    }
  } catch (error) {
    console.error('Worker cycle failed:', error);
    if (error instanceof RehearsalBudgetError) {
      await database.workerStatus.updateOne({ key: 'protocol-worker' }, {
        $set: { enabled: false, state: 'disabled', error: error.message, lastErrorAt: new Date(), updatedAt: new Date() },
        $unset: { nextRunAt: '' },
      });
    }
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
  if (once) break;
  await wait(1_000);
}

if (manualOnce) console.log(`MANUAL_WORKER_AFTER=${JSON.stringify(manualAudit(await feeAdmin.status()))}`);

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

function manualAudit(status: Awaited<ReturnType<typeof feeAdmin.status>>) {
  return {
    fees: {
      availableLamports: status.availableLamports,
      bondingLamports: status.bondingLamports,
      ammLamports: status.ammLamports,
      pendingUnwrapLamports: status.pendingUnwrapLamports,
    },
    protocol: {
      fareMint: status.dashboard.protocol.fareMint,
      paused: status.dashboard.protocol.paused,
      saleStarted: status.dashboard.protocol.saleStarted,
    },
    distribution: {
      activeWeight: status.dashboard.distribution.activeWeight,
      nextPool: status.dashboard.distribution.nextPool,
      obligations: status.dashboard.distribution.obligations,
      seriesRemaining: status.dashboard.distribution.seriesRemaining,
      seriesActive: status.dashboard.distribution.seriesActive,
    },
    vaults: status.dashboard.vaults,
  };
}
