import { getBase58Decoder } from '@solana/kit';
import { connectWallet } from './protocol/solana.js';

const API_URL = String(import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787').replace(/\/$/, '');

export function connectTradeWallet() {
  return connectWallet();
}

export async function loadTradeToken() {
  return request('/api/trade/token');
}

export async function loadTrades(limit = 50) {
  return request(`/api/trade/trades?limit=${limit}`);
}

export async function loadHolders(limit = 100) {
  return request(`/api/trade/holders?limit=${limit}`);
}

export async function loadCandles(interval = '1h', limit = 300) {
  return request(`/api/trade/candles?interval=${encodeURIComponent(interval)}&limit=${limit}`);
}

export async function loadTradeBalance(wallet) {
  return request(`/api/trade/balance/${encodeURIComponent(wallet)}`);
}

export async function quoteTrade(side, amount, slippageBps = 500) {
  return request('/api/trade/quote', { method: 'POST', body: JSON.stringify({ side, amount, slippageBps }) });
}

export async function executeTrade(connection, quoteId) {
  const built = await request('/api/trade/build', {
    method: 'POST',
    body: JSON.stringify({ quoteId, wallet: connection.account.address }),
  });
  const feature = connection.wallet.features['solana:signAndSendTransaction'];
  if (!feature) throw new Error('The connected wallet cannot sign Solana transactions.');
  const bytes = Uint8Array.from(atob(built.transaction), character => character.charCodeAt(0));
  const [result] = await feature.signAndSendTransaction({
    transaction: bytes,
    account: connection.account,
    chain: 'solana:mainnet',
  });
  return getBase58Decoder().decode(result.signature);
}

export function subscribeTradeEvents(onEvent) {
  const source = new EventSource(`${API_URL}/api/trade/stream`);
  for (const type of ['ready', 'token', 'trades', 'holders']) {
    source.addEventListener(type, event => {
      try { onEvent(type, JSON.parse(event.data)); } catch { /* reconnect/refetch will recover */ }
    });
  }
  return () => source.close();
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Trade API request failed with HTTP ${response.status}`);
  return body;
}
