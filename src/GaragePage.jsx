import { useEffect, useMemo, useState } from 'react';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import drivingScenes from './drivingScenes.json';
import {
  claimAllMachines,
  claimMachine,
  explorerTransaction,
  loadOwnedMachines,
  loadProtocolStatus,
  repairAllMachines,
  repairMachine,
} from './protocol/solana.js';

const CLASS_BY_SCENE = new Map([
  ...['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'].map(name => [name, { name: 'Economy', tone: 'economy' }]),
  ...['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'].map(name => [name, { name: 'Comfort', tone: 'comfort' }]),
  ...['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'].map(name => [name, { name: 'Business', tone: 'business' }]),
  ...['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'].map(name => [name, { name: 'Legend', tone: 'legend' }]),
]);
const GARAGE_STATS = [
  { durability: 84, fare: '12.48', stocks: '$3.20 in stocks' },
  { durability: 62, fare: '8.14', stocks: '$2.05 in stocks' },
  { durability: 28, fare: '19.72', stocks: '$4.91 in stocks' },
  { durability: 100, fare: '3.06', stocks: '$0.78 in stocks' },
  { durability: 47, fare: '6.83', stocks: '$1.69 in stocks' },
  { durability: 73, fare: '31.44', stocks: '$7.86 in stocks' },
  { durability: 91, fare: '74.20', stocks: '$18.55 in stocks' },
  { durability: 36, fare: '11.57', stocks: '$2.88 in stocks' },
  { durability: 15, fare: '52.09', stocks: '$13.02 in stocks' },
];
const garageCars = drivingScenes.slice(0, 9).map((scene, index) => ({
  ...scene,
  ...GARAGE_STATS[index],
  vehicleClass: CLASS_BY_SCENE.get(scene.name) || { name: 'Economy', tone: 'economy' },
}));
const earningsBars = [38, 46, 34, 51, 62, 73, 71, 72, 70, 69, 58, 57, 59, 56, 55, 57, 56, 64, 63, 62, 94, 94, 94, 108];
const CLASS_BY_WEIGHT = {
  1: { name: 'Economy', tone: 'economy' },
  3: { name: 'Comfort', tone: 'comfort' },
  10: { name: 'Business', tone: 'business' },
  30: { name: 'Legend', tone: 'legend' },
};

