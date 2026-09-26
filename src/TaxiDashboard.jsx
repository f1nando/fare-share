import { useEffect, useMemo, useState } from 'react';
import {
  activateTrainee,
  claimMachine,
  claimTrainee,
  connectWallet,
  explorerTransaction,
  loadOwnedMachines,
  loadOwnedTrainees,
  loadProtocolStatus,
  mintMachine,
  networkName,
  repairMachine,
  formatSolAmount,
  shortAddress,
} from './protocol/solana.js';

const CLASSES = [
  { name: 'Economy', count: 1000, weight: 1, price: '$0.01 test price', tone: 'economy', image: '/nft/economy.png' },
  { name: 'Comfort', count: 300, weight: 3, price: '$0.03 test price', tone: 'comfort', image: '/nft/comfort.png' },
  { name: 'Business', count: 100, weight: 10, price: '$0.10 test price', tone: 'business', image: '/nft/business.png' },
  { name: 'Legend', count: 25, weight: 30, price: '$0.30 test price', tone: 'legend', image: '/nft/legend.png' },
];

const DEMO_CARS = [
  { id: '#0042', name: 'Comfort', weight: 3, durability: 64, reward: '3.37 FARE', stocks: '$0.81', image: '/nft/comfort.png' },
  { id: '#0188', name: 'Economy', weight: 1, durability: 18, reward: '0.94 FARE', stocks: '$0.23', image: '/nft/economy.png' },
];

const CLASS_IMAGE_BY_WEIGHT = Object.fromEntries(CLASSES.map(item => [item.weight, item.image]));

