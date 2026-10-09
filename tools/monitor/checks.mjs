export function snapshotChecks(snapshot, now = Date.now()) {
  const worker = snapshot.worker;
  const interval = Math.max(300_000, Number(worker?.intervalMs) || 300_000);
  const stale = worker?.enabled === true && (
    !worker.lastSuccessAt || now - Date.parse(worker.lastSuccessAt) > interval * 3 + 120_000
  );
  const stuck = worker?.enabled === true && worker.state === 'running'
    && (!worker.cycleStartedAt || now - Date.parse(worker.cycleStartedAt) > interval * 3 + 120_000);
  return [
    ...(snapshot.originChecks || []),
    { key: 'database', ok: snapshot.database === true, detail: 'Production MongoDB ping' },
    { key: 'backend-service', ok: snapshot.backendActive, detail: 'Production backend process' },
    { key: 'rpc', ok: snapshot.rpc === true, detail: 'Solana RPC and payer balance query' },
    { key: 'payer-sol', ok: snapshot.balanceLamports != null && BigInt(snapshot.balanceLamports) >= BigInt(snapshot.minimumLamports),
      detail: snapshot.balanceLamports == null ? 'Balance unavailable; see RPC check' : `Payer SOL: ${(Number(snapshot.balanceLamports) / 1e9).toFixed(4)}`, threshold: 1 },
    { key: 'disk', ok: snapshot.diskUsedPercent < 90, detail: `Production disk used: ${snapshot.diskUsedPercent}%` },
    { key: 'worker', ok: snapshot.database === true && (worker?.enabled !== true || (snapshot.workerActive && !stale && !stuck && worker.state !== 'error')),
      detail: snapshot.database !== true ? 'Worker state unavailable: production MongoDB down' : worker?.enabled !== true ? 'Worker intentionally disabled (no transactions enabled)' : `Worker ${worker.state}${stale ? '; no recent successful cycle' : ''}${stuck ? '; cycle stuck' : ''}` },
    { key: 'runtime-errors', ok: snapshot.recentErrors < 3, detail: `Backend/worker errors in last 5 minutes: ${snapshot.recentErrors}` },
  ];
}

export function transition(previous, check, now = Date.now()) {
  const state = { ...previous, key: check.key, detail: check.detail, ok: check.ok, checkedAt: now };
  // A Cloudflare browser challenge is not proof of an outage or a recovery.
  if (check.ok === null) return { state };
  if (check.ok) {
    const message = previous?.notified ? `🟢 RECOVERED: ${check.detail}` : undefined;
    return { state: { ...state, failures: 0, notified: false, lastSentAt: undefined }, message };
  }
  state.failures = (previous?.failures || 0) + 1;
  if (state.failures >= (check.threshold || 3) && (!state.lastSentAt || now - state.lastSentAt >= 30 * 60_000)) {
    return { state, message: `🔴 ALERT: ${check.key}: ${check.detail}` };
  }
  return { state };
}

export function privateChatId(update) {
  const chat = update.message?.chat;
  return chat?.type === 'private' && Number.isSafeInteger(chat.id) ? String(chat.id) : undefined;
}
