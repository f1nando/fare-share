import { useEffect, useMemo, useState } from 'react';
import {
  activateTrainee,
  claimAllMachines,
  claimMachine,
  claimTrainee,
  connectWallet,
  explorerTransaction,
  loadOwnedMachines,
  loadOwnedTrainees,
  loadProtocolStatus,
  MAX_CLAIM_MACHINES_PER_TRANSACTION,
  MAX_REPAIR_MACHINES_PER_TRANSACTION,
  mintMachine,
  networkName,
  prepareMintQuote,
  repairMachine,
  repairAllMachines,
  transferMachine,
  shortAddress,
} from './protocol/solana.js';
import { displayTicker, useTokenConfig } from './tokenConfig.jsx';
import { appAssetPath } from './appPath.js';
import { notifyError, notifyLoading, notifySuccess } from './siteToasts.js';
import { actionLoadingMessage } from './actionToastMessage.js';

const CLASSES = [
  { name: 'Economy', count: 833, weight: 1, odds: '68.17%', tone: 'economy', image: appAssetPath('/nft/economy.webp'), variants: ['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'] },
  { name: 'Comfort', count: 278, weight: 3, odds: '22.75%', tone: 'comfort', image: appAssetPath('/nft/comfort.webp'), variants: ['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'] },
  { name: 'Business', count: 83, weight: 10, odds: '6.79%', tone: 'business', image: appAssetPath('/nft/business.webp'), variants: ['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'] },
  { name: 'Legend', count: 28, weight: 30, odds: '2.29%', tone: 'legend', image: appAssetPath('/nft/legend.webp'), variants: ['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'] },
];

const CLASS_IMAGE_BY_WEIGHT = Object.fromEntries(CLASSES.map(item => [item.weight, item.image]));

