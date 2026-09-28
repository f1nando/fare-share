import { useCallback, useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart, HistogramSeries, LineStyle } from 'lightweight-charts';
import {
  executeTrade,
  loadCandles,
  loadHolders,
  loadTradeBalance,
  loadTrades,
  loadTradeToken,
  quoteTrade,
  subscribeTradeEvents,
} from './tradeApi.js';

function LiveTradeChart({ candles, symbol }) {
  const widgetRef = useRef(null);

  useEffect(() => {
    const host = widgetRef.current;
    if (!host) return undefined;
    const chart = createChart(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      layout: { background: { type: ColorType.Solid, color: '#111111' }, textColor: '#8f8f8f' },
      grid: { vertLines: { color: '#202020' }, horzLines: { color: '#202020' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: .08, bottom: .22 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 7, minBarSpacing: 3 },
      crosshair: {
        vertLine: { color: '#666', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#262626' },
        horzLine: { color: '#666', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#262626' },
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#25d989', downColor: '#ff6470', borderUpColor: '#25d989', borderDownColor: '#ff6470',
      wickUpColor: '#25d989', wickDownColor: '#ff6470',
      priceLineColor: '#25d989', priceLineStyle: LineStyle.Dashed,
      priceFormat: { type: 'custom', minMove: 1, formatter: formatChartValue },
    });
    if (candles.length) {
      series.setData(candles);
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: .76, bottom: 0 } });
      volumeSeries.setData(candles.map(candle => ({
        time: candle.time,
        value: candle.volume,
        color: candle.close >= candle.open ? 'rgb(37 217 137 / 48%)' : 'rgb(255 100 112 / 45%)',
      })));
      chart.timeScale().fitContent();
    }
    const resizeObserver = new ResizeObserver(([entry]) => chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height }));
    resizeObserver.observe(host);
    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [candles]);

  return <div className="tradingview-widget-shell"><div className="tradingview-widget-container" ref={widgetRef} aria-label={`Live ${symbol} to SOL chart`} /></div>;
}

