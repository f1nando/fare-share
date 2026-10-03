import type { Collection } from 'mongodb';
import { jupiterRequest } from './jupiterHttp.js';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const STOCKS = [
  ['UBERx', 'XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB'],
  ['TSLAx', 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB'],
  ['GOOGLx', 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN'],
  ['AMZNx', 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg'],
] as const;
const SAMPLE_LAMPORTS = [10_000_000, 50_000_000, 100_000_000] as const;

export interface StockLiquidityRoute {
  inputLamports: string;
  available: boolean;
  outputAmount?: string;
  priceImpactPct?: number;
  hops?: number;
  error?: string;
}

export interface StockLiquiditySnapshotDocument {
  symbol: string;
  mint: string;
  routes: StockLiquidityRoute[];
  checkedAt: Date;
  expiresAt: Date;
}

export function createStockLiquidityMonitor(
  collection: Collection<StockLiquiditySnapshotDocument>,
  apiKey?: string,
) {
  let running: Promise<void> | null = null;

  async function probe() {
    if (running) return running;
    running = (async () => {
      const checkedAt = new Date();
      const expiresAt = new Date(checkedAt.getTime() + 30 * 24 * 60 * 60 * 1_000);
      const documents = await Promise.all(STOCKS.map(async ([symbol, mint]) => ({
        symbol,
        mint,
        routes: await Promise.all(SAMPLE_LAMPORTS.map(amount => quote(mint, amount, apiKey))),
        checkedAt,
        expiresAt,
      })));
      await collection.insertMany(documents);
    })().finally(() => { running = null; });
    return running;
  }

  async function report(refresh = false) {
    const latest = await collection.findOne({}, { sort: { checkedAt: -1 } });
    if (refresh || !latest || Date.now() - latest.checkedAt.getTime() > 5 * 60 * 1_000) await probe();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    const snapshots = await collection.find({ checkedAt: { $gte: since } }).sort({ checkedAt: -1 }).toArray();
    return {
      sampleSol: SAMPLE_LAMPORTS.map(amount => amount / 1_000_000_000),
      stocks: STOCKS.map(([symbol, mint]) => summarize(symbol, mint, snapshots)),
    };
  }

  return { probe, report };
}

async function quote(mint: string, amount: number, apiKey?: string): Promise<StockLiquidityRoute> {
  const query = new URLSearchParams({
    inputMint: WSOL_MINT,
    outputMint: mint,
    amount: String(amount),
    slippageBps: '500',
    restrictIntermediateTokens: 'true',
  });
  try {
    const response = await jupiterRequest(`https://api.jup.ag/swap/v1/quote?${query}`, {
      headers: { accept: 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
    }, { operation: 'stock liquidity quote', requestTimeoutMs: 10_000 });
    const result = await response.json() as Record<string, unknown>;
    const outputAmount = String(result.outAmount || '');
    const routePlan = Array.isArray(result.routePlan) ? result.routePlan : [];
    if (!outputAmount || BigInt(outputAmount) <= 0n || !routePlan.length) throw new Error(String(result.error || 'No route'));
    return {
      inputLamports: String(amount),
      available: true,
      outputAmount,
      priceImpactPct: Number(result.priceImpactPct || 0),
      hops: routePlan.length,
    };
  } catch (error) {
    return { inputLamports: String(amount), available: false, error: (error as Error).message.slice(0, 180) };
  }
}

function summarize(symbol: string, mint: string, snapshots: StockLiquiditySnapshotDocument[]) {
  const own = snapshots.filter(snapshot => snapshot.symbol === symbol);
  const latest = own[0];
  const last24h = own.filter(snapshot => snapshot.checkedAt.getTime() >= Date.now() - 24 * 60 * 60 * 1_000);
  const availability = (items: StockLiquiditySnapshotDocument[]) => {
    const routes = items.flatMap(item => item.routes);
    return routes.length ? Math.round(routes.filter(route => route.available).length / routes.length * 100) : null;
  };
  return {
    symbol,
    mint,
    checkedAt: latest?.checkedAt || null,
    routes: latest?.routes || [],
    availability24h: availability(last24h),
    availability7d: availability(own),
    samples24h: last24h.length,
    samples7d: own.length,
  };
}
