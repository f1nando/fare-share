import { useCallback, useEffect, useRef, useState } from 'react';

const API = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');
const OPERATION_STORAGE = { claim: 'taxi.admin.claimOperationId', deposit: 'taxi.admin.depositOperationId' };

export function AdminPage() {
  const [csrf, setCsrf] = useState('');
  const [login, setLogin] = useState({ username: '', password: '' });
  const [status, setStatus] = useState(null);
  const [ca, setCa] = useState('');
  const [ticker, setTicker] = useState('');
  const [verifiedCa, setVerifiedCa] = useState('');
  const [verifiedTicker, setVerifiedTicker] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [machineQuery, setMachineQuery] = useState('');
  const [teamAccount, setTeamAccount] = useState('');
  const [rescueRecipient, setRescueRecipient] = useState('');
  const [rescueConfirmation, setRescueConfirmation] = useState('');
  const [migrationConfirmation, setMigrationConfirmation] = useState('');
  const operationIds = useRef({ claim: storedOperationId('claim'), deposit: storedOperationId('deposit') });
  const fareLocked = Boolean(status?.dashboard?.protocol?.saleStarted);
  const selectedCa = fareLocked ? status?.mint || '' : ca || status?.mint || '';

  const refresh = useCallback(async () => {
    if (!csrf) return;
    try {
      const next = await request('/api/admin/status');
      setStatus(next);
      setError('');
    } catch (reason) {
      if (reason.status === 401) { setCsrf(''); setStatus(null); }
      else setError(reason.message);
    }
  }, [csrf]);

  useEffect(() => {
    request('/api/admin/session').then(session => setCsrf(session.csrf)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!csrf) return undefined;
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [csrf, refresh]);

  async function submitLogin(event) {
    event.preventDefault();
    await action('login', async () => {
      const session = await request('/api/admin/login', { method: 'POST', body: login });
      setCsrf(session.csrf);
      setLogin(current => ({ ...current, password: '' }));
    });
  }

  async function inspect() {
    await action('inspect', async () => {
      const result = await request('/api/admin/mint/inspect', { method: 'POST', body: { ca: selectedCa, ticker }, csrf });
      setVerifiedCa(result.mint);
      setVerifiedTicker(result.ticker);
      setTicker(result.ticker);
      setNotice(`CA and ticker $${result.ticker} verified. Creator, Pump curve, SOL quote, and fee mode are valid.`);
    });
  }

  async function bind() {
    if (!window.confirm(`Use ${verifiedCa} as $${verifiedTicker}? It can be replaced until start-sale, then becomes locked to protect existing rewards.`)) return;
    await action('bind', async () => {
      const result = await request('/api/admin/mint/bind', { method: 'POST', body: { ca: verifiedCa, ticker: verifiedTicker }, csrf });
      setNotice(`CA and ticker $${result.ticker} are now bound.${result.signature ? ` ${result.signature}` : ''}`);
      setVerifiedCa('');
      setVerifiedTicker('');
      await refresh();
    });
  }

  async function claim() {
    await action('claim', async () => {
      operationIds.current.claim ||= createOperationId();
      storeOperationId('claim', operationIds.current.claim);
      const result = await request('/api/admin/fees/claim', { method: 'POST', body: { operationId: operationIds.current.claim }, csrf });
      clearOperationId(operationIds, 'claim');
      setAmount(formatSolInput(BigInt(result.amountLamports)));
      setNotice(`Claimed ${formatSol(result.amountLamports)}. The amount was added to the deposit field.`);
      await refresh();
    });
  }

  async function updateTeamAccount() {
    const selected = teamAccount.trim();
    if (!window.confirm(`Send all future team allocations to ${selected}? Verify the address carefully. Existing transfers cannot be recovered.`)) return;
    await action('team', async () => {
      const result = await request('/api/admin/team', { method: 'POST', body: { teamAccount: selected }, csrf });
      setTeamAccount('');
      setNotice(result.unchanged ? 'This wallet is already the active team recipient.' : `Team wallet updated on-chain. ${result.signature}`);
      await refresh();
    });
  }

  async function setProtocolPaused(paused) {
    if (!window.confirm(paused ? 'Pause every protocol operation now?' : 'Unpause the protocol and resume normal operations?')) return;
    await action(paused ? 'pause' : 'unpause', async () => {
      const result = await request('/api/admin/protocol/pause', { method: 'POST', body: { paused, migrationConfirmed: !paused && migrationConfirmation === 'MIGRATED' }, csrf });
      setMigrationConfirmation('');
      setNotice(result.unchanged ? `The protocol is already ${paused ? 'paused' : 'live'}.` : `Protocol ${paused ? 'paused' : 'unpaused'} on-chain. ${result.signature}`);
      await refresh();
    });
  }

  async function rescueAssets() {
    const recipient = rescueRecipient.trim();
    if (!window.confirm(`Emergency rescue all available SOL and token vault balances to ${recipient}? This stops normal claims and requires migration.`)) return;
    await action('rescue', async () => {
      const result = await request('/api/admin/protocol/rescue', { method: 'POST', body: { recipient }, csrf });
      setRescueConfirmation('');
      setNotice(`Emergency rescue finalized: ${formatSol(result.solLamports)} and ${result.tokens.length} token balance(s). ${result.signature}`);
      await refresh();
    });
  }

  async function deposit(event) {
    event.preventDefault();
    await action('deposit', async () => {
      const amountLamports = parseSol(amount).toString();
      operationIds.current.deposit ||= createOperationId();
      storeOperationId('deposit', operationIds.current.deposit);
      const result = await request('/api/admin/fees/deposit', { method: 'POST', body: { amountLamports, operationId: operationIds.current.deposit }, csrf });
      clearOperationId(operationIds, 'deposit');
      setNotice(`Sent ${formatSol(result.amountLamports)} to the contract.`);
      await refresh();
    });
  }

  async function logout() {
    await action('logout', async () => {
      await request('/api/admin/logout', { method: 'POST', body: {}, csrf });
      setCsrf(''); setStatus(null);
    });
  }

  async function action(name, work) {
    setBusy(name); setError(''); setNotice('');
    try { await work(); } catch (reason) { setError(reason.message); }
    finally { setBusy(''); }
  }

  if (!csrf) return <main className="admin-shell admin-login"><form className="admin-card login-card" onSubmit={submitLogin}>
    <p className="eyebrow">FARE SHARE</p><h1>Admin</h1><p className="muted">Private creator fee management panel</p>
    <label>Username<input autoComplete="username" value={login.username} onChange={event => setLogin({ ...login, username: event.target.value })} required /></label>
    <label>Password<input type="password" autoComplete="current-password" value={login.password} onChange={event => setLogin({ ...login, password: event.target.value })} required /></label>
    {error && <p className="message error">{error}</p>}<button disabled={busy === 'login'}>{busy === 'login' ? 'Signing in…' : 'Sign in'}</button>
  </form></main>;

  return <main className="admin-shell">
    <header><div><p className="eyebrow">FARE SHARE</p><h1>Protocol control</h1></div><div className="header-actions"><span className="live-dot">● LIVE · 15 SEC</span><button className="secondary" onClick={refresh}>Refresh</button><button className="ghost" onClick={logout}>Sign out</button></div></header>
    {error && <p className="message error">{error}</p>}{notice && <p className="message success">{notice}</p>}
    {!status ? <section className="admin-card">Loading on-chain state…</section> : <>
      <section className="metrics">
        <Metric label="Available to claim" value={formatSol(status.availableLamports)} />
        <Metric label="Pump curve" value={formatSol(status.bondingLamports)} />
        <Metric label="PumpSwap" value={formatSol(status.ammLamports)} />
        <Metric label="2NUN balance" value={formatSol(status.walletLamports)} />
      </section>
      <LiveOverview dashboard={status.dashboard} />
      <EmergencyControls dashboard={status.dashboard} migrationPending={status.rescuePendingMigration} migrationConfirmation={migrationConfirmation} setMigrationConfirmation={setMigrationConfirmation} recipient={rescueRecipient} setRecipient={setRescueRecipient} confirmation={rescueConfirmation} setConfirmation={setRescueConfirmation} busy={busy} setPaused={setProtocolPaused} rescue={rescueAssets} />
      <section className="admin-grid">
        <div className="admin-card"><p className="eyebrow">PROTOCOL SETTINGS</p>{status.mint && status.ticker ? <><h2>${status.ticker} token</h2><p className="mono break">{status.mint}</p><p className="status-ok">● Reward and burn CA is configured</p><p className="muted">The protocol buys this same token for fleet rewards, trainee rewards and the 20% burn allocation. {fareLocked ? 'The sale has started, so direct replacement is locked.' : 'The admin can replace it until start-sale.'}</p></> : <>
          <h2>{status.mint ? 'Enter the ticker for the on-chain CA' : 'Waiting for the client CA and ticker'}</h2><label>Contract address<input className="mono" value={selectedCa} disabled={Boolean(status.mint)} onChange={event => { setCa(event.target.value.trim()); setVerifiedCa(''); setVerifiedTicker(''); }} placeholder="Paste CA" /></label>
          <label>Ticker<input value={ticker} onChange={event => { setTicker(event.target.value.replace(/^\$+/, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)); setVerifiedCa(''); setVerifiedTicker(''); }} placeholder="For example, FARE" maxLength="10" /></label>
          <div className="button-row"><button onClick={inspect} disabled={!selectedCa || !ticker || busy === 'inspect'}>Verify</button><button className="danger" onClick={bind} disabled={!verifiedCa || verifiedCa !== selectedCa || !verifiedTicker || verifiedTicker !== ticker || busy === 'bind'}>Bind CA and ticker</button></div>
        </>}{status.mint && !fareLocked && <><label>Replacement contract address<input className="mono" value={selectedCa} onChange={event => { setCa(event.target.value.trim()); setVerifiedCa(''); setVerifiedTicker(''); }} placeholder="Paste a new CA" /></label><label>Replacement ticker<input value={ticker} onChange={event => { setTicker(event.target.value.replace(/^\$+/, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)); setVerifiedCa(''); setVerifiedTicker(''); }} placeholder={status.ticker || 'FARE'} maxLength="10" /></label><div className="button-row"><button onClick={inspect} disabled={!selectedCa || !ticker || selectedCa === status.mint || busy === 'inspect'}>Verify replacement</button><button className="danger" onClick={bind} disabled={!verifiedCa || verifiedCa !== selectedCa || !verifiedTicker || verifiedTicker !== ticker || busy === 'bind'}>Replace CA</button></div></>}<div className="settings-divider" /><label>Team wallet<input className="mono" value={teamAccount || status.dashboard?.protocol?.teamAccount || ''} onChange={event => setTeamAccount(event.target.value.trim())} placeholder="Solana wallet address" /></label><p className="muted">Future 10% team allocations and NFT mint proceeds use this on-chain address. Previous transfers are not moved.</p><button className="wide danger" onClick={updateTeamAccount} disabled={!teamAccount || teamAccount === status.dashboard?.protocol?.teamAccount || busy === 'team'}>{busy === 'team' ? 'Updating…' : 'Update team wallet'}</button></div>
        <div className="admin-card"><p className="eyebrow">OPERATIONS</p><h2>Claim and distribution</h2>
          <button className="wide" onClick={claim} disabled={!status.mint || BigInt(status.availableLamports) === 0n || busy === 'claim'}>{busy === 'claim' ? 'Claiming…' : 'Claim fees'}</button>
          <form onSubmit={deposit}><label>Send to contract, SOL<input inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); clearOperationId(operationIds, 'deposit'); }} placeholder="0.000000000" /></label><button className="wide" disabled={!status.mint || !amount || busy === 'deposit'}>{busy === 'deposit' ? 'Sending…' : 'Send fees to contract'}</button></form>
          {status.activeOperation && <p className="muted">The {status.activeOperation.kind === 'claim' ? 'claim' : 'deposit'} operation is awaiting on-chain reconciliation{status.activeOperation.signature ? `: ${short(status.activeOperation.signature)}` : '.'}</p>}
          <p className="muted">Transfer and distribution are completed in one atomic transaction.</p>
        </div>
      </section>
      <Distribution dashboard={status.dashboard} />
      <MachineBalances dashboard={status.dashboard} query={machineQuery} setQuery={setMachineQuery} />
      <section className="admin-card"><div className="section-title"><div><p className="eyebrow">HISTORY</p><h2>Recent operations</h2></div><span>Refreshes every 15 sec.</span></div>
        <div className="history">{status.history.length ? status.history.map(item => <div className="history-row" key={item.signature}><span className={`tag ${item.kind}`}>{labels[item.kind] || item.kind}</span><span>{formatSol(item.amountLamports)}</span><time>{new Date(item.createdAt).toLocaleString('en-US')}</time><a href={explorer(item.signature, item.cluster)} target="_blank" rel="noreferrer">{short(item.signature)} ↗</a></div>) : <p className="muted">No operations yet.</p>}</div>
      </section>
    </>}
  </main>;
}

