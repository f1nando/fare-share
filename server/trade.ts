import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { address, type Address } from '@solana/kit';
import type { ServerResponse } from 'node:http';
import WebSocket from 'ws';
import type { TaxiDatabase } from './database.js';
import type { ServerConfig } from './config.js';
import { derivePumpBondingCurve, WSOL_MINT } from './pump.js';
import { jupiterRequest } from './jupiterHttp.js';
import { requestQueues, runRateLimitedAttempts } from './requestLimits.js';

const JUPITER_SWAP_URL = 'https://api.jup.ag/swap/v1';
const JUPITER_PRICE_URL = 'https://api.jup.ag/price/v3';
const LAMPORTS_PER_SOL = 1_000_000_000;

export type TradeStage = 'bonding_curve' | 'migrating' | 'pumpswap' | 'external' | 'unknown';

export interface TradeTransactionDocument {
  mint: string;
  signature: string;
  wallet: string;
  side: 'buy' | 'sell';
  tokenAmountRaw: string;
  tokenAmount: number;
  solAmountLamports: string;
  solAmount: number;
  priceSol: number;
  priceUsd?: number;
  slot: number;
  blockTime: Date;
  status: 'confirmed' | 'finalized';
  createdAt: Date;
}

export interface TradeHolderDocument {
  mint: string;
  owner: string;
  balanceRaw: string;
  balance: number;
  supplyShare: number;
  snapshotId: string;
  updatedSlot: number;
  updatedAt: Date;
}

export interface TradeStateDocument {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  supplyRaw: string;
  stage: TradeStage;
  bondingCurve?: string;
  routeLabel?: string;
  tradingAvailable: boolean;
  lastTradeSlot: number;
  lastHolderSlot: number;
  solUsd?: number;
  updatedAt: Date;
}

interface JsonRecord { [key: string]: unknown }

interface CachedQuote {
  expiresAt: number;
  response: JsonRecord;
  side: 'buy' | 'sell';
}

