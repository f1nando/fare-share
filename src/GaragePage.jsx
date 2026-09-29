import { useEffect, useMemo, useState } from 'react';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import drivingScenes from './drivingScenes.json';
import {
  claimAllMachines,
  claimMachine,
  explorerTransaction,
  loadProtocolStatus,
  MAX_CLAIM_MACHINES_PER_TRANSACTION,
  MAX_REPAIR_MACHINES_PER_TRANSACTION,
  repairAllMachines,
  repairMachine,
} from './protocol/solana.js';
import { loadDatabaseFleet } from './publicData.js';
import { displayTicker, useTokenConfig } from './tokenConfig.jsx';

const CLASS_BY_WEIGHT = {
  1: { name: 'Economy', tone: 'economy' },
  3: { name: 'Comfort', tone: 'comfort' },
  10: { name: 'Business', tone: 'business' },
  30: { name: 'Legend', tone: 'legend' },
};

export function GaragePage({ wallet }) {
  const ticker = displayTicker(useTokenConfig());
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
    loadDatabaseFleet(wallet.account.address)
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
  const claimBatch = claimable.slice(0, MAX_CLAIM_MACHINES_PER_TRANSACTION);
  const repairBatch = repairable.slice(0, MAX_REPAIR_MACHINES_PER_TRANSACTION);
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
    : [];
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
      setMachines(await loadDatabaseFleet(wallet.account.address));
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
          <div className="fare-garage-heading fare-page-heading">
            <h1 className="fare-page-title is-short" id="garage-page-title">GARAGE</h1>
            <p>{wallet ? 'Your onchain taxi fleet, ready to run the next shift.' : 'Connect Phantom to load your onchain taxi fleet.'}</p>
          </div>

          {notice && <p className="fare-garage-notice" role="status">{notice}</p>}
          {signature && <a className="fare-garage-signature" href={explorerTransaction(signature)} target="_blank" rel="noreferrer">View transaction</a>}
          {(claimable.length > claimBatch.length || repairable.length > repairBatch.length) && (
            <p className="fare-garage-batch-warning" role="note">
              Solana safely fits up to {MAX_CLAIM_MACHINES_PER_TRANSACTION} claims or {MAX_REPAIR_MACHINES_PER_TRANSACTION} repairs per transaction.
              {claimable.length > claimBatch.length ? ` Claim ${claimBatch.length} of ${claimable.length}, then repeat for the remaining ${claimable.length - claimBatch.length}.` : ''}
              {repairable.length > repairBatch.length ? ` Repair ${repairBatch.length} of ${repairable.length}, then repeat for the remaining ${repairable.length - repairBatch.length}.` : ''}
            </p>
          )}

          <section className="fare-garage-overview" aria-label="Fleet earnings overview">
            <div className="fare-garage-overview-main">
              <div className="fare-garage-overview-copy">
                <span>Fleet status</span>
                <strong>{wallet && status?.deployed ? `${claimable.length} claimable car${claimable.length === 1 ? '' : 's'}` : 'Connect your wallet'}</strong>
                <p>{wallet && status?.deployed ? 'The database read model is refreshed from finalized Solana accounts.' : 'Your verified onchain fleet will appear here.'}</p>
                <div className="fare-garage-overview-actions">
                  <button type="button" disabled={Boolean(busy) || paused || claimBatch.length === 0} onClick={() => runAction(
                    'claim-all',
                    () => claimAllMachines(wallet, claimBatch, status),
                    `Rewards claimed from ${claimBatch.length} car${claimBatch.length === 1 ? '' : 's'}.`,
                  )}>Claim {claimBatch.length < claimable.length ? `${claimBatch.length} of ${claimable.length}` : 'all'}{claimBatch.length === claimable.length && claimBatch.length ? <b>{claimBatch.length}</b> : null}</button>
                  <button className="is-secondary" type="button" disabled={Boolean(busy) || paused || repairBatch.length === 0} onClick={() => runAction(
                    'repair-all',
                    () => repairAllMachines(wallet, repairBatch, status),
                    `${repairBatch.length} car${repairBatch.length === 1 ? '' : 's'} repaired.`,
                  )}>Repair {repairBatch.length < repairable.length ? `${repairBatch.length} of ${repairable.length}` : 'all'}{repairBatch.length === repairable.length && repairBatch.length ? ` · ${repairBatch.length}` : ''}</button>
                </div>
              </div>

              <div className="fare-garage-chart"><p>Historical earnings will appear after verified distribution events are stored.</p></div>
            </div>

            <div className="fare-garage-overview-stats">
              <div><span>Claimable cars</span><strong>{wallet && status?.deployed ? claimable.length : 0}</strong><small>Finalized state</small></div>
              <div><span>Fleet weight</span><strong>{wallet && status?.deployed ? machines.reduce((sum, machine) => sum + machine.weight, 0) : 0}</strong><small>Current total</small></div>
              <div><span>Cars working</span><strong>{wallet && status?.deployed ? `${machines.length - repairable.length}/${machines.length}` : '0/0'}</strong><small>{wallet && status?.deployed ? `${repairable.length} need repair` : 'Connect wallet'}</small></div>
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
                  <strong>{car.fare} {ticker}</strong>
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
          {wallet && status?.deployed && !busy && displayedCars.length === 0 && <p className="fare-garage-notice">This wallet has no verified taxis.</p>}
        </section>
      </main>
    </>
  );
}
