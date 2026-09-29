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
  const operationIds = useRef({ claim: storedOperationId('claim'), deposit: storedOperationId('deposit') });
  const selectedCa = status?.mint || ca;

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
    if (!window.confirm(`Bind the CA and ticker $${verifiedTicker} permanently? They cannot be changed after the transaction.`)) return;
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
    <header><div><p className="eyebrow">FARE SHARE</p><h1>Creator fees</h1></div><div className="header-actions"><button className="secondary" onClick={refresh}>Refresh</button><button className="ghost" onClick={logout}>Sign out</button></div></header>
    {error && <p className="message error">{error}</p>}{notice && <p className="message success">{notice}</p>}
    {!status ? <section className="admin-card">Loading on-chain state…</section> : <>
      <section className="metrics">
        <Metric label="Available to claim" value={formatSol(status.availableLamports)} />
        <Metric label="Pump curve" value={formatSol(status.bondingLamports)} />
        <Metric label="PumpSwap" value={formatSol(status.ammLamports)} />
        <Metric label="2NUN balance" value={formatSol(status.walletLamports)} />
      </section>
      <section className="admin-grid">
        <div className="admin-card"><p className="eyebrow">PRIMARY TOKEN</p>{status.mint && status.ticker ? <><h2>${status.ticker}</h2><p className="mono break">{status.mint}</p><p className="status-ok">● CA and ticker are bound</p></> : <>
          <h2>{status.mint ? 'Enter the ticker for the on-chain CA' : 'Waiting for the client CA and ticker'}</h2><label>Contract address<input className="mono" value={selectedCa} disabled={Boolean(status.mint)} onChange={event => { setCa(event.target.value.trim()); setVerifiedCa(''); setVerifiedTicker(''); }} placeholder="Paste CA" /></label>
          <label>Ticker<input value={ticker} onChange={event => { setTicker(event.target.value.replace(/^\$+/, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)); setVerifiedCa(''); setVerifiedTicker(''); }} placeholder="For example, FARE" maxLength="10" /></label>
          <div className="button-row"><button onClick={inspect} disabled={!selectedCa || !ticker || busy === 'inspect'}>Verify</button><button className="danger" onClick={bind} disabled={!verifiedCa || verifiedCa !== selectedCa || !verifiedTicker || verifiedTicker !== ticker || busy === 'bind'}>Bind CA and ticker</button></div>
        </>}</div>
        <div className="admin-card"><p className="eyebrow">OPERATIONS</p><h2>Claim and distribution</h2>
          <button className="wide" onClick={claim} disabled={!status.mint || BigInt(status.availableLamports) === 0n || busy === 'claim'}>{busy === 'claim' ? 'Claiming…' : 'Claim fees'}</button>
          <form onSubmit={deposit}><label>Send to contract, SOL<input inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); clearOperationId(operationIds, 'deposit'); }} placeholder="0.000000000" /></label><button className="wide" disabled={!status.mint || !amount || busy === 'deposit'}>{busy === 'deposit' ? 'Sending…' : 'Send fees to contract'}</button></form>
          {status.activeOperation && <p className="muted">The {status.activeOperation.kind === 'claim' ? 'claim' : 'deposit'} operation is awaiting on-chain reconciliation{status.activeOperation.signature ? `: ${short(status.activeOperation.signature)}` : '.'}</p>}
          <p className="muted">Transfer and distribution are completed in one atomic transaction.</p>
        </div>
      </section>
      <section className="admin-card"><div className="section-title"><div><p className="eyebrow">HISTORY</p><h2>Recent operations</h2></div><span>Refreshes every 15 sec.</span></div>
        <div className="history">{status.history.length ? status.history.map(item => <div className="history-row" key={item.signature}><span className={`tag ${item.kind}`}>{labels[item.kind] || item.kind}</span><span>{formatSol(item.amountLamports)}</span><time>{new Date(item.createdAt).toLocaleString('en-US')}</time><a href={explorer(item.signature, item.cluster)} target="_blank" rel="noreferrer">{short(item.signature)} ↗</a></div>) : <p className="muted">No operations yet.</p>}</div>
      </section>
    </>}
  </main>;
}

function Metric({ label, value }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
const labels = { claim: 'CLAIM', deposit: 'TO CONTRACT', bind_mint: 'CA' };
function short(value) { return `${value.slice(0, 7)}…${value.slice(-7)}`; }
function explorer(signature, cluster) { return `https://solscan.io/tx/${signature}${cluster === 'devnet' ? '?cluster=devnet' : ''}`; }
function formatSol(raw) { return `${formatSolInput(BigInt(raw || 0))} SOL`; }
function formatSolInput(raw) { const whole = raw / 1_000_000_000n; const fraction = (raw % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, ''); return fraction ? `${whole}.${fraction}` : String(whole); }
function parseSol(value) { if (!/^\d+(?:\.\d{1,9})?$/.test(value)) throw new Error('Enter a SOL amount with no more than 9 decimal places.'); const [whole, fraction = ''] = value.split('.'); const result = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0')); if (result <= 0n) throw new Error('The amount must be greater than zero.'); return result; }
function createOperationId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`; }
function storedOperationId(kind) { try { return localStorage.getItem(OPERATION_STORAGE[kind]) || ''; } catch { return ''; } }
function storeOperationId(kind, value) { try { localStorage.setItem(OPERATION_STORAGE[kind], value); } catch { /* MongoDB lock remains authoritative. */ } }
function clearOperationId(reference, kind) { reference.current[kind] = ''; try { localStorage.removeItem(OPERATION_STORAGE[kind]); } catch { /* Ignore unavailable storage. */ } }
async function request(path, options = {}) { const response = await fetch(`${API}${path}`, { method: options.method || 'GET', credentials: 'include', headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.csrf ? { 'x-csrf-token': options.csrf } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined }); if (!response.ok) { const payload = await response.json().catch(() => ({})); const error = new Error(payload.error || `HTTP ${response.status}`); error.status = response.status; throw error; } return response.status === 204 ? null : response.json(); }
