import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTradeTransaction } from '../server/trade.js';

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
