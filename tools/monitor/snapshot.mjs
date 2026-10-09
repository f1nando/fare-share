// Read-only production probe. Never sends transactions or changes worker settings.
import { MongoClient } from 'mongodb';
import { execFileSync } from 'node:child_process';

const active = name => {
  try { return execFileSync('systemctl', ['is-active', name], { encoding: 'utf8', timeout: 3_000 }).trim() === 'active'; }
  catch { return false; }
};
const snapshot = { database: false, rpc: false, backendActive: active('ownataxi-backend'), workerActive: active('ownataxi-worker'),
  minimumLamports: process.env.ADMIN_MINIMUM_WALLET_LAMPORTS || '100000000', recentErrors: 0 };
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000, connectTimeoutMS: 5_000, timeoutMS: 5_000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DATABASE || 'taxi_park');
  await db.command({ ping: 1 });
  snapshot.database = true;
  const worker = await db.collection('worker_status').findOne({ key: 'protocol-worker' });
  if (worker) snapshot.worker = Object.fromEntries(['state', 'enabled', 'intervalMs', 'cycleStartedAt', 'lastSuccessAt', 'updatedAt'].map(key => [key, worker[key]]));
  snapshot.recentErrors = await db.collection('error_logs').countDocuments({ createdAt: { $gte: new Date(Date.now() - 300_000) } });
} catch { /* Only report sanitized health booleans, never credentials or payloads. */ }
finally { await client.close(); }
try {
  const rpc = async (method, params) => {
    const response = await fetch(process.env.SOLANA_RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(5_000) });
    const body = await response.json();
    if (!response.ok || body.error || body.result === undefined) throw new Error('RPC unavailable');
    return body.result;
  };
  await rpc('getSlot', [{ commitment: 'finalized' }]);
  const payer = process.env.MONITOR_PAYER_ADDRESS;
  if (!payer) throw new Error('Monitor payer address must be explicit');
  snapshot.balanceLamports = String((await rpc('getBalance', [payer, { commitment: 'finalized' }])).value);
  snapshot.rpc = true;
} catch { /* No raw RPC errors in output. */ }
snapshot.diskUsedPercent = Number(execFileSync('df', ['--output=pcent', '/'], { encoding: 'utf8', timeout: 3_000 }).trim().split('\n').at(-1).trim().replace('%', ''));
console.log(JSON.stringify(snapshot));
