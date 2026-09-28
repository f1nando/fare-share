import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart } from 'lightweight-charts';
import { FareHeader } from './FareShareChrome.jsx';

const transactionRows = [
  ['0x8F2A...91C4', 'BUY', '12.40 SOL', '$1,468.78'],
  ['User_4312234', 'SELL', '4.82 SOL', '$570.93'],
  ['0x37B1...AE20', 'BUY', '9.16 SOL', '$1,084.99'],
  ['User_8804192', 'BUY', '2.75 SOL', '$325.74'],
  ['0xC994...110B', 'SELL', '17.20 SOL', '$2,037.34'],
  ['User_1427720', 'BUY', '6.08 SOL', '$720.18'],
];

const holderRows = [
  ['0x8F2A...91C4', '82,400.000 SOL', '$9,760,280'],
  ['User_4312234', '21,870.450 SOL', '$2,591,550'],
  ['0x37B1...AE20', '16,909.125 SOL', '$2,004,080'],
  ['User_8804192', '12,445.900 SOL', '$1,474,240'],
  ['0xC994...110B', '9,860.225 SOL', '$1,168,100'],
  ['User_1427720', '7,104.880 SOL', '$841,570'],
];

function TradingViewChart() {
  const widgetRef = useRef(null);

  useEffect(() => {
    const host = widgetRef.current;
    if (!host) return undefined;

    const chart = createChart(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#111111' },
        textColor: '#8f8f8f',
      },
      grid: {
        vertLines: { color: '#242424' },
        horzLines: { color: '#242424' },
      },
      rightPriceScale: { borderColor: '#333333' },
      timeScale: { borderColor: '#333333', timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: '#777777', labelBackgroundColor: '#ffe11a' },
        horzLine: { color: '#777777', labelBackgroundColor: '#ffe11a' },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#ffffff',
      downColor: '#ffe11a',
      borderUpColor: '#ffffff',
      borderDownColor: '#ffe11a',
      wickUpColor: '#ffffff',
      wickDownColor: '#ffe11a',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    const now = Math.floor(Date.now() / 3600000) * 3600;
    const fallback = Array.from({ length: 72 }, (_, index) => {
      const time = now - (71 - index) * 3600;
      const open = 112 + index * .09 + Math.sin(index * .7) * 1.8;
      const close = open + Math.sin(index * 1.37) * 1.2;
      return { time, open, close, high: Math.max(open, close) + .8, low: Math.min(open, close) - .8 };
    });
    series.setData(fallback);
    chart.timeScale().fitContent();

    const controller = new AbortController();
    fetch('https://api.exchange.coinbase.com/products/SOL-USD/candles?granularity=3600', { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Coinbase candles request failed: ${response.status}`);
        return response.json();
      })
      .then(candles => {
        const data = candles
          .map(([time, low, high, open, close]) => ({ time, low, high, open, close }))
          .sort((left, right) => left.time - right.time);
        if (data.length) {
          series.setData(data);
          chart.timeScale().fitContent();
        }
      })
      .catch(error => {
        if (error.name !== 'AbortError') console.warn('Using fallback SOL chart data', error);
      });

    const resizeObserver = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    resizeObserver.observe(host);

    return () => {
      controller.abort();
      resizeObserver.disconnect();
      chart.remove();
    };
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

function MarketTables() {
  const [tab, setTab] = useState('transactions');
  const isTransactions = tab === 'transactions';
  const rows = isTransactions ? transactionRows : holderRows;
  const headers = isTransactions ? ['#', 'TRADER', 'TYPE', 'AMOUNT'] : ['#', 'HOLDER', 'BALANCE', 'VALUE'];
  return (
    <section className="trade-board">
      <div className="trade-board-tabs" role="tablist" aria-label="Market data">
        <button className={tab === 'transactions' ? 'is-active' : ''} type="button" onClick={() => setTab('transactions')}>Transactions</button>
        <button className={tab === 'holders' ? 'is-active' : ''} type="button" onClick={() => setTab('holders')}>Holders</button>
      </div>
      <div className="trade-leaderboard" role="table" aria-label={isTransactions ? 'Recent transactions' : 'Largest holders'}>
        <div className="trade-leaderboard-row trade-leaderboard-header" role="row">
          {headers.map(header => <span role="columnheader" key={header}>{header}</span>)}
        </div>
        {rows.map((row, index) => (
          <div className="trade-leaderboard-row" role="row" key={`${tab}-${row[0]}-${index}`}>
            <span data-label="#" role="cell">{index + 1}</span>
            <span className="trade-wallet-cell" data-label={headers[1]} role="cell"><img src="/brand/fare-driver.png" alt="" />{row[0]}</span>
            <span data-label={headers[2]} role="cell" className={isTransactions ? `is-${row[1].toLowerCase()}` : undefined}>{row[1]}</span>
            <span data-label={headers[3]} role="cell">{isTransactions ? `${row[2]} · ${row[3]}` : row[2]}</span>
          </div>
        ))}
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
        <MarketTables />
      </main>
    </div>
  );
}