export class TradeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export class TradeService {
  readonly mint: Address;
  private readonly events = new EventEmitter();
  private readonly quotes = new Map<string, CachedQuote>();
  private readonly rpcUrl: string;
  private state: TradeStateDocument;
  private stopped = false;
  private syncingTrades = false;
  private syncingHolders = false;
  private syncingState = false;
  private providerRetryAt = 0;
  private lastFailureLogAt = 0;
  private socket?: WebSocket;
  private socketHeartbeat?: NodeJS.Timeout;
  private socketReconnect?: NodeJS.Timeout;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly config: ServerConfig, private readonly database: TaxiDatabase) {
    if (!config.tradeMint) throw new Error('TRADE_MINT is required to start the trade service');
    this.mint = address(config.tradeMint);
    this.rpcUrl = config.heliusApiKey
      ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(config.heliusApiKey)}`
      : config.solanaRpcUrl;
    this.state = {
      mint: String(this.mint),
      name: 'Fare Share',
      symbol: 'FARE',
      decimals: 6,
      supplyRaw: '0',
      stage: 'unknown',
      tradingAvailable: false,
      lastTradeSlot: 0,
      lastHolderSlot: 0,
      updatedAt: new Date(0),
    };
  }

  start() {
    void this.bootstrap();
    this.connectLiveStream();
    this.timers.push(setInterval(() => void this.syncRecentTrades(), this.config.tradePollIntervalMs));
    this.timers.push(setInterval(() => void this.refreshHolders(), this.config.tradeHolderRefreshMs));
    this.timers.push(setInterval(() => void this.refreshState(), this.config.tradeStateRefreshMs));
  }

  stop() {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.socketHeartbeat) clearInterval(this.socketHeartbeat);
    if (this.socketReconnect) clearTimeout(this.socketReconnect);
    this.socket?.close();
    this.events.removeAllListeners();
  }

  private async bootstrap() {
    const saved = await this.database.tradeState.findOne({ mint: String(this.mint) });
    if (saved) this.state = saved;
    await Promise.allSettled([this.refreshState(), this.refreshHolders()]);
    await this.backfillTrades();
  }

  async tokenSnapshot() {
    const latest = await this.database.tradeTransactions.findOne(
      { mint: String(this.mint) },
      { sort: { blockTime: -1 } },
    );
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.database.tradeTransactions.find(
      { mint: String(this.mint), blockTime: { $gte: since } },
      { projection: { solAmount: 1, priceSol: 1, blockTime: 1 } },
    ).sort({ blockTime: 1 }).toArray();
    const firstPrice = recent[0]?.priceSol;
    const lastPrice = latest?.priceSol;
    const change24h = firstPrice && lastPrice ? ((lastPrice / firstPrice) - 1) * 100 : 0;
    const volume24h = recent.reduce((total, row) => total + row.solAmount, 0);
    const supply = Number(this.state.supplyRaw) / 10 ** this.state.decimals;
    return {
      ...this.publicState(),
      priceSol: lastPrice || 0,
      priceUsd: lastPrice && this.state.solUsd ? lastPrice * this.state.solUsd : 0,
      change24h,
      volume24hSol: volume24h,
      volume24hUsd: this.state.solUsd ? volume24h * this.state.solUsd : 0,
      marketCapUsd: lastPrice && this.state.solUsd ? supply * lastPrice * this.state.solUsd : 0,
      holders: await this.database.tradeHolders.countDocuments({ mint: String(this.mint), balance: { $gt: 0 } }),
    };
  }

  async listTrades(limit = 50, before?: string) {
    const filter: JsonRecord = { mint: String(this.mint) };
    if (before) filter.blockTime = { $lt: new Date(before) };
    const rows = await this.database.tradeTransactions.find(filter)
      .sort({ blockTime: -1 }).limit(Math.min(Math.max(limit, 1), 100)).toArray();
    return { trades: rows, nextCursor: rows.at(-1)?.blockTime.toISOString() || null };
  }

  async listHolders(limit = 100, skip = 0) {
    const rows = await this.database.tradeHolders.find({ mint: String(this.mint), balance: { $gt: 0 } })
      .sort({ balance: -1 }).skip(Math.max(skip, 0)).limit(Math.min(Math.max(limit, 1), 250)).toArray();
    return { holders: rows, total: await this.database.tradeHolders.countDocuments({ mint: String(this.mint), balance: { $gt: 0 } }) };
  }

  async candles(interval: string, requestedLimit = 300) {
    const seconds = ({ '1m': 60, '5m': 300, '15m': 900, '1h': 3_600, '4h': 14_400, '1d': 86_400 } as Record<string, number>)[interval];
    if (!seconds) throw new TradeError('Unsupported candle interval.');
    const limit = Math.min(Math.max(requestedLimit, 1), 1_000);
    const from = new Date(Date.now() - seconds * limit * 1_000);
    const trades = await this.database.tradeTransactions.find(
      { mint: String(this.mint), blockTime: { $gte: from } },
      { projection: { blockTime: 1, priceSol: 1, tokenAmount: 1, solAmount: 1 } },
    ).sort({ blockTime: 1 }).toArray();
    const buckets = new Map<number, { time: number; open: number; high: number; low: number; close: number; volume: number }>();
    for (const trade of trades) {
      const time = Math.floor(trade.blockTime.getTime() / 1_000 / seconds) * seconds;
      const candle = buckets.get(time);
      if (candle) {
        candle.high = Math.max(candle.high, trade.priceSol);
        candle.low = Math.min(candle.low, trade.priceSol);
        candle.close = trade.priceSol;
        candle.volume += trade.solAmount;
      } else {
        buckets.set(time, { time, open: trade.priceSol, high: trade.priceSol, low: trade.priceSol, close: trade.priceSol, volume: trade.solAmount });
      }
    }
    return { interval, candles: [...buckets.values()].slice(-limit) };
  }

  async createQuote(input: unknown) {
    const body = asRecord(input);
    const side = body.side === 'sell' ? 'sell' : body.side === 'buy' ? 'buy' : undefined;
    const amount = Number(body.amount);
    const slippageBps = Number(body.slippageBps ?? 500);
    if (!side || !Number.isFinite(amount) || amount <= 0) throw new TradeError('A positive amount and buy/sell side are required.');
    if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5_000) throw new TradeError('Slippage must be between 1 and 5000 bps.');
    const decimals = side === 'buy' ? 9 : this.state.decimals;
    const rawAmount = decimalToRaw(amount, decimals);
    const inputMint = side === 'buy' ? String(WSOL_MINT) : String(this.mint);
    const outputMint = side === 'buy' ? String(this.mint) : String(WSOL_MINT);
    const quote = await this.jupiterQuote(inputMint, outputMint, rawAmount, slippageBps);
    const quoteId = randomUUID();
    this.quotes.set(quoteId, { expiresAt: Date.now() + 30_000, response: quote, side });
    this.pruneQuotes();
    const outputDecimals = side === 'buy' ? this.state.decimals : 9;
    return {
      quoteId,
      side,
      inputAmount: amount,
      outputAmount: Number(String(quote.outAmount || '0')) / 10 ** outputDecimals,
      minimumReceived: Number(String(quote.otherAmountThreshold || '0')) / 10 ** outputDecimals,
      priceImpactPct: Number(quote.priceImpactPct || 0),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      route: routeLabels(quote),
    };
  }

  async buildSwap(input: unknown) {
    const body = asRecord(input);
    const quoteId = String(body.quoteId || '');
    const wallet = String(body.wallet || '');
    try { address(wallet); } catch { throw new TradeError('Invalid wallet address.'); }
    const cached = this.quotes.get(quoteId);
    if (!cached || cached.expiresAt < Date.now()) throw new TradeError('Quote expired. Request a new quote.', 409);
    const response = await jupiterRequest(`${JUPITER_SWAP_URL}/swap`, {
      method: 'POST',
      headers: this.jupiterHeaders(true),
      body: JSON.stringify({
        userPublicKey: wallet,
        quoteResponse: cached.response,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
        wrapAndUnwrapSol: true,
      }),
    }, { operation: 'trade swap build' }).catch(error => {
      throw new TradeError(error instanceof Error ? error.message : 'Jupiter could not build the swap.', 502);
    });
    const result = await response.json() as JsonRecord;
    if (!result.swapTransaction) throw new TradeError('Jupiter returned no swap transaction.', 502);
    this.quotes.delete(quoteId);
    return {
      transaction: result.swapTransaction,
      lastValidBlockHeight: result.lastValidBlockHeight,
      prioritizationFeeLamports: result.prioritizationFeeLamports,
    };
  }

  async signatureStatus(signature: string) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) throw new TradeError('Invalid transaction signature.');
    const result = asRecord(await this.rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]));
    return { signature, status: Array.isArray(result.value) ? result.value[0] || null : null };
  }

  openStream(response: ServerResponse) {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(`event: ready\ndata: ${JSON.stringify(this.publicState())}\n\n`);
    const listener = (event: { type: string; data: unknown }) => {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000);
    this.events.on('message', listener);
    response.once('close', () => {
      clearInterval(heartbeat);
      this.events.off('message', listener);
    });
  }

  private async refreshState() {
    if (this.syncingState || this.stopped || !this.providerReady()) return;
    this.syncingState = true;
    try {
      const [metadata, supply, bondingCurve, solUsd] = await Promise.all([
        this.rpc('getAsset', [{ id: String(this.mint), displayOptions: { showFungible: true } }]).catch(() => null),
        this.rpc('getTokenSupply', [String(this.mint), { commitment: 'confirmed' }]),
        derivePumpBondingCurve(this.mint),
        this.loadSolUsd().catch(() => this.state.solUsd),
      ]);
      const asset = metadata ? asRecord(metadata) : {};
      const content = asRecord(asset.content);
      const metadataValue = asRecord(content.metadata);
      const tokenInfo = asRecord(asset.token_info);
      const supplyValue = asRecord(asRecord(supply).value);
      const account = asRecord(await this.rpc('getAccountInfo', [String(bondingCurve), { encoding: 'base64', commitment: 'confirmed' }]));
      const accountValue = account.value ? asRecord(account.value) : null;
      const encoded = accountValue && Array.isArray(accountValue.data) ? String(accountValue.data[0] || '') : '';
      const bytes = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
      const curveExists = bytes.length > 48;
      const complete = curveExists && bytes[48] === 1;
      const route = await this.jupiterQuote(String(WSOL_MINT), String(this.mint), '1000000', 500).catch(() => null);
      const labels = route ? routeLabels(route) : [];
      const pumpRoute = labels.some(label => label.toLowerCase().includes('pump'));
      let stage: TradeStage = 'unknown';
      if (curveExists && !complete) stage = 'bonding_curve';
      else if (complete && route && pumpRoute) stage = 'pumpswap';
      else if (complete && route) stage = 'external';
      else if (complete) stage = 'migrating';
      else if (route) stage = pumpRoute ? 'pumpswap' : 'external';
      const next: TradeStateDocument = {
        ...this.state,
        name: String(metadataValue.name || this.state.name),
        symbol: String(metadataValue.symbol || this.state.symbol),
        decimals: Number(tokenInfo.decimals ?? supplyValue.decimals ?? this.state.decimals),
        supplyRaw: String(tokenInfo.supply ?? supplyValue.amount ?? this.state.supplyRaw),
        stage,
        bondingCurve: curveExists ? String(bondingCurve) : undefined,
        routeLabel: labels.join(' → ') || undefined,
        tradingAvailable: Boolean(route),
        solUsd,
        updatedAt: new Date(),
      };
      this.state = next;
      await this.database.tradeState.updateOne({ mint: next.mint }, { $set: next }, { upsert: true });
      this.emit('token', this.publicState());
    } catch (error) {
      this.logFailure('trade state refresh', error);
    } finally {
      this.syncingState = false;
    }
  }

  private async refreshHolders() {
    if (this.syncingHolders || this.stopped || !this.providerReady()) return;
    this.syncingHolders = true;
    try {
      const accounts: JsonRecord[] = [];
      let cursor: string | undefined;
      let indexedSlot = 0;
      do {
        const result = asRecord(await this.rpc('getTokenAccounts', [{ mint: String(this.mint), limit: 1_000, ...(cursor ? { cursor } : {}) }]));
        indexedSlot = Number(result.last_indexed_slot || indexedSlot);
        const page = Array.isArray(result.token_accounts) ? result.token_accounts.map(asRecord) : [];
        accounts.push(...page);
        cursor = typeof result.cursor === 'string' && result.cursor ? result.cursor : undefined;
      } while (cursor && accounts.length < 250_000);
      const balances = new Map<string, bigint>();
      for (const account of accounts) {
        const owner = String(account.owner || '');
        const amount = BigInt(String(account.amount || '0'));
        if (owner && amount > 0n) balances.set(owner, (balances.get(owner) || 0n) + amount);
      }
      const snapshotId = randomUUID();
      const now = new Date();
      const supplyRaw = BigInt(this.state.supplyRaw || '0');
      if (balances.size) {
        await this.database.tradeHolders.bulkWrite([...balances].map(([owner, raw]) => ({
          updateOne: {
            filter: { mint: String(this.mint), owner },
            update: { $set: {
              mint: String(this.mint), owner, balanceRaw: raw.toString(),
              balance: Number(raw) / 10 ** this.state.decimals,
              supplyShare: supplyRaw > 0n ? Number(raw * 1_000_000n / supplyRaw) / 10_000 : 0,
              snapshotId, updatedSlot: indexedSlot, updatedAt: now,
            } },
            upsert: true,
          },
        })), { ordered: false });
      }
      await this.database.tradeHolders.deleteMany({ mint: String(this.mint), snapshotId: { $ne: snapshotId } });
      this.state.lastHolderSlot = indexedSlot;
      await this.database.tradeState.updateOne({ mint: String(this.mint) }, { $set: { lastHolderSlot: indexedSlot } }, { upsert: true });
      this.emit('holders', { slot: indexedSlot, count: balances.size });
    } catch (error) {
      this.logFailure('holder refresh', error);
    } finally {
      this.syncingHolders = false;
    }
  }

  private async backfillTrades() {
    if (this.syncingTrades || this.stopped || !this.providerReady()) return;
    this.syncingTrades = true;
    try {
      let paginationToken: string | undefined;
      let pages = 0;
      let maxSlot = this.state.lastTradeSlot;
      do {
        const result = await this.loadTransactions({ sortOrder: 'desc', limit: 1_000, paginationToken });
        const documents = result.data.map(value => parseTradeTransaction(value, String(this.mint), this.state.decimals, this.state.solUsd)).filter(isTrade);
        await this.upsertTrades(documents);
        for (const document of documents) maxSlot = Math.max(maxSlot, document.slot);
        paginationToken = result.paginationToken;
        pages += 1;
      } while (paginationToken && pages < 100 && !this.stopped);
      await this.setLastTradeSlot(maxSlot);
    } catch (error) {
      this.logFailure('trade history backfill', error);
    } finally {
      this.syncingTrades = false;
    }
  }

  private async syncRecentTrades() {
    if (this.syncingTrades || this.stopped || !this.providerReady()) return;
    this.syncingTrades = true;
    try {
      const result = await this.loadTransactions({
        sortOrder: 'asc', limit: 1_000,
        ...(this.state.lastTradeSlot ? { filters: { slot: { gt: this.state.lastTradeSlot }, status: 'succeeded', tokenAccounts: 'balanceChanged' } } : {}),
      });
      const documents = result.data.map(value => parseTradeTransaction(value, String(this.mint), this.state.decimals, this.state.solUsd)).filter(isTrade);
      await this.upsertTrades(documents);
      const maxSlot = documents.reduce((slot, value) => Math.max(slot, value.slot), this.state.lastTradeSlot);
      await this.setLastTradeSlot(maxSlot);
      if (documents.length) this.emit('trades', { count: documents.length, latest: documents.at(-1) });
    } catch (error) {
      this.logFailure('live trade sync', error);
    } finally {
      this.syncingTrades = false;
    }
  }

  private connectLiveStream() {
    if (this.stopped || !this.config.heliusApiKey) return;
    const websocket = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.config.heliusApiKey)}`);
    this.socket = websocket;
    websocket.on('open', () => {
      websocket.send(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'transactionSubscribe',
        params: [
          { vote: false, failed: false, accountInclude: [String(this.mint)] },
          { commitment: 'confirmed', encoding: 'jsonParsed', transactionDetails: 'full', showRewards: false, maxSupportedTransactionVersion: 1 },
        ],
      }));
      this.socketHeartbeat = setInterval(() => {
        if (websocket.readyState === WebSocket.OPEN) websocket.ping();
      }, 30_000);
    });
    websocket.on('message', data => void this.handleLiveTransaction(data.toString()));
    websocket.on('unexpected-response', (_request, response) => {
      if (response.statusCode === 401 || response.statusCode === 403) this.providerRetryAt = Date.now() + 60_000;
    });
    websocket.on('error', error => this.logFailure('Helius live stream', error));
    websocket.on('close', () => {
      if (this.socketHeartbeat) clearInterval(this.socketHeartbeat);
      this.socketHeartbeat = undefined;
      if (!this.stopped) {
        const delay = Math.max(2_000, this.providerRetryAt - Date.now());
        this.socketReconnect = setTimeout(() => this.connectLiveStream(), delay);
      }
    });
  }

  private async handleLiveTransaction(message: string) {
    try {
      const payload = asRecord(JSON.parse(message));
      if (payload.method !== 'transactionNotification') return;
      const result = asRecord(asRecord(payload.params).result);
      const wrapped = asRecord(result.transaction);
      const document = parseTradeTransaction({
        signature: result.signature,
        slot: result.slot,
        blockTime: Math.floor(Date.now() / 1_000),
        transaction: wrapped.transaction,
        meta: wrapped.meta,
      }, String(this.mint), this.state.decimals, this.state.solUsd);
      if (!document) return;
      document.status = 'confirmed';
      await this.upsertTrades([document]);
      await this.setLastTradeSlot(document.slot);
      this.emit('trades', { count: 1, latest: document });
    } catch (error) {
      this.logFailure('live transaction parse', error);
    }
  }

  private async loadTransactions(options: JsonRecord) {
    const filters = asRecord(options.filters);
    const result = asRecord(await this.rpc('getTransactionsForAddress', [String(this.mint), {
      transactionDetails: 'full',
      sortOrder: options.sortOrder || 'desc',
      limit: options.limit || 1_000,
      ...(options.paginationToken ? { paginationToken: options.paginationToken } : {}),
      filters: Object.keys(filters).length ? filters : { status: 'succeeded', tokenAccounts: 'balanceChanged' },
    }]));
    return {
      data: Array.isArray(result.data) ? result.data.map(asRecord) : [],
      paginationToken: typeof result.paginationToken === 'string' ? result.paginationToken : undefined,
    };
  }

  private async upsertTrades(documents: TradeTransactionDocument[]) {
    if (!documents.length) return;
    await this.database.tradeTransactions.bulkWrite(documents.map(document => ({
      updateOne: {
        filter: { mint: document.mint, signature: document.signature },
        update: { $setOnInsert: document },
        upsert: true,
      },
    })), { ordered: false });
  }

  private async setLastTradeSlot(slot: number) {
    if (slot <= this.state.lastTradeSlot) return;
    this.state.lastTradeSlot = slot;
    await this.database.tradeState.updateOne({ mint: String(this.mint) }, { $set: { lastTradeSlot: slot } }, { upsert: true });
  }

  private async loadSolUsd() {
    const response = await jupiterRequest(`${JUPITER_PRICE_URL}?ids=${encodeURIComponent(String(WSOL_MINT))}`, {
      headers: this.jupiterHeaders(false),
    }, { operation: 'SOL price', requestTimeoutMs: 8_000 });
    const result = asRecord(await response.json());
    return Number(asRecord(result[String(WSOL_MINT)]).usdPrice || 0) || undefined;
  }

  private async jupiterQuote(inputMint: string, outputMint: string, amount: string, slippageBps: number) {
    if (!this.config.jupiterApiKey) throw new TradeError('Jupiter API is not configured.', 503);
    const query = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: String(slippageBps), restrictIntermediateTokens: 'true' });
    const response = await jupiterRequest(`${JUPITER_SWAP_URL}/quote?${query}`, {
      headers: this.jupiterHeaders(false),
    }, { operation: 'trade quote', requestTimeoutMs: 10_000 }).catch(error => {
      throw new TradeError(error instanceof Error ? error.message : 'Jupiter quote failed.', 502);
    });
    return asRecord(await response.json());
  }

  private jupiterHeaders(json: boolean): Record<string, string> {
    return {
      accept: 'application/json',
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(this.config.jupiterApiKey ? { 'x-api-key': this.config.jupiterApiKey } : {}),
    };
  }

  private async rpc(method: string, params: unknown[]) {
    const queue = method === 'getTokenAccounts' || method === 'getAsset' ? requestQueues.solanaDas : requestQueues.solanaRpc;
    return runRateLimitedAttempts({
      queue,
      deadlineAt: Date.now() + 20_000,
      maximumAttempts: 2,
      shouldRetry: () => true,
      task: async () => {
        const response = await fetch(this.rpcUrl, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`Helius RPC ${method} failed with HTTP ${response.status}`);
        const payload = asRecord(await response.json());
        if (payload.error) throw new Error(`Helius RPC ${method} failed: ${JSON.stringify(payload.error).slice(0, 300)}`);
        return payload.result;
      },
    });
  }

  private publicState() {
    const { mint, name, symbol, decimals, supplyRaw, stage, bondingCurve, routeLabel, tradingAvailable, lastTradeSlot, lastHolderSlot, solUsd, updatedAt } = this.state;
    return { mint, name, symbol, decimals, supplyRaw, stage, bondingCurve, routeLabel, tradingAvailable, lastTradeSlot, lastHolderSlot, solUsd, updatedAt };
  }

  private emit(type: string, data: unknown) {
    this.events.emit('message', { type, data });
  }

  private pruneQuotes() {
    const now = Date.now();
    for (const [id, quote] of this.quotes) if (quote.expiresAt < now) this.quotes.delete(id);
  }

  private logFailure(operation: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP (?:401|403)\b/.test(message)) this.providerRetryAt = Date.now() + 60_000;
    if (Date.now() - this.lastFailureLogAt >= 60_000) {
      console.warn(`${operation} failed: ${message}`);
      this.lastFailureLogAt = Date.now();
    }
  }

  private providerReady() {
    return Date.now() >= this.providerRetryAt;
  }
}

