import { useCallback, useEffect, useState } from 'react';

const API = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

export function AdminPage() {
  const [csrf, setCsrf] = useState('');
  const [login, setLogin] = useState({ username: '', password: '' });
  const [status, setStatus] = useState(null);
  const [ca, setCa] = useState('');
  const [verifiedCa, setVerifiedCa] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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
      const result = await request('/api/admin/mint/inspect', { method: 'POST', body: { ca }, csrf });
      setVerifiedCa(result.mint);
      setNotice('CA проверен. Creator, Pump curve, SOL quote и fee mode корректны.');
    });
  }

  async function bind() {
    if (!window.confirm('Зафиксировать этот CA навсегда? Заменить его после транзакции будет невозможно.')) return;
    await action('bind', async () => {
      const result = await request('/api/admin/mint/bind', { method: 'POST', body: { ca: verifiedCa }, csrf });
      setNotice(`CA зафиксирован. ${result.signature}`);
      setVerifiedCa('');
      await refresh();
    });
  }

  async function claim() {
    await action('claim', async () => {
      const result = await request('/api/admin/fees/claim', { method: 'POST', body: {}, csrf });
      setAmount(formatSolInput(BigInt(result.amountLamports)));
      setNotice(`Получено ${formatSol(result.amountLamports)}. Сумма подставлена в поле отправки.`);
      await refresh();
    });
  }

  async function deposit(event) {
    event.preventDefault();
    await action('deposit', async () => {
      const amountLamports = parseSol(amount).toString();
      const result = await request('/api/admin/fees/deposit', { method: 'POST', body: { amountLamports }, csrf });
      setNotice(`В контракт направлено ${formatSol(result.amountLamports)}.`);
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
    <p className="eyebrow">FARE SHARE</p><h1>Admin</h1><p className="muted">Закрытая панель управления creator fees</p>
    <label>Логин<input autoComplete="username" value={login.username} onChange={event => setLogin({ ...login, username: event.target.value })} required /></label>
    <label>Пароль<input type="password" autoComplete="current-password" value={login.password} onChange={event => setLogin({ ...login, password: event.target.value })} required /></label>
    {error && <p className="message error">{error}</p>}<button disabled={busy === 'login'}>{busy === 'login' ? 'Вход…' : 'Войти'}</button>
  </form></main>;

  return <main className="admin-shell">
    <header><div><p className="eyebrow">FARE SHARE</p><h1>Creator fees</h1></div><div className="header-actions"><button className="secondary" onClick={refresh}>Обновить</button><button className="ghost" onClick={logout}>Выйти</button></div></header>
    {error && <p className="message error">{error}</p>}{notice && <p className="message success">{notice}</p>}
    {!status ? <section className="admin-card">Загрузка on-chain состояния…</section> : <>
      <section className="metrics">
        <Metric label="Доступно к claim" value={formatSol(status.availableLamports)} />
        <Metric label="Pump curve" value={formatSol(status.bondingLamports)} />
        <Metric label="PumpSwap" value={formatSol(status.ammLamports)} />
        <Metric label="Баланс 2NUN" value={formatSol(status.walletLamports)} />
      </section>
      <section className="admin-grid">
        <div className="admin-card"><p className="eyebrow">ГЛАВНЫЙ CA</p>{status.mint ? <><h2 className="mono break">{status.mint}</h2><p className="status-ok">● Зафиксирован onchain</p></> : <>
          <h2>Ожидаем CA заказчика</h2><label>Contract address<input className="mono" value={ca} onChange={event => { setCa(event.target.value.trim()); setVerifiedCa(''); }} placeholder="Вставьте CA" /></label>
          <div className="button-row"><button onClick={inspect} disabled={!ca || busy === 'inspect'}>Проверить</button><button className="danger" onClick={bind} disabled={!verifiedCa || verifiedCa !== ca || busy === 'bind'}>Зафиксировать CA</button></div>
        </>}</div>
        <div className="admin-card"><p className="eyebrow">ОПЕРАЦИИ</p><h2>Получение и распределение</h2>
          <button className="wide" onClick={claim} disabled={!status.mint || BigInt(status.availableLamports) === 0n || busy === 'claim'}>{busy === 'claim' ? 'Получаем…' : 'Забрать fees'}</button>
          <form onSubmit={deposit}><label>Направить в контракт, SOL<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.000000000" /></label><button className="wide" disabled={!status.mint || !amount || busy === 'deposit'}>{busy === 'deposit' ? 'Отправляем…' : 'Направить fees в контракт'}</button></form>
          <p className="muted">Перевод и распределение выполняются одной атомарной транзакцией.</p>
        </div>
      </section>
      <section className="admin-card"><div className="section-title"><div><p className="eyebrow">ИСТОРИЯ</p><h2>Последние операции</h2></div><span>Автообновление 15 сек.</span></div>
        <div className="history">{status.history.length ? status.history.map(item => <div className="history-row" key={item.signature}><span className={`tag ${item.kind}`}>{labels[item.kind] || item.kind}</span><span>{formatSol(item.amountLamports)}</span><time>{new Date(item.createdAt).toLocaleString('ru-RU')}</time><a href={explorer(item.signature, item.cluster)} target="_blank" rel="noreferrer">{short(item.signature)} ↗</a></div>) : <p className="muted">Операций пока нет.</p>}</div>
      </section>
    </>}
  </main>;
}

function Metric({ label, value }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
const labels = { claim: 'CLAIM', deposit: 'В КОНТРАКТ', bind_mint: 'CA' };
function short(value) { return `${value.slice(0, 7)}…${value.slice(-7)}`; }
function explorer(signature, cluster) { return `https://solscan.io/tx/${signature}${cluster === 'devnet' ? '?cluster=devnet' : ''}`; }
function formatSol(raw) { return `${formatSolInput(BigInt(raw || 0))} SOL`; }
function formatSolInput(raw) { const whole = raw / 1_000_000_000n; const fraction = (raw % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, ''); return fraction ? `${whole}.${fraction}` : String(whole); }
function parseSol(value) { if (!/^\d+(?:\.\d{1,9})?$/.test(value)) throw new Error('Введите сумму SOL с точностью не более 9 знаков.'); const [whole, fraction = ''] = value.split('.'); const result = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0')); if (result <= 0n) throw new Error('Сумма должна быть больше нуля.'); return result; }
async function request(path, options = {}) { const response = await fetch(`${API}${path}`, { method: options.method || 'GET', credentials: 'include', headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.csrf ? { 'x-csrf-token': options.csrf } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined }); if (!response.ok) { const payload = await response.json().catch(() => ({})); const error = new Error(payload.error || `HTTP ${response.status}`); error.status = response.status; throw error; } return response.status === 204 ? null : response.json(); }
