import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart } from 'lightweight-charts';
import { FareFooter, FareHeader } from './FareShareChrome.jsx';

const transactionRows = [
  ['0x8F2A...91C4', 'BUY', '12.40 SOL', '$1,468.78', '5Vf2...K8qP'],
  ['User_4312234', 'SELL', '4.82 SOL', '$570.93', '3Hn9...P2mR'],
  ['0x37B1...AE20', 'BUY', '9.16 SOL', '$1,084.99', '8Ks4...W7tN'],
  ['User_8804192', 'BUY', '2.75 SOL', '$325.74', '2Qa6...M4xL'],
  ['0xC994...110B', 'SELL', '17.20 SOL', '$2,037.34', '7Rb3...C9jF'],
  ['User_1427720', 'BUY', '6.08 SOL', '$720.18', '4Ty8...H5sD'],
];

const holderRows = [
  ['0x8F2A...91C4', '6.21%'],
  ['User_4312234', '3.12%'],
  ['0x37B1...AE20', '2.84%'],
  ['User_8804192', '2.18%'],
  ['0xC994...110B', '1.72%'],
  ['User_1427720', '1.31%'],
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
        vertLine: { color: '#777777', labelBackgroundColor: '#111111' },
        horzLine: { color: '#777777', labelBackgroundColor: '#111111' },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#d7d7d7',
      downColor: '#ffe11a',
      borderUpColor: '#d7d7d7',
      borderDownColor: '#ffe11a',
      wickUpColor: '#d7d7d7',
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

  return <div className="tradingview-widget-shell"><div className="tradingview-widget-container" ref={widgetRef} aria-label="Live SOL to USD chart" /></div>;
}

function TradeForm() {
  const [side, setSide] = useState('buy');
  const [payAmount, setPayAmount] = useState('100');
  const [receiveAmount, setReceiveAmount] = useState('0.8442');
  const flipped = side === 'sell';
  const payToken = flipped ? 'SOL' : 'USD';
  const receiveToken = flipped ? 'USD' : 'SOL';
  const rate = 118.45;
  const cleanAmount = value => value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
  const formatAmount = (value, decimals) => Number.isFinite(value) ? value.toFixed(decimals).replace(/\.?0+$/, '') : '';

  const updatePayAmount = value => {
    const next = cleanAmount(value);
    setPayAmount(next);
    const number = Number(next);
    setReceiveAmount(next === '' ? '' : formatAmount(flipped ? number * rate : number / rate, flipped ? 2 : 4));
  };

  const updateReceiveAmount = value => {
    const next = cleanAmount(value);
    setReceiveAmount(next);
    const number = Number(next);
    setPayAmount(next === '' ? '' : formatAmount(flipped ? number / rate : number * rate, flipped ? 4 : 2));
  };

  const selectSide = nextSide => {
    if (nextSide === side) return;
    setSide(nextSide);
    setPayAmount(receiveAmount);
    setReceiveAmount(payAmount);
  };

  return (
    <section className="trade-swap" aria-label="SOL trade form">
      <div className={`trade-side-tabs${side === 'sell' ? ' is-sell' : ''}`} role="tablist" aria-label="Trade side">
        <button className={side === 'buy' ? 'is-active' : ''} type="button" onClick={() => selectSide('buy')}>BUY</button>
        <button className={side === 'sell' ? 'is-active' : ''} type="button" onClick={() => selectSide('sell')}>SELL</button>
      </div>

      <div className="trade-amount-box">
        <label htmlFor="trade-pay-amount">YOU PAY</label>
        <input id="trade-pay-amount" type="text" inputMode="decimal" value={payAmount} onChange={event => updatePayAmount(event.target.value)} aria-label={`Amount to pay in ${payToken}`} />
        <b>{payToken}</b>
      </div>
      <div className="trade-amount-box">
        <label htmlFor="trade-receive-amount">YOU RECEIVE</label>
        <input id="trade-receive-amount" type="text" inputMode="decimal" value={receiveAmount} onChange={event => updateReceiveAmount(event.target.value)} aria-label={`Amount to receive in ${receiveToken}`} />
        <b>{receiveToken}</b>
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
  const headers = isTransactions ? ['#', 'TRADER', 'TYPE', 'AMOUNT', 'SOLSCAN →'] : ['#', 'HOLDER', 'SUPPLY SHARE'];
  return (
    <section className="trade-board">
      <div className="trade-board-tabs" role="tablist" aria-label="Market data">
        <button className={tab === 'transactions' ? 'is-active' : ''} type="button" onClick={() => setTab('transactions')}>Transactions</button>
        <button className={tab === 'holders' ? 'is-active' : ''} type="button" onClick={() => setTab('holders')}>Holders</button>
      </div>
      <div className={`trade-leaderboard${isTransactions ? '' : ' is-holders'}`} role="table" aria-label={isTransactions ? 'Recent transactions' : 'Largest holders'}>
        <div className="trade-leaderboard-row trade-leaderboard-header" role="row">
          {headers.map(header => <span role="columnheader" key={header}>{header}</span>)}
        </div>
        {rows.map((row, index) => (
          <div className="trade-leaderboard-row" role="row" key={`${tab}-${row[0]}-${index}`}>
            <span data-label="#" role="cell">{index + 1}</span>
            <span className={`trade-wallet-cell${isTransactions ? ' is-transaction' : ''}`} data-label={headers[1]} role="cell">
              {!isTransactions && <img src="/brand/fare-driver.png" alt="" />}{row[0]}
            </span>
            {isTransactions ? <>
              <span data-label={headers[2]} role="cell" className={`is-${row[1].toLowerCase()}`}>{row[1]}</span>
              <span data-label={headers[3]} role="cell">{row[2]} · {row[3]}</span>
              <a className="trade-solscan-link" data-label={headers[4]} role="cell" href={`https://solscan.io/tx/${row[4]}`} target="_blank" rel="noreferrer">View ↗</a>
            </> : <span data-label={headers[2]} role="cell">{row[1]}</span>}
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
          <h1>TRADE</h1>
        </section>

        <section className="trade-workspace container">
          <article className="trade-chart-card">
            <div className="trade-chart-heading">
              <div className="trade-chart-symbol"><span>SOL / USD</span><small>↗ 3.38% · 24H</small></div>
              <div className="trade-chart-price-row">
                <strong>$118.45</strong>
                <p>24H volume<br /><b>$3.62M</b></p>
              </div>
            </div>
            <TradingViewChart />
          </article>
          <TradeForm />
        </section>
        <MarketTables />
      </main>
      <FareFooter linkPrefix="/" />
    </div>
  );
}