export function TaxiDashboard({ simple = false, background = null }) {
  const tokenConfig = useTokenConfig();
  const ticker = displayTicker(tokenConfig);
  const [wallet, setWallet] = useState(null);
  const [status, setStatus] = useState({ loading: true, deployed: false, network: networkName() });
  const [cars, setCars] = useState([]);
  const [trainees, setTrainees] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [transferRecipient, setTransferRecipient] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [lastSignature, setLastSignature] = useState('');
  const [preparedMint, setPreparedMint] = useState(null);
  const protocolPaused = Boolean(status.deployed && status.config?.pausedAt !== 0n);

  useEffect(() => {
    let active = true;
    loadProtocolStatus()
      .then(next => {
        if (!active) return;
        setStatus({ ...next, loading: false });
        if (next.deployed) setCars([]);
      })
      .catch(() => active && setStatus({ loading: false, deployed: false, network: networkName() }));
    return () => { active = false; };
  }, [tokenConfig.mint]);

  useEffect(() => {
    if (wallet && status.deployed) refreshGarage(wallet, status);
  }, [wallet, status.deployed]);

  useEffect(() => {
    let active = true;
    setPreparedMint(null);
    if (!wallet || !status.deployed || protocolPaused) return () => { active = false; };
    const refresh = () => prepareMintQuote(wallet, status)
      .then(value => active && setPreparedMint(value))
      .catch(() => active && setPreparedMint(null));
    refresh();
    const timer = window.setInterval(refresh, 20_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [wallet, status.deployed, status.config?.fareMint, status.config?.mintedByClass?.join(','), protocolPaused]);

  const totalWeight = useMemo(() => CLASSES.reduce((sum, item) => sum + item.count * item.weight, 0), []);
  const paidMinted = status.config?.mintedByClass?.reduce((total, value) => total + Number(value), 0) || 0;
  const claimableCars = useMemo(() => cars.filter(car => car.rewards?.some(amount => BigInt(amount) > 0n)), [cars]);
  const repairableCars = useMemo(() => cars.filter(car => car.missingSeconds > 0), [cars]);
  const claimBatch = claimableCars.slice(0, MAX_CLAIM_MACHINES_PER_TRANSACTION);
  const repairBatch = repairableCars.slice(0, MAX_REPAIR_MACHINES_PER_TRANSACTION);

  async function handleConnect() {
    setNotice('');
    try {
      const connected = await connectWallet();
      setWallet(connected);
    } catch (error) {
      setNotice(error.message);
      notifyError(error.message);
    }
  }

  async function refreshGarage(connection = wallet, currentStatus = status) {
    if (!connection || !currentStatus.deployed) return;
    setBusy('refresh');
    try {
      const [nextCars, nextTrainees] = await Promise.all([
        loadOwnedMachines(connection.account.address, currentStatus),
        loadOwnedTrainees(connection.account.address, currentStatus),
      ]);
      setCars(nextCars);
      setTrainees(nextTrainees);
      setNotice(nextCars.length || nextTrainees.length ? 'Garage refreshed.' : 'This wallet has no cars yet.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy('');
    }
  }

  async function runAction(key, action, success) {
    if (!status.deployed) {
      const message = 'The program is not deployed on this network yet. Demo mode is active.';
      setNotice(message);
      notifyError(message);
      return;
    }
    if (!wallet) {
      const message = 'Connect Phantom first.';
      setNotice(message);
      notifyError(message);
      return;
    }
    if (protocolPaused) {
      const message = 'The protocol is paused. Transactions are temporarily disabled.';
      setNotice(message);
      notifyError(message);
      return;
    }
    setBusy(key);
    setNotice('Approve the transaction in Phantom and wait for Solana finalization…');
    setLastSignature('');
    const toastId = notifyLoading(actionLoadingMessage(key));
    try {
      const result = await action();
      const signature = typeof result === 'string' ? result : result.signature;
      setLastSignature(signature);
      const nextStatus = await loadProtocolStatus();
      setStatus({ ...nextStatus, loading: false });
      const [nextCars, nextTrainees] = await Promise.all([
        loadOwnedMachines(wallet.account.address, nextStatus),
        loadOwnedTrainees(wallet.account.address, nextStatus),
      ]);
      setCars(nextCars);
      setTrainees(nextTrainees);
      setNotice(success);
      notifySuccess(success, { id: toastId });
    } catch (error) {
      if (error.signature) setLastSignature(error.signature);
      const message = error.message || 'Transaction failed.';
      setNotice(message);
      notifyError(message, { id: toastId });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className={`taxi-app${simple ? ' is-test-panel' : ''}`}>
      {!simple && background}
      {!simple && <div className="taxi-shade" />}
      <header className="taxi-header">
        <a className="taxi-brand" href="#top" aria-label="FARE Taxi Park">
          <span className="brand-mark">F</span>
          <span>FARE <small>TAXI PARK</small></span>
        </a>
        <div className="header-actions">
          <span className={`network-pill ${status.deployed ? 'online' : ''}${protocolPaused ? ' paused' : ''}`}>
            <i /> {status.loading ? 'checking network' : protocolPaused ? `${status.network} · paused` : status.deployed ? status.network : `demo · ${status.network}`}
          </span>
          <button className="wallet-button" onClick={handleConnect}>
            {wallet ? shortAddress(wallet.account.address) : 'Connect Phantom'}
          </button>
        </div>
      </header>

      <main className="taxi-content" id="top">
        <section className="hero-card">
          <p className="eyebrow">{simple ? 'Devnet functional test' : 'Revenue without promised APY'}</p>
          <h1>{simple ? <>FARE Taxi Park<br /><span>Test panel</span></> : <>Your taxi fleet pays<br /><span>{ticker} and stocks</span></>}</h1>
          <p className="hero-copy">{simple ? 'Use this page to test wallet connection, minting, rewards, repair and trainee flows without loading the 3D city.' : 'The fleet distributes only fees it actually earns. No trading volume means no rewards.'}</p>
          {protocolPaused && <p className="protocol-paused" role="alert">Protocol paused — mint, claim, repair and trainee actions are temporarily disabled.</p>}
          <div className="pool-strip">
            <div><small>Current pool</small><strong>{status.deployed ? `${status.pool.nextPool[0]} raw ${ticker}` : '—'}</strong></div>
            <div><small>Active weight</small><strong>{status.deployed ? status.pool.totalActiveWeight.toString() : '—'} / {totalWeight}</strong></div>
            <div><small>Rewards calculated through</small><strong>{status.deployed ? formatProtocolTime(status.pool.effectiveCalculatedUntil) : '—'}</strong></div>
          </div>
        </section>

        <section className="panel" aria-labelledby="garage-title">
          <div className="section-title">
            <div><p className="eyebrow">My garage</p><h2 id="garage-title">Cars</h2></div>
            <div className="garage-actions">
              <button className="ghost-button primary" disabled={Boolean(busy) || protocolPaused || claimBatch.length === 0} onClick={() => runAction(
                'claim-all',
                () => claimAllMachines(wallet, claimBatch, status),
                `Rewards claimed from ${claimBatch.length} car${claimBatch.length === 1 ? '' : 's'}.`,
              )}>Claim {claimBatch.length < claimableCars.length ? `${claimBatch.length} of ${claimableCars.length}` : 'all'}{claimBatch.length === claimableCars.length && claimBatch.length ? ` · ${claimBatch.length}` : ''}</button>
              <button className="ghost-button" disabled={Boolean(busy) || protocolPaused || repairBatch.length === 0} onClick={() => runAction(
                'repair-all',
                () => repairAllMachines(wallet, repairBatch, status),
                `${repairBatch.length} car${repairBatch.length === 1 ? '' : 's'} restored to 5 days of durability.`,
              )}>Repair {repairBatch.length < repairableCars.length ? `${repairBatch.length} of ${repairableCars.length}` : 'all'}{repairBatch.length === repairableCars.length && repairBatch.length ? ` · ${repairBatch.length}` : ''}</button>
              <button className="ghost-button" disabled={Boolean(busy)} onClick={() => refreshGarage()}>
                {busy === 'refresh' ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
          {(claimableCars.length > claimBatch.length || repairableCars.length > repairBatch.length) && <p className="demo-note">
            One Solana transaction handles up to {MAX_CLAIM_MACHINES_PER_TRANSACTION} claims or {MAX_REPAIR_MACHINES_PER_TRANSACTION} repairs. Repeat the action for the remaining cars.
          </p>}
          {simple && <div className="transfer-test-form">
            <label>Devnet transfer recipient<input value={transferRecipient} onChange={event => setTransferRecipient(event.target.value.trim())} placeholder="Second wallet public address" /></label>
            <small>Transfers the selected Core NFT with its existing Machine state. Public address only.</small>
          </div>}
          <div className="car-list">
            {cars.map(car => <article className="car-row" key={car.asset || car.id}>
              <div className="car-icon"><img src={car.image || CLASS_IMAGE_BY_WEIGHT[car.weight]} alt="" loading="lazy" decoding="async" /></div>
              <div className="car-main"><strong>{car.name} <small>{car.id}</small></strong><span>Weight {car.weight}</span></div>
              <div className="durability"><span><b style={{ width: `${car.durability}%` }} /></span><small>Durability {car.durability}%</small></div>
              <div className="reward">
                <strong>{car.rewardDisplay ? `${car.rewardDisplay.fare} ${ticker}` : car.reward.replace('FARE', ticker)}</strong>
                <small>{car.rewardDisplay
                  ? car.rewardDisplay.stocks.map(stock => `${stock.amount}${stock.rawFallback ? ' raw' : ''} ${stock.symbol}`).join(' · ')
                  : `+ ${car.stocks} in stocks`}</small>
              </div>
              <div className="row-actions">
                <button disabled={Boolean(busy) || protocolPaused} onClick={() => runAction(`claim-${car.asset || car.id}`, () => claimMachine(wallet, car, status), 'Rewards sent to your wallet.')}>Claim</button>
                <button disabled={Boolean(busy) || protocolPaused || car.missingSeconds === 0} className="secondary" onClick={() => runAction(`repair-${car.asset || car.id}`, () => repairMachine(wallet, car, status), 'Car restored to 5 days of durability.')}>
                  {car.missingSeconds === 0 ? 'Full durability' : car.repairCost === undefined ? 'Repair' : `Repair · ${car.repairCostDisplay} ${ticker}`}
                </button>
                {simple && <button disabled={Boolean(busy) || protocolPaused || !transferRecipient} className="secondary" onClick={() => runAction(
                  `transfer-${car.asset || car.id}`,
                  () => transferMachine(wallet, car, transferRecipient, status),
                  'NFT transferred. Its protocol state stays attached to the asset.',
                )}>Transfer test</button>}
              </div>
            </article>)}
          </div>
          <p className="demo-note">{status.deployed ? 'Data is read from finalized Solana accounts.' : 'Demo data will disappear when the deployed Solana program is connected.'}</p>
        </section>

        <section className="panel trainee-panel" aria-labelledby="trainee-title">
          <div className="section-title">
            <div><p className="eyebrow">Free trial</p><h2 id="trainee-title">Trainee car</h2></div>
          </div>
          <p className="trainee-copy">Enter the code word from our post. Each code word can be activated once per wallet.</p>
          <div className="trainee-form">
            <label>Code word<input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="Word from the post" /></label>
            <button disabled={Boolean(busy) || protocolPaused || !keyword.trim()} onClick={() => runAction(
              'activate-trainee',
              () => activateTrainee(wallet, keyword, status),
              'Trainee car activated.',
            )}>Activate</button>
          </div>
          {trainees.length > 0 && <div className="trainee-list">
            {trainees.map(trainee => <article key={String(trainee.campaignId)}>
              <span><strong>Trainee taxi · {trainee.rewardDisplay} {ticker}</strong><small>Active until {new Date(Number(trainee.activeUntil) * 1000).toLocaleString('en-US')}</small></span>
              <button disabled={Boolean(busy) || protocolPaused || trainee.reward === 0n} onClick={() => runAction(
                `claim-trainee-${trainee.campaignId}`,
                () => claimTrainee(wallet, trainee, status),
                'Trainee rewards sent.',
              )}>Claim {ticker}</button>
            </article>)}
          </div>}
        </section>

        <section className="panel mint-panel" aria-labelledby="mint-title">
          <div className="section-title"><div><p className="eyebrow">1,222 cars</p><h2 id="mint-title">Random taxi mint</h2></div></div>
          {simple && <p className="mint-cost-note">Phantom will show the NFT price in ${ticker} plus SOL network fees and rent for the Metaplex Core asset, Machine account, and any missing team token account.</p>}
          <p className="mint-cost-note">Every mint costs $25 in ${ticker}. Class and model follow the precommitted shuffled order.</p>
          {preparedMint && <p className="mint-cost-note"><strong>Next taxi:</strong> {CLASSES[Number(preparedMint.quote.classIndex)]?.name} · {CLASSES[Number(preparedMint.quote.classIndex)]?.variants[Number(preparedMint.quote.variantIndex)]}</p>}
          <button disabled={Boolean(busy) || protocolPaused || !preparedMint || paidMinted >= 1222} onClick={() => runAction('mint-random', () => mintMachine(wallet, status, preparedMint), 'Random taxi NFT minted.')}>
            {paidMinted >= 1222 ? 'Sold out' : `Mint random taxi · $25 in $${ticker}`}
          </button>
          <div className="class-grid">
            {CLASSES.map((item, classIndex) => {
              const remaining = status.deployed
                ? item.count - Number(status.config.mintedByClass[classIndex])
                : item.count;
              return <article className={`class-card ${item.tone}`} key={item.name}>
                <div className="class-top"><span>{item.name}</span><b>×{item.weight}</b></div>
                <img className="class-image" src={item.image} alt={`${item.name} NFT taxi`} loading="lazy" decoding="async" />
                <dl>
                  <div><dt>Collection share</dt><dd>{item.odds}</dd></div>
                  <div><dt>Remaining</dt><dd>{remaining} / {item.count}</dd></div>
                </dl>
              </article>;
            })}
          </div>
        </section>

        <p className="jurisdiction-notice">
          Users in jurisdictions where xStocks are prohibited must not use the project's stock features.
          By connecting a wallet, you confirm that you are legally allowed to use the product in your country.
        </p>

        {notice && <div className="taxi-notice" role="status"><span>{notice}{lastSignature && <> · <a href={explorerTransaction(lastSignature)} target="_blank" rel="noreferrer">Explorer</a></>}</span><button onClick={() => setNotice('')}>×</button></div>}
      </main>
    </div>
  );
}

function formatProtocolTime(value) {
  const seconds = Number(value || 0n);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'not calculated yet';
  return new Date(seconds * 1000).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}
