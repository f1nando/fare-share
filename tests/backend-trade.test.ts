import assert from 'node:assert/strict';
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
  assert.equal(candleResults[0].candles.length, 1);
  assert.equal(candleResults[0].sourceTradesTruncated, true);
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
