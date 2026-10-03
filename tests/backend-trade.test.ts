import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { fillTradeCandles, parseTradeTransaction, TradeService } from '../server/trade.js';
import type { ServerConfig } from '../server/config.js';
import type { TaxiDatabase } from '../server/database.js';

const MINT = 'HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR';
const WALLET = '11111111111111111111111111111111';

test('trade parser derives a bonding-curve buy from balance changes', () => {
  const trade = parseTradeTransaction(transaction({
    preLamports: 2_000_000_000,
    postLamports: 1_500_000_000,
    preTokens: '0',
    postTokens: '100000000',
  }), MINT, 6, 100);
  assert.ok(trade);
  assert.equal(trade.side, 'buy');
  assert.equal(trade.wallet, WALLET);
  assert.equal(trade.tokenAmount, 100);
  assert.equal(trade.solAmountLamports, '499995000');
  assert.equal(trade.priceUsd, trade.priceSol * 100);
});

test('trade parser derives a sell and restores the fee to received SOL', () => {
  const trade = parseTradeTransaction(transaction({
    preLamports: 1_000_000_000,
    postLamports: 1_200_000_000,
    preTokens: '100000000',
    postTokens: '50000000',
  }), MINT, 6);
  assert.ok(trade);
  assert.equal(trade.side, 'sell');
  assert.equal(trade.tokenAmount, 50);
  assert.equal(trade.solAmountLamports, '200005000');
});

test('trade parser ignores ordinary token transfers and rent changes', () => {
  const value = transaction({
    preLamports: 1_000_000_000,
    postLamports: 997_955_720,
    preTokens: '100000000',
    postTokens: '99999999',
  });
  value.meta.logMessages = ['Program log: Instruction: TransferChecked'];
  assert.equal(parseTradeTransaction(value, MINT, 6), null);
});

test('a single trade opens its candle at the previous close', () => {
  const candles = fillTradeCandles(new Map([
    [0, { time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 }],
    [300, { time: 300, open: 110, high: 110, low: 110, close: 110, volume: 2 }],
  ]), 300, 300);
  assert.deepEqual(candles[1], { time: 300, open: 100, high: 110, low: 100, close: 110, volume: 2 });
});

test('holders exclude the Pump bonding curve liquidity account', async () => {
  let holderFilter: any;
  const holder = { mint: MINT, owner: 'So11111111111111111111111111111111111111112', balance: 10, supplyShare: 1 };
  const database = {
    tradeHolders: {
      find(filter: unknown) {
        holderFilter = filter;
        return {
          sort() { return this; },
          skip() { return this; },
          limit() { return this; },
          async toArray() { return [holder]; },
        };
      },
      countDocuments: async () => 1,
    },
  } as unknown as TaxiDatabase;
  const service = new TradeService({ solanaRpcUrl: 'https://rpc.invalid' } as ServerConfig, database, { mint: MINT, ticker: 'FARE' });
  (service as any).state.stage = 'bonding_curve';
  (service as any).state.bondingCurve = WALLET;

  const result = await service.listHolders();
  assert.deepEqual((holderFilter as any).owner, { $ne: WALLET });
  assert.deepEqual(result, { holders: [holder], total: 1 });
});

test('trade reads are bounded and concurrent identical requests share cached work', async () => {
  const now = new Date();
  const row = { blockTime: new Date(now.getTime() - 60_000), priceSol: 2, tokenAmount: 1, solAmount: 2 };
  const rows = Array.from({ length: 20_001 }, () => row);
  let findCalls = 0;
  const limits: number[] = [];
  const database = {
    tradeTransactions: {
      findOne: async () => rows[0],
      find: () => {
        findCalls += 1;
        return {
          sort() { return this; },
          limit(value: number) { limits.push(value); return this; },
          async toArray() { return rows; },
        };
      },
    },
    tradeHolders: { countDocuments: async () => 2 },
  } as unknown as TaxiDatabase;
  const service = new TradeService({ solanaRpcUrl: 'https://rpc.invalid' } as ServerConfig, database, { mint: MINT, ticker: 'FARE' });

  const tokenResults = await Promise.all(Array.from({ length: 20 }, () => service.tokenSnapshot()));
  assert.ok(tokenResults.every(result => result === tokenResults[0]));
  const candleResults = await Promise.all(Array.from({ length: 20 }, () => service.candles('5m', 300)));
  assert.ok(candleResults.every(result => result === candleResults[0]));
  assert.equal(findCalls, 2);
  assert.equal(Math.max(...limits), 20_001);
  assert.equal(tokenResults[0].volume24hSol, 40_000);
  assert.equal(tokenResults[0].sourceTradesTruncated, true);
  assert.ok(candleResults[0].candles.length >= 1 && candleResults[0].candles.length <= 2);
  assert.equal(candleResults[0].sourceTradesTruncated, true);
});