export function createTradeService(config: ServerConfig, database: TaxiDatabase) {
  if (!config.tradeMint) return undefined;
  const service = new TradeService(config, database);
  service.start();
  return service;
}

export function parseTradeTransaction(value: JsonRecord, mint: string, decimals: number, solUsd?: number): TradeTransactionDocument | null {
  const transaction = asRecord(value.transaction);
  const message = asRecord(transaction.message);
  const meta = asRecord(value.meta || transaction.meta);
  if (meta.err) return null;
  const accountKeys = Array.isArray(message.accountKeys)
    ? message.accountKeys.map(item => typeof item === 'string' ? item : String(asRecord(item).pubkey || ''))
    : [];
  const loaded = asRecord(meta.loadedAddresses);
  for (const item of [...(Array.isArray(loaded.writable) ? loaded.writable : []), ...(Array.isArray(loaded.readonly) ? loaded.readonly : [])]) accountKeys.push(String(item));
  const deltas = new Map<string, bigint>();
  const pre = tokenBalances(meta.preTokenBalances, mint);
  const post = tokenBalances(meta.postTokenBalances, mint);
  for (const owner of new Set([...pre.keys(), ...post.keys()])) deltas.set(owner, (post.get(owner) || 0n) - (pre.get(owner) || 0n));
  const preBalances = Array.isArray(meta.preBalances) ? meta.preBalances.map(Number) : [];
  const postBalances = Array.isArray(meta.postBalances) ? meta.postBalances.map(Number) : [];
  const feePayer = accountKeys[0] || '';
  const candidates = [...deltas].filter(([, delta]) => delta !== 0n).map(([owner, tokenDelta]) => {
    const index = accountKeys.indexOf(owner);
    return { owner, tokenDelta, solDelta: index >= 0 ? (postBalances[index] || 0) - (preBalances[index] || 0) : 0 };
  });
  const candidate = candidates.find(item => item.owner === feePayer && item.solDelta !== 0)
    || candidates.filter(item => item.solDelta !== 0).sort((a, b) => Math.abs(b.solDelta) - Math.abs(a.solDelta))[0];
  if (!candidate) return null;
  const fee = Number(meta.fee || 0);
  const side = candidate.tokenDelta > 0n ? 'buy' : 'sell';
  let solLamports = side === 'buy' ? -candidate.solDelta : candidate.solDelta;
  if (candidate.owner === feePayer) solLamports += side === 'buy' ? -fee : fee;
  solLamports = Math.abs(solLamports);
  if (!solLamports) return null;
  const tokenRaw = candidate.tokenDelta < 0n ? -candidate.tokenDelta : candidate.tokenDelta;
  const tokenAmount = Number(tokenRaw) / 10 ** decimals;
  const solAmount = solLamports / LAMPORTS_PER_SOL;
  const priceSol = tokenAmount ? solAmount / tokenAmount : 0;
  if (!Number.isFinite(priceSol) || priceSol <= 0) return null;
  const signatures = Array.isArray(transaction.signatures) ? transaction.signatures : [];
  const signature = String(value.signature || signatures[0] || '');
  if (!signature) return null;
  const blockTimeSeconds = Number(value.blockTime || value.timestamp || 0);
  return {
    mint, signature, wallet: candidate.owner, side,
    tokenAmountRaw: tokenRaw.toString(), tokenAmount,
    solAmountLamports: String(solLamports), solAmount, priceSol,
    ...(solUsd ? { priceUsd: priceSol * solUsd } : {}),
    slot: Number(value.slot || 0),
    blockTime: new Date(blockTimeSeconds > 0 ? blockTimeSeconds * 1_000 : Date.now()),
    status: 'finalized', createdAt: new Date(),
  };
}

function tokenBalances(input: unknown, mint: string) {
  const balances = new Map<string, bigint>();
  if (!Array.isArray(input)) return balances;
  for (const item of input) {
    const balance = asRecord(item);
    if (String(balance.mint || '') !== mint) continue;
    const owner = String(balance.owner || '');
    const amount = String(asRecord(balance.uiTokenAmount).amount || '0');
    if (owner) balances.set(owner, (balances.get(owner) || 0n) + BigInt(amount));
  }
  return balances;
}

function routeLabels(quote: JsonRecord): string[] {
  if (!Array.isArray(quote.routePlan)) return [];
  return quote.routePlan.map(item => String(asRecord(asRecord(item).swapInfo).label || '')).filter(Boolean);
}

function decimalToRaw(amount: number, decimals: number) {
  const raw = BigInt(Math.round(amount * 10 ** decimals));
  if (raw <= 0n) throw new TradeError('Amount is below the minimum unit.');
  return raw.toString();
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function isTrade(value: TradeTransactionDocument | null): value is TradeTransactionDocument {
  return value !== null;
}
