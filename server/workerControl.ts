import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { WorkerStatusDocument } from './database.js';

export const WORKER_ACTIONS = ['creator-fees', 'contract-fees', 'swaps', 'rewards', 'full'] as const;
export type WorkerAction = typeof WORKER_ACTIONS[number];

export interface WorkerSettings {
  enabled: boolean;
  intervalMs: number;
  minimumLamports: bigint;
}

const MIN_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 24 * 60 * 60_000;
const MAX_MINIMUM_LAMPORTS = 1_000_000_000_000n;
const STALE_RUN_MS = 30 * 60_000;

export class WorkerControlError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'WorkerControlError';
  }
}

export async function loadWorkerSettings(
  collection: Collection<WorkerStatusDocument>,
  defaults: WorkerSettings,
): Promise<WorkerSettings> {
  const now = new Date();
  await collection.updateOne(
    { key: 'protocol-worker' },
    { $setOnInsert: {
      key: 'protocol-worker', state: defaults.enabled ? 'idle' : 'disabled', enabled: defaults.enabled,
      intervalMs: defaults.intervalMs, minimumLamports: defaults.minimumLamports.toString(), updatedAt: now,
    } },
    { upsert: true },
  );
  const document = await collection.findOne({ key: 'protocol-worker' });
  return settingsFromDocument(document, defaults);
}

export async function updateWorkerSettings(
  collection: Collection<WorkerStatusDocument>,
  input: Record<string, unknown>,
  defaults: WorkerSettings,
) {
  const current = await loadWorkerSettings(collection, defaults);
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : current.enabled;
  const intervalMs = input.intervalSeconds === undefined
    ? current.intervalMs
    : boundedInteger(input.intervalSeconds, 'Frequency', 10, 86_400) * 1_000;
  const minimumLamports = input.minimumLamports === undefined
    ? current.minimumLamports
    : rawLamports(input.minimumLamports);
  const now = new Date();
  await collection.updateOne({ key: 'protocol-worker' }, {
    $set: { enabled, intervalMs, minimumLamports: minimumLamports.toString(), updatedAt: now },
    ...(enabled ? {} : { $unset: { nextRunAt: '' } }),
  });
  const document = await collection.findOne({ key: 'protocol-worker' });
  if (document?.state !== 'running') {
    await collection.updateOne({ key: 'protocol-worker' }, { $set: { state: enabled ? 'idle' : 'disabled', updatedAt: now } });
  }
  return publicWorkerSettings({ enabled, intervalMs, minimumLamports });
}

export async function runWorkerAction<T>(
  collection: Collection<WorkerStatusDocument>,
  defaults: WorkerSettings,
  action: WorkerAction,
  source: 'automatic' | 'manual',
  execute: (settings: WorkerSettings, runId: string) => Promise<T>,
) {
  if (!WORKER_ACTIONS.includes(action)) throw new WorkerControlError('Unknown worker action.');
  const settings = await loadWorkerSettings(collection, defaults);
  const startedAt = new Date();
  const acquired = await collection.findOneAndUpdate(
    {
      key: 'protocol-worker',
      $or: [
        { state: { $ne: 'running' } },
        { cycleStartedAt: { $lt: new Date(startedAt.getTime() - STALE_RUN_MS) } },
      ],
    },
    { $set: {
      state: 'running', currentAction: action, runSource: source, cycleStartedAt: startedAt, updatedAt: startedAt,
    }, $unset: { error: '', nextRunAt: '' } },
    { returnDocument: 'after' },
  );
  if (!acquired) throw new WorkerControlError('Another worker action is already running.', 409);
  const runId = randomUUID();
  try {
    const result = await execute(settings, runId);
    const finishedAt = new Date();
    const finalSettings = await loadWorkerSettings(collection, defaults);
    const nextRunAt = finalSettings.enabled ? new Date(finishedAt.getTime() + finalSettings.intervalMs) : undefined;
    await collection.updateOne({ key: 'protocol-worker', cycleStartedAt: startedAt }, {
      $set: {
        state: finalSettings.enabled ? 'idle' : 'disabled', lastSuccessAt: finishedAt,
        ...(nextRunAt ? { nextRunAt } : {}), updatedAt: finishedAt,
      },
      $unset: { error: '', currentAction: '', runSource: '', cycleStartedAt: '', ...(nextRunAt ? {} : { nextRunAt: '' }) },
    });
    return { action, source, completedAt: finishedAt, result };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
    const failedAt = new Date();
    await collection.updateOne({ key: 'protocol-worker', cycleStartedAt: startedAt }, {
      $set: { state: 'error', error: message, lastErrorAt: failedAt, updatedAt: failedAt },
      $unset: { currentAction: '', runSource: '', cycleStartedAt: '', nextRunAt: '' },
    });
    throw error;
  }
}

export function publicWorkerSettings(settings: WorkerSettings) {
  return {
    enabled: settings.enabled,
    intervalSeconds: settings.intervalMs / 1_000,
    minimumLamports: settings.minimumLamports.toString(),
  };
}

export function parseWorkerAction(value: unknown): WorkerAction {
  if (typeof value !== 'string' || !WORKER_ACTIONS.includes(value as WorkerAction)) throw new WorkerControlError('Unknown worker action.');
  return value as WorkerAction;
}

function settingsFromDocument(document: WorkerStatusDocument | null, defaults: WorkerSettings): WorkerSettings {
  const intervalMs = document?.intervalMs ?? defaults.intervalMs;
  const minimumLamports = document?.minimumLamports ? BigInt(document.minimumLamports) : defaults.minimumLamports;
  return {
    enabled: document?.enabled ?? defaults.enabled,
    intervalMs: Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, intervalMs)),
    minimumLamports: minimumLamports > MAX_MINIMUM_LAMPORTS ? MAX_MINIMUM_LAMPORTS : minimumLamports,
  };
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new WorkerControlError(`${name} must be between ${minimum} and ${maximum} seconds.`);
  }
  return number;
}

function rawLamports(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new WorkerControlError('Minimum amount must be a raw lamport string.');
  const amount = BigInt(value);
  if (amount > MAX_MINIMUM_LAMPORTS) throw new WorkerControlError('Minimum amount cannot exceed 1000 SOL.');
  return amount;
}