test('atomic mint buy quote covers the missing FARE after slippage', async () => {
  const service = new TradeService({
    solanaRpcUrl: 'https://rpc.invalid',
    jupiterApiKey: 'test',
  } as ServerConfig, {} as TaxiDatabase, { mint: MINT, ticker: 'FARE' });
  (service as any).state.decimals = 6;
  (service as any).tokenSnapshot = async () => ({ priceSol: 0.00000003 });
  let calls = 0;
  (service as any).jupiterQuote = async (_input: string, _output: string, amount: string) => {
    calls += 1;
    const output = BigInt(amount) * 30_000n;
    return {
      inAmount: amount,
      outAmount: output.toString(),
      otherAmountThreshold: (output * 95n / 100n).toString(),
      priceImpactPct: '0.2',
      routePlan: [{}],
    };
  };
  const quote = await service.createMintBuyQuote({ outputAmountRaw: '7640000000000' });
  assert.ok(calls >= 1);
  assert.ok(BigInt(String(quote.minimumReceivedRaw)) >= 7_640_000_000_000n);
  assert.ok(Number(quote.inputSol) > 0);
});

test('trade SSE clients share one heartbeat and are released on close and shutdown', () => {
  const service = new TradeService({
    solanaRpcUrl: 'https://rpc.invalid',
    tradeSseMaxClients: 2,
  } as ServerConfig, {} as TaxiDatabase, { mint: MINT, ticker: 'FARE' });
  const first = new FakeResponse();
  const second = new FakeResponse();
  const rejected = new FakeResponse();

  service.openStream(first as never);
  const sharedHeartbeat = (service as any).streamHeartbeat;
  service.openStream(second as never);
  service.openStream(rejected as never);

  assert.equal((service as any).streams.size, 2);
  assert.equal((service as any).streamHeartbeat, sharedHeartbeat);
  assert.equal(first.status, 200);
  assert.match(first.writes[0], /retry: 3000/);
  assert.equal(rejected.status, 503);

  (service as any).emit('trades', { count: 1 });
  assert.match(first.writes.at(-1) || '', /event: trades/);
  assert.match(second.writes.at(-1) || '', /event: trades/);

  first.emit('close');
  assert.equal((service as any).streams.size, 1);
  second.emit('close');
  assert.equal((service as any).streams.size, 0);
  assert.equal((service as any).streamHeartbeat, undefined);

  const slowClient = new FakeResponse();
  slowClient.acceptWrites = false;
  service.openStream(slowClient as never);
  assert.equal(slowClient.destroyed, true);
  assert.equal((service as any).streams.size, 0);

  const shutdownClient = new FakeResponse();
  service.openStream(shutdownClient as never);
  service.stop();
  assert.equal(shutdownClient.ended, true);
  assert.equal((service as any).streams.size, 0);
});

function transaction(input: { preLamports: number; postLamports: number; preTokens: string; postTokens: string }) {
  return {
    slot: 123,
    blockTime: 1_700_000_000,
    transaction: {
      signatures: ['5'.repeat(64)],
      message: { accountKeys: [WALLET] },
    },
    meta: {
      fee: 5_000,
      logMessages: [`Program log: Instruction: ${BigInt(input.postTokens) > BigInt(input.preTokens) ? 'Buy' : 'Sell'}`],
      preBalances: [input.preLamports],
      postBalances: [input.postLamports],
      preTokenBalances: [{ accountIndex: 0, mint: MINT, owner: WALLET, uiTokenAmount: { amount: input.preTokens, decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 0, mint: MINT, owner: WALLET, uiTokenAmount: { amount: input.postTokens, decimals: 6 } }],
    },
  };
}

class FakeResponse extends EventEmitter {
  status = 0;
  writes: string[] = [];
  ended = false;
  destroyed = false;
  writableEnded = false;
  acceptWrites = true;

  writeHead(status: number) { this.status = status; return this; }
  write(value: string) { this.writes.push(value); return this.acceptWrites; }
  end(value?: string) {
    if (value) this.writes.push(value);
    this.ended = true;
    this.writableEnded = true;
    return this;
  }
  destroy() { this.destroyed = true; return this; }
}
