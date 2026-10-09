import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MongoClient } from 'mongodb';
import { privateChatId, snapshotChecks, transition } from './checks.mjs';
import { measureHttpCheck } from './http-check.mjs';

const exec = promisify(execFile);
const token = (await readFile(process.env.TELEGRAM_BOT_TOKEN_FILE, 'utf8')).trim();
if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('Invalid bot token file');
const origin = new URL(process.env.MONITOR_SITE_URL || 'https://ownataxi.com');
if (origin.protocol !== 'https:') throw new Error('Monitor requires HTTPS');
const client = new MongoClient(process.env.MONITOR_MONGODB_URI || 'mongodb://127.0.0.1:27017', {
  serverSelectionTimeoutMS: 5_000, connectTimeoutMS: 5_000, timeoutMS: 5_000,
});
await client.connect();
const db = client.db('ownataxi_monitor');
const recipients = db.collection('recipients');
const storedStates = db.collection('states');
await recipients.updateOne({ _id: 'admin' }, { $setOnInsert: { offset: 0 } }, { upsert: true });
let recipient = await recipients.findOne({ _id: 'admin' });
// Retire the old combined counter without erasing its persisted history.
const states = new Map((await storedStates.find().toArray()).filter(state => state.key !== 'runtime-errors').map(state => [state.key, state]));
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram request failed');
  return result.result;
}
async function send(text, chatId = recipient?.chatId) {
  if (!chatId) return false;
  await telegram('sendMessage', { chat_id: chatId, text: text.slice(0, 4_000), disable_web_page_preview: true });
  return true;
}
function statusText() {
  const current = [...states.values()];
  const unhealthy = current.some(s => s.ok === false);
  const unknown = !current.length || current.some(s => s.ok === null || Date.now() - s.checkedAt > 90_000);
  const summary = unhealthy ? '🔴 Problems detected' : unknown ? '🟡 Available checks pass; some checks cannot be verified' : '🟢 All checks passed';
  const lines = current.map(s => `${Date.now() - s.checkedAt > 90_000 ? '🟡 STALE' : s.ok === null ? '🟡 WARN' : s.ok ? '🟢 OK' : '🔴 FAIL'} | ${s.key}: ${s.detail}`);
  return `Own a Taxi monitoring\n${summary}\nIndependent observer: bkserv\n${new Date().toISOString()}\n\n${lines.join('\n') || 'Initial checks in progress.'}\n\nChecks every 30 seconds; alerts after 3 failures (low SOL: immediate). Status report every 5 minutes.\nRead-only: no trades, no worker activation.`;
}
async function apply(check) {
  const previous = states.get(check.key);
  const result = transition(previous, check);
  if (result.message) {
    try {
      if (await send(result.message)) {
        if (!check.ok) Object.assign(result.state, { notified: true, lastSentAt: Date.now() });
      } else if (check.ok && previous?.notified) Object.assign(result.state, { notified: true, lastSentAt: previous.lastSentAt });
    } catch {
      // Keep recovery pending and retry undelivered alerts without a cooldown.
      if (check.ok && previous?.notified) Object.assign(result.state, { notified: true, lastSentAt: previous.lastSentAt });
      console.error('Telegram delivery unavailable');
    }
  }
  states.set(check.key, result.state);
  try { await storedStates.updateOne({ key: check.key }, { $set: result.state }, { upsert: true }); }
  catch { console.error('Monitor state persistence unavailable'); }
}
async function httpCheck(key, path, validate) {
  return measureHttpCheck(key, new URL(path, origin), validate);
}
async function checkAll() {
  const checks = await Promise.all([
    httpCheck('website', '/'),
    httpCheck('api-health', '/api/health', body => body.ok === true),
    httpCheck('public-token', '/api/token', body => typeof body === 'object' && body !== null && Object.keys(body).length > 0),
    httpCheck('public-overview', '/api/public/overview', body => typeof body === 'object' && body !== null && Object.keys(body).length > 0),
    (async () => {
      try {
        await db.command({ ping: 1 });
        return { key: 'monitor-database', ok: true, detail: 'Independent monitor MongoDB' };
      } catch { return { key: 'monitor-database', ok: false, detail: 'Independent monitor MongoDB unavailable' }; }
    })(),
  ]);
  try {
    const { stdout } = await exec('ssh', ['-i', process.env.MONITOR_SSH_KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${process.env.MONITOR_SSH_KNOWN_HOSTS || '/etc/ownataxi-monitor/known_hosts'}`,
      '-o', 'IdentitiesOnly=yes', process.env.MONITOR_SSH_TARGET, 'snapshot'], { timeout: 25_000, maxBuffer: 64_000 });
    checks.push({ key: 'production-host', ok: true, detail: 'Production read-only observer reachable' }, ...snapshotChecks(JSON.parse(stdout)));
  } catch {
    checks.push({ key: 'production-host', ok: false, detail: 'Production host or read-only probe unavailable' });
    for (const key of ['origin-website', 'origin-health', 'origin-token', 'origin-overview', 'database', 'backend-service', 'rpc', 'payer-sol', 'disk', 'worker', 'server-errors', 'client-errors']) {
      checks.push({ key, ok: false, detail: 'Cannot verify: production probe unavailable' });
    }
  }
  for (const check of checks) await apply(check);
  if (recipient?.chatId && (!recipient.lastReportAt || Date.now() - recipient.lastReportAt >= 300_000)) {
    await send(statusText());
    recipient.lastReportAt = Date.now();
    await recipients.updateOne({ _id: 'admin' }, { $set: { lastReportAt: recipient.lastReportAt } });
  }
}
async function poll() {
  const updates = await telegram('getUpdates', { offset: recipient.offset, timeout: 5, allowed_updates: ['message'] });
  for (const update of updates) {
    const chatId = privateChatId(update);
    if (chatId) {
      const claimed = await recipients.findOneAndUpdate({ _id: 'admin', chatId: { $exists: false } },
        { $set: { chatId, claimedAt: new Date() } }, { returnDocument: 'after' });
      if (claimed) {
        recipient = claimed;
        await send(`This private chat is now the sole monitoring administrator.\n\n${statusText()}`);
      } else {
        const current = await recipients.findOne({ _id: 'admin' });
        recipient = current;
        if (current.chatId === chatId) {
          const command = (update.message?.text || '').trim().split(/\s/)[0].split('@')[0];
          if (['/start', '/status', '/help'].includes(command)) await send(statusText());
          else await send('Use /status to see current health checks. Alerts and daily summaries arrive automatically.');
        } else await send('The monitoring administrator is already configured.', chatId);
      }
    }
    await recipients.updateOne({ _id: 'admin' }, { $max: { offset: update.update_id + 1 } });
    recipient.offset = update.update_id + 1;
  }
}
const bot = await telegram('getMe', {});
console.log(`Monitor ready: @${bot.username}; recipient ${recipient.chatId ? 'configured' : 'waiting for first private message'}`);
// Polling and checks are independent: a slow production probe does not block registration.
await Promise.all([
  (async () => { while (!stopping) { try { await poll(); } catch { console.error('Telegram polling or recipient persistence unavailable'); await wait(5_000); } } })(),
  (async () => { while (!stopping) { const started = Date.now(); try { await checkAll(); } catch { console.error('Monitoring cycle failed'); } await wait(Math.max(1_000, 30_000 - (Date.now() - started))); } })(),
]);
await client.close();
