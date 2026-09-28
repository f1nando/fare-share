import { useEffect, useRef, useState } from 'react';
import { FareHeader } from './FareShareChrome.jsx';

const traders = [
  ['0x8F2A...91C4', '82,400.000 SOL', '$6,938,080', '6.21%'],
  ['User_4312234', '21,870.450 SOL', '$1,842,677', '3.12%'],
  ['0x37B1...AE20', '16,909.125 SOL', '$1,423,641', '2.84%'],
  ['User_8804192', '12,445.900 SOL', '$1,048,341', '2.18%'],
  ['0xC994...110B', '9,860.225 SOL', '$830,814', '1.72%'],
  ['User_1427720', '7,104.880 SOL', '$598,631', '1.31%'],
];

function TradingViewChart() {
  const widgetRef = useRef(null);

  useEffect(() => {
    const host = widgetRef.current;
    if (!host || host.dataset.initialized) return;
    host.dataset.initialized = 'true';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: 'COINBASE:SOLUSD',
      interval: '60',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(17, 17, 17, 1)',
      gridColor: 'rgba(255, 255, 255, 0.07)',
      hide_top_toolbar: true,
      hide_side_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    });
    host.appendChild(script);
  }, []);

  return <div className="tradingview-widget-container" ref={widgetRef} aria-label="Live SOL to USD chart" />;
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3v15m0 0-4-4m4 4 4-4M17 21V6m0 0-4 4m4-4 4 4" />
    </svg>
  );
}

function TradeForm() {
  const [side, setSide] = useState('buy');
  const [flipped, setFlipped] = useState(false);
  const pay = flipped ? { amount: '1.00', token: 'SOL' } : { amount: '100', token: 'USD' };
  const receive = flipped ? { amount: '118.45', token: 'USD' } : { amount: '0.8442', token: 'SOL' };

  return (
    <section className="trade-swap" aria-label="SOL trade form">
      <div className="trade-side-tabs" role="tablist" aria-label="Trade side">
        <button className={side === 'buy' ? 'is-active' : ''} type="button" onClick={() => setSide('buy')}>BUY</button>
        <button className={side === 'sell' ? 'is-active' : ''} type="button" onClick={() => setSide('sell')}>SELL</button>
      </div>

      <div className="trade-amount-box">
        <span>YOU PAY</span>
        <strong>{pay.amount}</strong>
        <b>{pay.token}</b>
      </div>
      <div className="trade-flip-row">
        <button type="button" aria-label="Swap pay and receive tokens" onClick={() => setFlipped(value => !value)}><SwapIcon /></button>
      </div>
      <div className="trade-amount-box">
        <span>YOU RECEIVE</span>
        <strong>{receive.amount}</strong>
        <b>{receive.token}</b>
      </div>

      <dl className="trade-rate">
        <div><dt>Rate</dt><dd>1 SOL = $118.45</dd></div>
        <div><dt>Price impact</dt><dd>0.12%</dd></div>
      </dl>
      <button className="trade-submit" type="button">{side === 'buy' ? 'Buy' : 'Sell'} SOL</button>
    </section>
  );
}

function TradersTable() {
  const [tab, setTab] = useState('top');
  const rows = tab === 'top' ? traders : traders.slice().reverse();
  return (
    <section className="trade-board">
      <div className="trade-board-tabs">
        <button className={tab === 'top' ? 'is-active' : ''} type="button" onClick={() => setTab('top')}>Top Traders</button>
        <button className={tab === 'transactions' ? 'is-active' : ''} type="button" onClick={() => setTab('transactions')}>Transactions</button>
      </div>
      <div className="trade-table-wrap">
        <table>
          <thead><tr><th>#</th><th>TRADER</th><th>BALANCE</th><th>VALUE</th><th>Supply share</th></tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={row[0]}>
              <td>{index + 1}</td>
              <td><img src="/brand/fare-driver.png" alt="" /><b>{row[0]}</b></td>
              <td>{row[1]}</td><td>{row[2]}</td>
              <td><span>{row[3]}</span><i><em style={{ width: row[3] }} /></i></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

export function TradePage() {
  return (
    <div className="fare-page trade-page" id="top">
      <FareHeader linkPrefix="/" activeItem="trade" />
      <main>
        <section className="trade-intro container">
          <div><span>$SOL TOKEN</span><h1>TRADE</h1></div>
          <p>Trade Solana with a live market chart.<br />Track price action and swap tokens in one place.</p>
        </section>

        <section className="trade-workspace container">
          <article className="trade-chart-card">
            <div className="trade-chart-heading">
              <div><span>SOL / USD</span><strong>$118.45</strong><small>↗ 3.38% · 24H</small></div>
              <p>24H volume<br /><b>$3.62M</b></p>
            </div>
            <TradingViewChart />
          </article>
          <TradeForm />
        </section>
        <TradersTable />
      </main>
    </div>
  );
}
