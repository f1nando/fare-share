import { runWorkerCycle, type WorkerCycleStep } from './worker.js';
import type { WorkerAction, WorkerSettings } from './workerControl.js';

interface CreatorFeeService {
  creatorFeeSnapshot(): Promise<{ availableLamports: string }>;
  claim(operationId: string): Promise<{ amountLamports: string; signature: string }>;
  deposit(amountLamports: string, operationId: string): Promise<{ amountLamports: string; signature: string }>;
}

export async function performWorkerAction(
  action: WorkerAction,
  source: 'automatic' | 'manual',
  settings: WorkerSettings,
  runId: string,
  fees: CreatorFeeService,
) {
  const threshold = source === 'manual' ? 1n : settings.minimumLamports;
  let creatorFees: { skipped: boolean; amountLamports?: string; claimSignature?: string; depositSignature?: string } | undefined;
  if (action === 'creator-fees' || action === 'full') {
    const snapshot = await fees.creatorFeeSnapshot();
    const available = BigInt(snapshot.availableLamports);
    if (available >= threshold) {
      const claimed = await fees.claim(`worker_${runId}_claim`);
      const deposited = await fees.deposit(claimed.amountLamports, `worker_${runId}_deposit`);
      creatorFees = {
        skipped: false,
        amountLamports: claimed.amountLamports,
        claimSignature: claimed.signature,
        depositSignature: deposited.signature,
      };
    } else {
      creatorFees = { skipped: true, amountLamports: available.toString() };
    }
  }

  const steps: WorkerCycleStep[] = action === 'full'
    ? ['contract-fees', 'swaps', 'rewards']
    : action === 'contract-fees' || action === 'swaps' || action === 'rewards' ? [action] : [];
  if (steps.length > 0) await runWorkerCycle({ steps, minimumLamports: threshold });
  return { creatorFees, steps };
}
