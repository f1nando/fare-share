import { runWorkerCycle } from '../server/worker.js';

const interval = Number(process.env.WORKER_INTERVAL_MS || 60_000);
if (!Number.isSafeInteger(interval) || interval < 10_000) {
  throw new Error('WORKER_INTERVAL_MS must be an integer of at least 10000');
}

let stopping = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

do {
  const started = Date.now();
  try { await runWorkerCycle(); }
  catch (error) { console.error('Worker cycle failed:', error); }
  if (process.argv.includes('--once')) break;
  const remaining = Math.max(0, interval - (Date.now() - started));
  await new Promise(resolve => setTimeout(resolve, remaining));
} while (!stopping);