export function GaragePage({ wallet }) {
  const [status, setStatus] = useState(null);
  const [machines, setMachines] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [signature, setSignature] = useState('');

  useEffect(() => {
    let active = true;
    loadProtocolStatus()
      .then(next => active && setStatus(next))
      .catch(error => active && setNotice(error.message));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!wallet || !status?.deployed) {
      setMachines([]);
      return undefined;
    }
    let active = true;
    setBusy('load');
    loadOwnedMachines(wallet.account.address, status)
      .then(next => {
        if (!active) return;
        setMachines(next);
        setNotice(next.length ? '' : 'This wallet has no Fare Share cars.');
      })
      .catch(error => active && setNotice(error.message))
      .finally(() => active && setBusy(''));
    return () => { active = false; };
  }, [wallet, status?.deployed]);

  const claimable = useMemo(() => machines.filter(machine => (
    machine.rewards.some(amount => BigInt(amount) > 0n)
  )), [machines]);
  const repairable = useMemo(() => machines.filter(machine => machine.missingSeconds > 0), [machines]);
  const displayedCars = wallet && status?.deployed
    ? machines.map((machine, index) => ({
      id: machine.asset,
      scene: drivingScenes[index % drivingScenes.length],
      name: machine.name,
      vehicleClass: CLASS_BY_WEIGHT[machine.weight] || CLASS_BY_WEIGHT[1],
      durability: machine.durability,
      fare: machine.rewardDisplay.fare,
      stocks: machine.rewardDisplay.stocks.map(stock => `${stock.amount} ${stock.symbol}`).join(' · '),
      machine,
    }))
    : garageCars.map(car => ({ ...car, scene: car }));
  const paused = Boolean(status?.config?.pausedAt !== 0n);

  async function runAction(key, action, success) {
    if (!wallet) return setNotice('Connect Phantom first.');
    if (!status?.deployed) return setNotice('The protocol is not deployed on this network.');
    if (paused) return setNotice('The protocol is paused. Transactions are temporarily disabled.');
    setBusy(key);
    setNotice('Approve one transaction in Phantom and wait for finalization…');
    setSignature('');
    try {
      const nextSignature = await action();
      setSignature(nextSignature);
      const nextStatus = await loadProtocolStatus();
      setStatus(nextStatus);
      setMachines(await loadOwnedMachines(wallet.account.address, nextStatus));
      setNotice(success);
    } catch (error) {
      if (error.signature) setSignature(error.signature);
      setNotice(error.message || 'Transaction failed.');
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <main className="fare-garage-main" id="top">
        <section className="container fare-garage-section" id="garage" aria-labelledby="garage-page-title">
          <div className="fare-garage-heading">
            <h1 id="garage-page-title">GARAGE</h1>
            <p>{wallet ? 'Your onchain taxi fleet, ready to run the next shift.' : 'Connect Phantom to load your onchain taxi fleet.'}</p>
          </div>

          {notice && <p className="fare-garage-notice" role="status">{notice}</p>}
          {signature && <a className="fare-garage-signature" href={explorerTransaction(signature)} target="_blank" rel="noreferrer">View transaction</a>}

          <section className="fare-garage-overview" aria-label="Fleet earnings overview">
            <div className="fare-garage-overview-main">
              <div className="fare-garage-overview-copy">
                <span>Total fleet earnings</span>
                <strong>{wallet && status?.deployed ? `${claimable.length} claimable car${claimable.length === 1 ? '' : 's'}` : '219.53 FARE'}</strong>
                <p>{wallet && status?.deployed ? 'All rewards shown below are read from finalized Solana accounts.' : '+$12.48 today · $54.94 earned in stocks'}</p>
                <div className="fare-garage-overview-actions">
                  <button type="button" disabled={Boolean(busy) || paused || claimable.length === 0} onClick={() => runAction(
                    'claim-all',
                    () => claimAllMachines(wallet, claimable, status),
                    `Rewards claimed from ${claimable.length} car${claimable.length === 1 ? '' : 's'}.`,
                  )}>Claim all{claimable.length ? <b>{claimable.length}</b> : null}</button>
                  <button className="is-secondary" type="button" disabled={Boolean(busy) || paused || repairable.length === 0} onClick={() => runAction(
                    'repair-all',
                    () => repairAllMachines(wallet, repairable, status),
                    `${repairable.length} car${repairable.length === 1 ? '' : 's'} repaired.`,
                  )}>Repair all{repairable.length ? ` · ${repairable.length}` : ''}</button>
                </div>
              </div>

              <div className="fare-garage-chart">
                <div className="fare-garage-periods" aria-label="Earnings period">
                  <button className="is-active" type="button">24H</button>
                  <button type="button">7D</button>
                  <button type="button">30D</button>
                </div>
                <div className="fare-garage-bars" aria-hidden="true">
                  {earningsBars.map((height, index) => <i className={index > 9 ? 'is-accent' : undefined} style={{ height: `${height}px` }} key={`${height}-${index}`} />)}
                </div>
                <div className="fare-garage-chart-labels"><span>00:00</span><span>06:00</span><span>12:30</span><span>16:30</span><span>20:00</span><span>00:00</span></div>
              </div>
            </div>

            <div className="fare-garage-overview-stats">
              <div><span>Earned this hour</span><strong>4.82 FARE</strong><small className="is-positive">↗ 8.4%</small></div>
              <div><span>Projected today</span><strong>57.60 FARE</strong><small>Estimate</small></div>
              <div><span>Cars working</span><strong>{wallet && status?.deployed ? `${machines.length - repairable.length}/${machines.length}` : '7/9'}</strong><small>{wallet && status?.deployed ? `${repairable.length} need repair` : '2 need repair'}</small></div>
            </div>
          </section>

          <div className="fare-garage-grid">
            {displayedCars.map((car, index) => (
              <article className="fare-step-card fare-garage-card" key={car.id}>
                <FareStepDrivingScene scene={car.scene} />
                <span className="fare-step-number fare-garage-number">#{String(index + 1).padStart(2, '0')}</span>
                <span className={`fare-fleet-class fare-garage-class is-${car.vehicleClass.tone}`}>{car.vehicleClass.name}</span>
                <h2>{car.name}</h2>
                <div className="fare-garage-durability-copy"><span>Durability</span><strong>{car.durability}%</strong></div>
                <div className="fare-garage-durability" role="progressbar" aria-label={`${car.name} durability`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={car.durability}>
                  <span style={{ width: `${car.durability}%` }} />
                </div>
                <div className="fare-garage-earned">
                  <span>Earned</span>
                  <strong>{car.fare} FARE</strong>
                  <small>{car.stocks}</small>
                </div>
                <div className="fare-garage-actions">
                  <button className="is-secondary" type="button" disabled={!car.machine || Boolean(busy) || paused || car.machine.missingSeconds === 0} onClick={() => runAction(
                    `repair-${car.id}`,
                    () => repairMachine(wallet, car.machine, status),
                    'Car repaired.',
                  )}>Repair</button>
                  <button type="button" disabled={!car.machine || Boolean(busy) || paused || !car.machine.rewards.some(amount => BigInt(amount) > 0n)} onClick={() => runAction(
                    `claim-${car.id}`,
                    () => claimMachine(wallet, car.machine, status),
                    'Rewards claimed.',
                  )}>Claim</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
