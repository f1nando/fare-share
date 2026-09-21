import { useEffect, useMemo, useState } from 'react';
import { CityBackground } from './CityBackground.jsx';
import { connectWallet, loadProtocolStatus, shortAddress } from './protocol/solana.js';

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
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    loadProtocolStatus()
      .then(next => active && setStatus({ ...next, loading: false }))
      .catch(() => active && setStatus({ loading: false, deployed: false, network: 'devnet' }));
    return () => { active = false; };
  }, []);

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

  function unavailable(action) {
    setNotice(status.deployed
      ? `${action}: инструкция появится после подключения сгенерированного клиента программы.`
      : `${action}: программа ещё не развёрнута в devnet. Сейчас открыт безопасный демо-режим.`);
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
            <div><small>Касса сейчас</small><strong>—</strong></div>
            <div><small>Активный вес</small><strong>— / {totalWeight}</strong></div>
            <div><small>Следующий расчёт</small><strong>ожидает backend</strong></div>
          </div>
        </section>

        <section className="panel" aria-labelledby="garage-title">
          <div className="section-title">
            <div><p className="eyebrow">Мой гараж</p><h2 id="garage-title">Машины</h2></div>
            <button className="ghost-button" onClick={() => unavailable('Обновление')}>Обновить</button>
          </div>
          <div className="car-list">
            {DEMO_CARS.map(car => <article className="car-row" key={car.id}>
              <div className="car-icon" aria-hidden="true">●</div>
              <div className="car-main"><strong>{car.name} <small>{car.id}</small></strong><span>Вес {car.weight}</span></div>
              <div className="durability"><span><b style={{ width: `${car.durability}%` }} /></span><small>Прочность {car.durability}%</small></div>
              <div className="reward"><strong>{car.reward}</strong><small>+ {car.stocks} в акциях</small></div>
              <div className="row-actions">
                <button onClick={() => unavailable('Claim')}>Забрать</button>
                <button className="secondary" onClick={() => unavailable('Ремонт')}>Починить</button>
              </div>
            </article>)}
          </div>
          <p className="demo-note">Демо-данные исчезнут после подключения развернутой Solana-программы.</p>
        </section>

        <section className="panel mint-panel" aria-labelledby="mint-title">
          <div className="section-title"><div><p className="eyebrow">1425 машин</p><h2 id="mint-title">Выбрать класс</h2></div></div>
          <div className="class-grid">
            {CLASSES.map(item => <article className={`class-card ${item.tone}`} key={item.name}>
              <div className="class-top"><span>{item.name}</span><b>×{item.weight}</b></div>
              <div className="taxi-silhouette" aria-hidden="true">▰</div>
              <dl><div><dt>Цена</dt><dd>{item.price}</dd></div><div><dt>Тираж</dt><dd>{item.count}</dd></div></dl>
              <button onClick={() => unavailable(`Mint ${item.name}`)}>Купить за SOL</button>
            </article>)}
          </div>
        </section>

        {notice && <div className="taxi-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}
      </main>
    </div>
  );
}