export function TaxiDashboard({ simple = false, background = null }) {
  const [wallet, setWallet] = useState(null);
  const [status, setStatus] = useState({ loading: true, deployed: false, network: networkName() });
  const [cars, setCars] = useState(DEMO_CARS);
  const [trainees, setTrainees] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [lastSignature, setLastSignature] = useState('');
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
  }, []);

  useEffect(() => {
    if (wallet && status.deployed) refreshGarage(wallet, status);
  }, [wallet, status.deployed]);

  const totalWeight = useMemo(() => CLASSES.reduce((sum, item) => sum + item.count * item.weight, 0), []);

  async function handleConnect() {
    setNotice('');
    try {
      const connected = await connectWallet();
      setWallet(connected);
    } catch (error) {
      setNotice(error.message);
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
      setNotice('The program is not deployed on this network yet. Demo mode is active.');
      return;
    }
    if (!wallet) {
      setNotice('Connect Phantom first.');
      return;
    }
    if (protocolPaused) {
      setNotice('The protocol is paused. Transactions are temporarily disabled.');
      return;
    }
    setBusy(key);
    setNotice('Approve the transaction in Phantom and wait for Solana finalization…');
    setLastSignature('');
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
    } catch (error) {
      if (error.signature) setLastSignature(error.signature);
      setNotice(error.message || 'Transaction failed.');
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
          <h1>{simple ? <>FARE Taxi Park<br /><span>Test panel</span></> : <>Your taxi fleet pays<br /><span>FARE and stocks</span></>}</h1>
          <p className="hero-copy">{simple ? 'Use this page to test wallet connection, minting, rewards, repair and trainee flows without loading the 3D city.' : 'The fleet distributes only fees it actually earns. No trading volume means no rewards.'}</p>
          {protocolPaused && <p className="protocol-paused" role="alert">Protocol paused — mint, claim, repair and trainee actions are temporarily disabled.</p>}
          <div className="pool-strip">
            <div><small>Current pool</small><strong>{status.deployed ? `${status.pool.nextPool[0]} raw FARE` : '—'}</strong></div>
            <div><small>Active weight</small><strong>{status.deployed ? status.pool.totalActiveWeight.toString() : '—'} / {totalWeight}</strong></div>
            <div><small>Rewards calculated through</small><strong>{status.deployed ? formatProtocolTime(status.pool.effectiveCalculatedUntil) : '—'}</strong></div>
          </div>
        </section>

        <section className="panel" aria-labelledby="garage-title">
          <div className="section-title">
            <div><p className="eyebrow">My garage</p><h2 id="garage-title">Cars</h2></div>
            <button className="ghost-button" disabled={busy === 'refresh'} onClick={() => refreshGarage()}>
              {busy === 'refresh' ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <div className="car-list">
            {cars.map(car => <article className="car-row" key={car.asset || car.id}>
              <div className="car-icon"><img src={car.image || CLASS_IMAGE_BY_WEIGHT[car.weight]} alt="" /></div>
              <div className="car-main"><strong>{car.name} <small>{car.id}</small></strong><span>Weight {car.weight}</span></div>
              <div className="durability"><span><b style={{ width: `${car.durability}%` }} /></span><small>Durability {car.durability}%</small></div>
              <div className="reward">
                <strong>{car.rewardDisplay ? `${car.rewardDisplay.fare} FARE` : car.reward}</strong>
                <small>{car.rewardDisplay
                  ? car.rewardDisplay.stocks.map(stock => `${stock.amount}${stock.rawFallback ? ' raw' : ''} ${stock.symbol}`).join(' · ')
                  : `+ ${car.stocks} in stocks`}</small>
              </div>
              <div className="row-actions">
                <button disabled={Boolean(busy) || protocolPaused} onClick={() => runAction(`claim-${car.asset || car.id}`, () => claimMachine(wallet, car, status), 'Rewards sent to your wallet.')}>Claim</button>
                <button disabled={Boolean(busy) || protocolPaused || car.missingSeconds === 0} className="secondary" onClick={() => runAction(`repair-${car.asset || car.id}`, () => repairMachine(wallet, car, status), 'Car restored to 5 days of durability.')}>
                  {car.missingSeconds === 0 ? 'Full durability' : car.repairCost === undefined ? 'Repair' : `Repair · ${car.repairCostDisplay} FARE`}
                </button>
              </div>
            </article>)}
          </div>
          <p className="demo-note">{status.deployed ? 'Data is read from finalized Solana accounts.' : 'Demo data will disappear when the deployed Solana program is connected.'}</p>
        </section>

        <section className="panel trainee-panel" aria-labelledby="trainee-title">
          <div className="section-title">
            <div><p className="eyebrow">Free trial</p><h2 id="trainee-title">Trainee car</h2></div>
          </div>
          <p className="trainee-copy">Find the campaign number and code word in our posts. Each campaign can be activated once per wallet.</p>
          <div className="trainee-form">
            <label>Campaign<input inputMode="numeric" value={campaignId} onChange={event => setCampaignId(event.target.value.replace(/\D/g, ''))} placeholder="For example, 1" /></label>
            <label>Code word<input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="Word from the post" /></label>
            <button disabled={Boolean(busy) || protocolPaused || !campaignId || !keyword.trim()} onClick={() => runAction(
              'activate-trainee',
              () => activateTrainee(wallet, campaignId, keyword, status),
              'Trainee car activated.',
            )}>Activate</button>
          </div>
          {trainees.length > 0 && <div className="trainee-list">
            {trainees.map(trainee => <article key={String(trainee.campaignId)}>
              <span><strong>Campaign #{String(trainee.campaignId)} · {trainee.rewardDisplay} FARE</strong><small>Active until {new Date(Number(trainee.activeUntil) * 1000).toLocaleString('en-US')}</small></span>
              <button disabled={Boolean(busy) || protocolPaused || trainee.reward === 0n} onClick={() => runAction(
                `claim-trainee-${trainee.campaignId}`,
                () => claimTrainee(wallet, trainee, status),
                'Trainee rewards sent.',
              )}>Claim FARE</button>
            </article>)}
          </div>}
        </section>

        <section className="panel mint-panel" aria-labelledby="mint-title">
          <div className="section-title"><div><p className="eyebrow">1,425 cars</p><h2 id="mint-title">Choose a class</h2></div></div>
          {simple && <p className="mint-cost-note">Phantom will show the NFT price plus approximately 0.0045 SOL for the personal Metaplex Core asset and Machine account rent. This is account creation cost, not network gas. The shared Devnet event page has already been prepaid by the deployer.</p>}
          <div className="class-grid">
            {CLASSES.map((item, classIndex) => {
              const solPrice = status.deployed ? formatSolAmount(status.config.mintPrices[classIndex]) : null;
              const remaining = status.deployed
                ? item.count - Number(status.config.mintedByClass[classIndex])
                : item.count;
              return <article className={`class-card ${item.tone}`} key={item.name}>
                <div className="class-top"><span>{item.name}</span><b>×{item.weight}</b></div>
                <img className="class-image" src={item.image} alt={`${item.name} NFT taxi`} />
                <dl>
                  <div><dt>Price</dt><dd>{solPrice ? `${solPrice} SOL` : item.price}</dd></div>
                  <div><dt>Remaining</dt><dd>{remaining} / {item.count}</dd></div>
                </dl>
                <button disabled={Boolean(busy) || protocolPaused || remaining === 0} onClick={() => runAction(`mint-${classIndex}`, () => mintMachine(wallet, classIndex, status), `${item.name} NFT car minted.`)}>
                  {remaining === 0 ? 'Sold out' : solPrice ? `Buy · ${solPrice} SOL` : 'Buy with SOL'}
                </button>
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