function Metric({ label, value }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function LiveOverview({ dashboard }) {
  if (!dashboard) return null;
  const protocol = dashboard.protocol;
  const worker = dashboard.worker;
  return <section className="live-grid">
    <div className="admin-card live-card"><div className="section-title"><div><p className="eyebrow">PROTOCOL</p><h2>Current status</h2></div><StatusPill state={protocol.state} /></div>
      <LiveLine label="Sale" value={protocol.saleStarted ? 'Started' : 'Not started'} />
      <LiveLine label="Machines" value={String(protocol.machineCount)} />
      <LiveLine label="Minted" value={protocol.mintedByClass.join(' / ')} hint="Economy / Comfort / Business / Legend" />
    </div>
    <div className="admin-card live-card"><div className="section-title"><div><p className="eyebrow">WORKER</p><h2>Automation</h2></div><StatusPill state={worker.state} /></div>
      <LiveLine label="Last successful cycle" value={worker.lastSuccessAt ? time(worker.lastSuccessAt) : 'No completed cycle'} />
      <LiveLine label="Next cycle" value={worker.nextRunAt ? time(worker.nextRunAt) : 'Waiting for worker'} />
      {worker.error && <p className="worker-error">{worker.error}</p>}
    </div>
    <div className="admin-card live-card"><p className="eyebrow">EVENT QUEUES</p><h2>Waiting events</h2>
      <QueueBar label="Fleet" queue={dashboard.queues.main} />
      <QueueBar label="Trainee" queue={dashboard.queues.trainee} />
    </div>
  </section>;
}
function EmergencyControls({ dashboard, migrationPending, migrationConfirmation, setMigrationConfirmation, recipient, setRecipient, confirmation, setConfirmation, busy, setPaused, rescue }) {
  if (!dashboard) return null;
  const paused = dashboard.protocol.paused;
  return <section className="admin-card emergency-card"><div><p className="eyebrow">EMERGENCY CONTROL</p><h2>{paused ? 'Protocol is paused' : 'Protocol is running'}</h2><p className="muted">Pause blocks minting, swaps, distributions, claims and repairs. Emergency rescue moves available SOL and all five token vault balances in one transaction.</p>{dashboard.vaults && <div className="rescue-balances"><b>{formatSol(dashboard.vaults.solLamports)}</b>{dashboard.vaults.tokens.map(asset => <span key={asset.symbol}>{asset.symbol}: {formatToken(asset.amount, asset.decimals)}</span>)}</div>}{migrationPending && <p className="worker-error">Vault assets were rescued. Verify that balances and user obligations were migrated before unpausing.</p>}</div><div className="emergency-actions">{paused && migrationPending && <input value={migrationConfirmation} onChange={event => setMigrationConfirmation(event.target.value.toUpperCase())} placeholder="Type MIGRATED to enable unpause" />}<button className={paused ? 'secondary' : 'danger'} onClick={() => setPaused(!paused)} disabled={busy === 'pause' || busy === 'unpause' || (paused && migrationPending && migrationConfirmation !== 'MIGRATED')}>{paused ? 'Unpause protocol' : 'Pause entire protocol'}</button>{paused && <div className="rescue-form"><input className="mono" value={recipient} onChange={event => setRecipient(event.target.value.trim())} placeholder="Emergency recipient wallet" /><input value={confirmation} onChange={event => setConfirmation(event.target.value.toUpperCase())} placeholder="Type RESCUE" /><button className="danger" onClick={rescue} disabled={!recipient || confirmation !== 'RESCUE' || busy === 'rescue'}>{busy === 'rescue' ? 'Rescuing…' : 'Rescue all vault assets'}</button></div>}</div></section>;
}
function Distribution({ dashboard }) {
  if (!dashboard) return null;
  const { distribution, worker } = dashboard;
  return <section className="admin-card distribution-card"><div className="section-title"><div><p className="eyebrow">DISTRIBUTION</p><h2>Money flow</h2></div><span>{distribution.seriesActive ? 'Distribution in progress' : distribution.nextPool.some(value => BigInt(value) > 0n) ? `Queued for ${worker.nextRunAt ? time(worker.nextRunAt) : 'the next worker cycle'}` : 'Waiting for funds'}</span></div>
    <div className="distribution-grid">{distribution.assets.map((asset, index) => <div className="asset-card" key={asset.symbol}><strong>{asset.symbol === 'FARE' ? '$FARE' : asset.symbol}</strong><Amount label="Next distribution" value={distribution.nextPool[index]} asset={asset} /><Amount label="In active series" value={distribution.seriesRemaining[index]} asset={asset} /><Amount label="Owed to machines" value={distribution.obligations[index]} asset={asset} /></div>)}</div>
    <div className="distribution-foot"><span>Active fleet weight: <b>{distribution.activeWeight}</b></span><span>Calculated through: <b>{unixTime(distribution.calculatedUntil)}</b></span></div>
  </section>;
}
function MachineBalances({ dashboard, query, setQuery }) {
  if (!dashboard) return null;
  const normalized = query.trim().toLowerCase();
  const machines = dashboard.machines.filter(item => !normalized || item.asset.toLowerCase().includes(normalized) || item.machine.toLowerCase().includes(normalized) || item.className.toLowerCase().includes(normalized));
  return <section className="admin-card machines-card"><div className="section-title"><div><p className="eyebrow">FLEET BALANCES</p><h2>Money by machine</h2></div><span>{machines.length} of {dashboard.machines.length}</span></div>
    <input className="machine-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search asset, machine or class" />
    <div className="machine-table-wrap"><table className="machine-table"><thead><tr><th>Machine</th><th>Status</th>{dashboard.distribution.assets.map(asset => <th key={asset.symbol}>{asset.symbol === 'FARE' ? '$FARE' : asset.symbol}</th>)}</tr></thead><tbody>{machines.length ? machines.map(machine => <tr key={machine.machine}><td><b>{machine.className}</b><a href={accountExplorer(machine.asset)} target="_blank" rel="noreferrer" className="mono">{short(machine.asset)} ↗</a></td><td><span className={machine.rewardActive ? 'machine-active' : 'machine-idle'}>{machine.closed ? 'Closed' : machine.rewardActive ? 'Earning' : 'Idle'}</span><small>{machine.activeUntil !== '0' ? `Until ${unixTime(machine.activeUntil)}` : 'Inactive'}</small></td>{machine.claimable.map((value, index) => <td className="mono" key={index}>{formatToken(value, dashboard.distribution.assets[index].decimals)}</td>)}</tr>) : <tr><td colSpan={7} className="empty-cell">No matching machines.</td></tr>}</tbody></table></div>
    <p className="muted">Balances include stored claimable rewards and rewards already accrued in the current finalized pool. Amounts still waiting in “Next distribution” are not assigned until the worker processes them.</p>
  </section>;
}
function StatusPill({ state }) { return <span className={`status-pill ${state}`}>{state.toUpperCase()}</span>; }
function LiveLine({ label, value, hint }) { return <div className="live-line"><span>{label}{hint && <small>{hint}</small>}</span><b>{value}</b></div>; }
function QueueBar({ label, queue }) { const percent = Math.min(100, queue.count / queue.capacity * 100); return <div className="queue"><div><span>{label}</span><b>{queue.count} events · {queue.readyPages} ready pages</b></div><div className="queue-track"><i style={{ width: `${percent}%` }} /></div></div>; }
function Amount({ label, value, asset }) { return <div><span>{label}</span><b className="mono">{formatToken(value, asset.decimals)}</b></div>; }
const labels = { claim: 'CLAIM', deposit: 'TO CONTRACT', bind_mint: 'CA', set_team: 'TEAM WALLET', pause: 'PAUSE', unpause: 'UNPAUSE', emergency_rescue: 'RESCUE' };
function short(value) { return `${value.slice(0, 7)}…${value.slice(-7)}`; }
function explorer(signature, cluster) { return `https://solscan.io/tx/${signature}${cluster === 'devnet' ? '?cluster=devnet' : ''}`; }
function accountExplorer(value) { return `https://solscan.io/account/${value}`; }
function time(value) { return new Date(value).toLocaleString('en-US'); }
function unixTime(value) { const seconds = Number(value); return seconds > 0 ? new Date(seconds * 1000).toLocaleString('en-US') : 'Not started'; }
function formatToken(raw, decimals) { const value = BigInt(raw || 0); const scale = 10n ** BigInt(decimals); const whole = value / scale; const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 6); return fraction ? `${whole}.${fraction}` : String(whole); }
function formatSol(raw) { return `${formatSolInput(BigInt(raw || 0))} SOL`; }
function formatSolInput(raw) { const whole = raw / 1_000_000_000n; const fraction = (raw % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, ''); return fraction ? `${whole}.${fraction}` : String(whole); }
function parseSol(value) { if (!/^\d+(?:\.\d{1,9})?$/.test(value)) throw new Error('Enter a SOL amount with no more than 9 decimal places.'); const [whole, fraction = ''] = value.split('.'); const result = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0')); if (result <= 0n) throw new Error('The amount must be greater than zero.'); return result; }
function createOperationId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`; }
function storedOperationId(kind) { try { return localStorage.getItem(OPERATION_STORAGE[kind]) || ''; } catch { return ''; } }
function storeOperationId(kind, value) { try { localStorage.setItem(OPERATION_STORAGE[kind], value); } catch { /* MongoDB lock remains authoritative. */ } }
function clearOperationId(reference, kind) { reference.current[kind] = ''; try { localStorage.removeItem(OPERATION_STORAGE[kind]); } catch { /* Ignore unavailable storage. */ } }
async function request(path, options = {}) { const response = await fetch(`${API}${path}`, { method: options.method || 'GET', credentials: 'include', headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.csrf ? { 'x-csrf-token': options.csrf } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined }); if (!response.ok) { const payload = await response.json().catch(() => ({})); const error = new Error(payload.error || `HTTP ${response.status}`); error.status = response.status; throw error; } return response.status === 204 ? null : response.json(); }
