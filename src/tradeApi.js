import { AccountRole, address } from '@solana/kit';
import { BACKEND_URL as API_URL } from './backendUrl.js';
import { apiErrorMessage } from './clientErrorLog.js';
import { base64Bytes, decodeAddressLookupTable, sendWalletInstructions } from './protocol/anchorClient.js';
import { connectWallet, RPC_URL, SOLANA_CHAIN } from './protocol/solana.js';
import { createRateLimitedSolanaRpc } from './protocol/requestLimits.js';

const env = import.meta.env ?? {};
const rpc = createRateLimitedSolanaRpc(RPC_URL);
const protocolLookupTable = env.VITE_TAXI_LOOKUP_TABLE || '';

export function connectTradeWallet() {
  return connectWallet();
}

export async function loadTradeToken() {
  return request('/api/trade/token');
}

export async function loadTrades(limit = 50) {
  return request(`/api/trade/trades?limit=${limit}`);
}

export async function loadHolders(limit = 50) {
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

export async function quoteMintFarePurchase(outputAmountRaw) {
  return request('/api/mint/buy-quote', { method: 'POST', body: JSON.stringify({ outputAmountRaw: String(outputAmountRaw) }) });
}

export async function executeTrade(connection, quoteId) {
  const built = await request('/api/trade/build', {
    method: 'POST',
    body: JSON.stringify({ quoteId, wallet: connection.account.address }),
  });
  const instructions = tradeInstructions(built);
  const lookupTables = await loadTradeLookupTables([
    protocolLookupTable,
    ...(built.addressLookupTableAddresses || []),
  ]);
  return sendWalletInstructions({
    rpc,
    wallet: connection.wallet,
    account: connection.account,
    chain: SOLANA_CHAIN,
    instructions,
    lookupTables,
  });
}

export function tradeInstructions(built) {
  if (!built?.swapInstruction) throw new Error('Jupiter returned no swap instruction.');
  return [
    ...(built.computeBudgetInstructions || []),
    ...(built.otherInstructions || []),
    ...(built.setupInstructions || []),
    built.swapInstruction,
    ...(built.cleanupInstruction ? [built.cleanupInstruction] : []),
  ].map(decodeApiInstruction);
}

async function loadTradeLookupTables(values) {
  const addresses = [...new Set(values.filter(Boolean).map(String))].map(address);
  if (!addresses.length) return {};
  const response = await rpc.getMultipleAccounts(addresses, { commitment: 'finalized', encoding: 'base64' }).send();
  const tables = {};
  addresses.forEach((lookupAddress, index) => {
    const account = response.value[index];
    if (!account) throw new Error(`Swap lookup table ${lookupAddress} is unavailable.`);
    tables[lookupAddress] = decodeAddressLookupTable(base64Bytes(account.data[0]));
  });
  return tables;
}

function decodeApiInstruction(value) {
  if (!value || typeof value !== 'object' || !value.programId || !Array.isArray(value.accounts) || typeof value.data !== 'string') {
    throw new Error('Jupiter returned an invalid swap instruction.');
  }
  return {
    programAddress: address(value.programId),
    accounts: value.accounts.map(accountMeta => ({
      address: address(accountMeta.pubkey),
      role: accountMeta.isSigner
        ? (accountMeta.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER)
        : (accountMeta.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY),
    })),
    data: base64Bytes(value.data),
  };
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
  if (!response.ok) throw new Error(apiErrorMessage(body, `Trade API request failed with HTTP ${response.status}`));
  return body;
}