function TradeForm({ token, wallet, connectWallet }) {
  const [side, setSide] = useState('buy');
  const [payAmount, setPayAmount] = useState('0.1');
  const [quote, setQuote] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [balanceBusy, setBalanceBusy] = useState(false);
  const symbol = token?.symbol || 'TOKEN';
  const payToken = side === 'sell' ? symbol : 'SOL';
  const receiveToken = side === 'sell' ? 'SOL' : symbol;
  const cleanAmount = value => value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

  useEffect(() => {
    const amount = Number(payAmount);
    if (!token?.tradingAvailable || !Number.isFinite(amount) || amount <= 0) {
      setQuote(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      quoteTrade(side, amount).then(value => {
        if (!controller.signal.aborted) {
          setQuote(value);
          setNotice('');
        }
      }).catch(error => {
        if (!controller.signal.aborted) {
          setQuote(null);
          setNotice(error.message);
        }
      });
    }, 450);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [payAmount, side, token?.tradingAvailable]);

  async function submit() {
    setBusy(true);
    setNotice('');
    try {
      const connection = wallet || await connectWallet();
      const freshQuote = await quoteTrade(side, Number(payAmount));
      setQuote(freshQuote);
      setNotice('Approve the transaction in your wallet…');
      const signature = await executeTrade(connection, freshQuote.quoteId);
      setNotice(`Submitted: ${shortAddress(signature)}`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function selectBalancePortion(portion) {
    setBalanceBusy(true);
    setNotice('');
    try {
      const connection = wallet || await connectWallet();
      const balance = await loadTradeBalance(connection.account.address);
      const available = side === 'buy' ? Math.max(0, balance.sol - .005) : balance.token;
      setPayAmount(formatInputAmount(available * portion, side === 'buy' ? 9 : token?.decimals || 6));
      if (side === 'buy' && portion === 1) setNotice('0.005 SOL is reserved for network and priority fees.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBalanceBusy(false);
    }
  }

  return (
    <section className="trade-swap" aria-label={`${symbol} trade form`}>
      <div className={`trade-side-tabs${side === 'sell' ? ' is-sell' : ''}`} role="tablist" aria-label="Trade side">
        <button className={side === 'buy' ? 'is-active' : ''} type="button" onClick={() => setSide('buy')}>BUY</button>
        <button className={side === 'sell' ? 'is-active' : ''} type="button" onClick={() => setSide('sell')}>SELL</button>
      </div>
      <div className="trade-amount-box">
        <div className="trade-amount-heading">
          <label htmlFor="trade-pay-amount">YOU PAY</label>
          <b>{payToken}</b>
        </div>
        <input id="trade-pay-amount" type="text" inputMode="decimal" value={payAmount} onChange={event => setPayAmount(cleanAmount(event.target.value))} aria-label={`Amount to pay in ${payToken}`} />
      </div>
      <div className="trade-quick-actions" aria-label={`${payToken} balance shortcuts`}>
        <button type="button" disabled={balanceBusy} onClick={() => selectBalancePortion(.5)}>HALF</button>
        <button type="button" disabled={balanceBusy} onClick={() => selectBalancePortion(1)}>MAX</button>
      </div>
      <div className="trade-amount-box">
        <div className="trade-amount-heading">
          <label htmlFor="trade-receive-amount">YOU RECEIVE</label>
          <b>{receiveToken}</b>
        </div>
        <input id="trade-receive-amount" type="text" value={quote ? formatToken(quote.outputAmount) : '—'} readOnly aria-label={`Amount to receive in ${receiveToken}`} />
      </div>
      <dl className="trade-rate">
        <div><dt>Route</dt><dd>{quote?.route?.join(' → ') || token?.routeLabel || 'Checking…'}</dd></div>
        <div><dt>Price impact</dt><dd>{quote ? `${formatNumber(quote.priceImpactPct, 3)}%` : '—'}</dd></div>
        <div><dt>Stage</dt><dd>{formatStage(token?.stage)}</dd></div>
      </dl>
      {notice && <p className="trade-notice" role="status">{notice}</p>}
      <button className="trade-submit" type="button" disabled={busy || !token?.tradingAvailable} onClick={submit}>
        {busy ? 'Preparing…' : !token?.tradingAvailable ? 'Trading unavailable' : wallet ? `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}` : 'Connect wallet'}
      </button>
    </section>
  );
}

function MarketTables({ trades, holders, symbol }) {
  const [tab, setTab] = useState('transactions');
  const [now, setNow] = useState(Date.now());
  const isTransactions = tab === 'transactions';
  const headers = isTransactions ? ['#', 'TRADER', 'TYPE', 'AMOUNT', 'TIME →'] : ['#', 'HOLDER', 'SUPPLY SHARE'];
  const rows = isTransactions ? trades : holders;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
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
        {!rows.length && <div className="trade-empty">Waiting for indexed mainnet data…</div>}
        {rows.map((row, index) => {
          const isLiquidityPool = !isTransactions && row.kind === 'liquidity_pool';
          const rank = isTransactions ? index + 1 : rows.slice(0, index + 1).filter(item => item.kind !== 'liquidity_pool').length;
          return <div className={`trade-leaderboard-row${isLiquidityPool ? ' is-liquidity-pool' : ''}`} role="row" key={isTransactions ? row.signature : row.owner}>
            <span data-label="#" role="cell">{isLiquidityPool ? '' : rank}</span>
            <span className="trade-wallet-cell is-address" data-label={headers[1]} role="cell">
              <a className="trade-wallet-link" href={`https://solscan.io/account/${encodeURIComponent(isTransactions ? row.wallet : row.owner)}`} target="_blank" rel="noreferrer">
                {isLiquidityPool ? <><b>PUMP.FUN LIQUIDITY POOL</b><small>{shortAddress(row.owner)}</small></> : shortAddress(isTransactions ? row.wallet : row.owner)}
              </a>
            </span>
            {isTransactions ? <>
              <span data-label={headers[2]} role="cell" className={`is-${row.side}`}>{row.side.toUpperCase()}</span>
              <span data-label={headers[3]} role="cell">{formatTradeAmount(row.tokenAmount)} {symbol} · {formatTradeAmount(row.solAmount)} SOL</span>
              <a className="trade-solscan-link" data-label={headers[4]} role="cell" href={`https://solscan.io/tx/${row.signature}`} target="_blank" rel="noreferrer">{formatRelativeTime(row.blockTime, now)} ↗</a>
            </> : <span data-label={headers[2]} role="cell">{formatNumber(isLiquidityPool ? row.supplyLeftPercent : row.supplyShare, 4)}%{isLiquidityPool && <small> SUPPLY LEFT</small>}</span>}
          </div>
        })}
      </div>
    </section>
  );
}

export function TradePage({ wallet, connectWallet }) {
  const [token, setToken] = useState(null);
  const [trades, setTrades] = useState([]);
  const [holders, setHolders] = useState([]);
  const [candles, setCandles] = useState([]);
  const [interval, setInterval] = useState('5m');

  const refreshToken = useCallback(() => loadTradeToken().then(setToken).catch(error => console.warn(error.message)), []);
  const refreshTrades = useCallback(() => loadTrades().then(value => setTrades(value.trades)).catch(error => console.warn(error.message)), []);
  const refreshHolders = useCallback(() => loadHolders().then(value => setHolders(value.holders)).catch(error => console.warn(error.message)), []);
  const refreshCandles = useCallback(() => loadCandles(interval).then(value => setCandles(value.candles)).catch(error => console.warn(error.message)), [interval]);

  useEffect(() => {
    void Promise.all([refreshToken(), refreshTrades(), refreshHolders(), refreshCandles()]);
    return subscribeTradeEvents(type => {
      if (type === 'token') void refreshToken();
      if (type === 'trades') void Promise.all([refreshToken(), refreshTrades(), refreshCandles()]);
      if (type === 'holders') void refreshHolders();
    });
  }, [refreshCandles, refreshHolders, refreshToken, refreshTrades]);

  const symbol = token?.symbol || 'FARE';
  const latestCandle = [...candles].reverse().find(candle => candle.volume > 0) || candles.at(-1);
  return (
    <main id="top">
      <section className="trade-intro container"><h1>TRADE</h1></section>
      <section className="trade-workspace container">
        <article className="trade-chart-card">
          <div className="trade-chart-heading">
            <div className="trade-chart-toolbar">
              <div className="trade-chart-symbol">
                <span>MCAP</span>
                <small className={Number(token?.change24h || 0) < 0 ? 'is-negative' : 'is-positive'}>{signedPercent(token?.change24h)} · 24H</small>
                {token?.mint && <a href={`https://pump.fun/coin/${token.mint}`} target="_blank" rel="noreferrer">Open on PumpFun ↗</a>}
              </div>
              <div className="trade-chart-periods" aria-label="Candle interval">
                {['1m', '5m', '15m', '1h', '4h', '1d'].map(value => (
                  <button className={interval === value ? 'is-active' : ''} type="button" onClick={() => setInterval(value)} key={value}>{value.endsWith('m') ? value : value.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <div className="trade-chart-price-row">
              <strong>{formatChartValue(latestCandle?.close || token?.marketCapUsd || 0)}</strong>
              <p>Token price <b>{token?.priceUsd ? <CompactPrice value={token.priceUsd} prefix="$" /> : '—'}</b><br />24H volume <b>{formatNumber(token?.volume24hSol || 0, 2)} SOL</b></p>
            </div>
          </div>
          <LiveTradeChart candles={candles} symbol={symbol} />
        </article>
        <TradeForm token={token} wallet={wallet} connectWallet={connectWallet} />
      </section>
      <MarketTables trades={trades} holders={holders} symbol={symbol} />
    </main>
  );
}

function shortAddress(value) {
  const text = String(value || '');
  return text.length > 12 ? `${text.slice(0, 5)}…${text.slice(-5)}` : text;
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function formatToken(value) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function formatTradeAmount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number === 0) return '0';
  const magnitude = Math.floor(Math.log10(Math.abs(number)));
  const decimalPlaces = Math.min(12, Math.max(0, 2 - magnitude));
  const factor = 10 ** decimalPlaces;
  const truncated = Math.trunc(number * factor) / factor;
  return truncated.toLocaleString('en-US', { maximumFractionDigits: decimalPlaces });
}

function formatRelativeTime(value, now) {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function formatInputAmount(value, decimals) {
  return Number(value || 0).toFixed(Math.min(Math.max(decimals, 0), 9)).replace(/\.?0+$/, '');
}

function formatPrice(value) {
  const number = Number(value || 0);
  return number >= 1 ? formatNumber(number, 4) : number.toPrecision(4).replace(/(?:\.0+|(?:(\.\d*?)0+))$/, '$1');
}

function CompactPrice({ value, prefix = '' }) {
  const parts = compactPriceParts(value);
  if (!parts.compact) return <>{prefix}{parts.text}</>;
  return <>{prefix}0.0<sub>{parts.hiddenZeros}</sub>{parts.significant}</>;
}

function compactPriceText(value) {
  const parts = compactPriceParts(value);
  return parts.compact ? `0.0${toSubscript(parts.hiddenZeros)}${parts.significant}` : parts.text;
}

function formatChartValue(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000_000) return `$${formatNumber(number / 1_000_000_000, 2)}B`;
  if (number >= 1_000_000) return `$${formatNumber(number / 1_000_000, 2)}M`;
  if (number >= 1_000) return `$${formatNumber(number / 1_000, 2)}K`;
  return `$${compactPriceText(number)}`;
}

function compactPriceParts(value) {
  const number = Math.abs(Number(value || 0));
  if (!number || number >= .001) return { compact: false, text: formatPrice(number) };
  const leadingZeros = Math.max(1, Math.floor(-Math.log10(number)));
  const hiddenZeros = Math.max(0, leadingZeros - 1);
  const significant = (number * 10 ** (leadingZeros + 1)).toPrecision(4)
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '')
    .replace('.', '');
  return { compact: true, hiddenZeros, significant };
}

function toSubscript(value) {
  const digits = '₀₁₂₃₄₅₆₇₈₉';
  return String(value).replace(/\d/g, digit => digits[Number(digit)]);
}

function signedPercent(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? '↗ +' : '↘ '}${formatNumber(number, 2)}%`;
}

function formatStage(value) {
  return ({ bonding_curve: 'Bonding curve', migrating: 'Migrating', pumpswap: 'PumpSwap', external: 'DEX', unknown: 'Checking…' })[value] || 'Checking…';
}
