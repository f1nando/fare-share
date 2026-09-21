import { useEffect, useMemo, useState } from 'react';
import { CityBackground } from './CityBackground.jsx';
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
  repairMachine,
  formatSolAmount,
  shortAddress,
} from './protocol/solana.js';

const CLASSES = [
  { name: 'Эконом', count: 1000, weight: 1, price: '$49', tone: 'economy' },
  { name: 'Комфорт', count: 300, weight: 3, price: '$129', tone: 'comfort' },
  { name: 'Бизнес', count: 100, weight: 10, price: '$399', tone: 'business' },
  { name: 'Легенда', count: 25, weight: 30, price: '$1099', tone: 'legend' },
];

const DEMO_CARS = [
  { id: '#0042', name: 'Комфорт', weight: 3, durability: 64, reward: '3.37 FARE', stocks: '$0.81' },
  { id: '#0188', name: 'Эконом', weight: 1, durability: 18, reward: '0.94 FARE', stocks: '$0.23' },
];

export function TaxiDashboard() {
  const [wallet, setWallet] = useState(null);
  const [status, setStatus] = useState({ loading: true, deployed: false, network: 'devnet' });
  const [cars, setCars] = useState(DEMO_CARS);
  const [trainees, setTrainees] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [lastSignature, setLastSignature] = useState('');

  useEffect(() => {
    let active = true;
    loadProtocolStatus()
      .then(next => {
        if (!active) return;
        setStatus({ ...next, loading: false });
        if (next.deployed) setCars([]);
      })
      .catch(() => active && setStatus({ loading: false, deployed: false, network: 'devnet' }));
    return () => { active = false; };
  }, []);

  const totalWeight = useMemo(() => CLASSES.reduce((sum, item) => sum + item.count * item.weight, 0), []);

  async function handleConnect() {
    setNotice('');
    try {
      const connected = await connectWallet();
      setWallet(connected);
      if (status.deployed) await refreshGarage(connected, status);
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
      setNotice(nextCars.length || nextTrainees.length ? 'Гараж обновлён.' : 'В этом кошельке пока нет машин.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy('');
    }
  }

  async function runAction(key, action, success) {
    if (!status.deployed) {
      setNotice('Программа ещё не развёрнута в выбранной сети. Сейчас открыт демо-режим.');
      return;
    }
    if (!wallet) {
      setNotice('Сначала подключите Phantom.');
      return;
    }
    setBusy(key);
    setNotice('Подтвердите транзакцию в Phantom, затем дождитесь финального подтверждения Solana…');
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
      setNotice(error.message || 'Транзакция не выполнена.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="taxi-app">
      <CityBackground fixed showSettings={false} />
      <div className="taxi-shade" />
      <header className="taxi-header">
        <a className="taxi-brand" href="#top" aria-label="FARE Taxi Park">
          <span className="brand-mark">F</span>
          <span>FARE <small>TAXI PARK</small></span>
        </a>
        <div className="header-actions">
          <span className={`network-pill ${status.deployed ? 'online' : ''}`}>
            <i /> {status.loading ? 'проверка сети' : status.deployed ? status.network : 'demo · devnet'}
          </span>
          <button className="wallet-button" onClick={handleConnect}>
            {wallet ? shortAddress(wallet.account.address) : 'Подключить Phantom'}
          </button>
        </div>
      </header>

      <main className="taxi-content" id="top">
        <section className="hero-card">
          <p className="eyebrow">Доход без обещанного APY</p>
          <h1>Твой таксопарк платит<br /><span>FARE и акциями</span></h1>
          <p className="hero-copy">Парк делит только реально заработанные комиссии. Нет торгового объёма — нет выплаты.</p>
          <div className="pool-strip">
            <div><small>Касса сейчас</small><strong>{status.deployed ? `${status.pool.nextPool[0]} raw FARE` : '—'}</strong></div>
            <div><small>Активный вес</small><strong>{status.deployed ? status.pool.totalActiveWeight.toString() : '—'} / {totalWeight}</strong></div>
            <div><small>Доход рассчитан до</small><strong>{status.deployed ? formatProtocolTime(status.pool.effectiveCalculatedUntil) : '—'}</strong></div>
          </div>
        </section>

        <section className="panel" aria-labelledby="garage-title">
          <div className="section-title">
            <div><p className="eyebrow">Мой гараж</p><h2 id="garage-title">Машины</h2></div>
            <button className="ghost-button" disabled={busy === 'refresh'} onClick={() => refreshGarage()}>
              {busy === 'refresh' ? 'Обновляем…' : 'Обновить'}
            </button>
          </div>
          <div className="car-list">
            {cars.map(car => <article className="car-row" key={car.asset || car.id}>
              <div className="car-icon" aria-hidden="true">●</div>
              <div className="car-main"><strong>{car.name} <small>{car.id}</small></strong><span>Вес {car.weight}</span></div>
              <div className="durability"><span><b style={{ width: `${car.durability}%` }} /></span><small>Прочность {car.durability}%</small></div>
              <div className="reward">
                <strong>{car.rewardDisplay ? `${car.rewardDisplay.fare} FARE` : car.reward}</strong>
                <small>{car.rewardDisplay
                  ? car.rewardDisplay.stocks.map(stock => `${stock.amount}${stock.rawFallback ? ' raw' : ''} ${stock.symbol}`).join(' · ')
                  : `+ ${car.stocks} в акциях`}</small>
              </div>
              <div className="row-actions">
                <button disabled={Boolean(busy)} onClick={() => runAction(`claim-${car.asset || car.id}`, () => claimMachine(wallet, car, status), 'Награды отправлены в кошелёк.')}>Забрать</button>
                <button disabled={Boolean(busy) || car.missingSeconds === 0} className="secondary" onClick={() => runAction(`repair-${car.asset || car.id}`, () => repairMachine(wallet, car, status), 'Машина восстановлена на 5 дней.')}>
                  {car.missingSeconds === 0 ? 'Полная прочность' : car.repairCost === undefined ? 'Починить' : `Починить · ${car.repairCostDisplay} FARE`}
                </button>
              </div>
            </article>)}
          </div>
          <p className="demo-note">{status.deployed ? 'Данные читаются из finalized Solana accounts.' : 'Демо-данные исчезнут после подключения развернутой Solana-программы.'}</p>
        </section>

        <section className="panel trainee-panel" aria-labelledby="trainee-title">
          <div className="section-title">
            <div><p className="eyebrow">Бесплатный тест</p><h2 id="trainee-title">Стажёрская машина</h2></div>
          </div>
          <p className="trainee-copy">Найдите номер кампании и кодовое слово в наших публикациях. Каждую кампанию можно активировать один раз на кошелёк.</p>
          <div className="trainee-form">
            <label>Кампания<input inputMode="numeric" value={campaignId} onChange={event => setCampaignId(event.target.value.replace(/\D/g, ''))} placeholder="Например, 1" /></label>
            <label>Кодовое слово<input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="Слово из публикации" /></label>
            <button disabled={Boolean(busy) || !campaignId || !keyword.trim()} onClick={() => runAction(
              'activate-trainee',
              () => activateTrainee(wallet, campaignId, keyword, status),
              'Стажёрская машина активирована.',
            )}>Активировать</button>
          </div>
          {trainees.length > 0 && <div className="trainee-list">
            {trainees.map(trainee => <article key={String(trainee.campaignId)}>
              <span><strong>Кампания #{String(trainee.campaignId)} · {trainee.rewardDisplay} FARE</strong><small>Работает до {new Date(Number(trainee.activeUntil) * 1000).toLocaleString('ru-RU')}</small></span>
              <button disabled={Boolean(busy) || trainee.reward === 0n} onClick={() => runAction(
                `claim-trainee-${trainee.campaignId}`,
                () => claimTrainee(wallet, trainee, status),
                'Доход стажёрской машины отправлен.',
              )}>Забрать FARE</button>
            </article>)}
          </div>}
        </section>

        <section className="panel mint-panel" aria-labelledby="mint-title">
          <div className="section-title"><div><p className="eyebrow">1425 машин</p><h2 id="mint-title">Выбрать класс</h2></div></div>
          <div className="class-grid">
            {CLASSES.map((item, classIndex) => {
              const solPrice = status.deployed ? formatSolAmount(status.config.mintPrices[classIndex]) : null;
              const remaining = status.deployed
                ? item.count - Number(status.config.mintedByClass[classIndex])
                : item.count;
              return <article className={`class-card ${item.tone}`} key={item.name}>
                <div className="class-top"><span>{item.name}</span><b>×{item.weight}</b></div>
                <div className="taxi-silhouette" aria-hidden="true">▰</div>
                <dl>
                  <div><dt>Цена</dt><dd>{solPrice ? `${solPrice} SOL` : item.price}</dd></div>
                  <div><dt>Осталось</dt><dd>{remaining} / {item.count}</dd></div>
                </dl>
                <button disabled={Boolean(busy) || remaining === 0} onClick={() => runAction(`mint-${classIndex}`, () => mintMachine(wallet, classIndex, status), `${item.name}: NFT-машина выпущена.`)}>
                  {remaining === 0 ? 'Распродано' : solPrice ? `Купить · ${solPrice} SOL` : 'Купить за SOL'}
                </button>
              </article>;
            })}
          </div>
        </section>

        <p className="jurisdiction-notice">
          Пользователям из юрисдикций, в которых использование xStocks запрещено, нельзя пользоваться stock-функциями проекта.
          Подключая кошелёк, пользователь самостоятельно подтверждает, что вправе пользоваться продуктом в своей стране.
        </p>

        {notice && <div className="taxi-notice" role="status"><span>{notice}{lastSignature && <> · <a href={explorerTransaction(lastSignature)} target="_blank" rel="noreferrer">Explorer</a></>}</span><button onClick={() => setNotice('')}>×</button></div>}
      </main>
    </div>
  );
}

function formatProtocolTime(value) {
  const seconds = Number(value || 0n);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'ещё не считался';
  return new Date(seconds * 1000).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}
