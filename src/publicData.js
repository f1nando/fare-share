import {
  calculateDurabilityPercent,
  calculateRepairQuote,
  formatTokenAmount,
} from './protocol/solana.js';
import { BACKEND_URL as API_URL } from './backendUrl.js';
import { apiErrorMessage } from './clientErrorLog.js';

const MAX_DURABILITY = 5 * 24 * 60 * 60;

export const loadPublicOverview = () => request('/api/public/overview');
export const loadPublicMarket = () => request('/api/public/market');
export const loadPublicTaxi = (identifier, signal) => request(`/api/public/taxi?identifier=${encodeURIComponent(identifier)}`, { signal });

export async function saveMarketTransaction(input) {
  return request('/api/market/transactions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function loadDatabaseFleet(owner) {
  const result = await request(`/api/fleet/wallet/${encodeURIComponent(owner)}`);
  const protocolNow = Number(result.protocolNow);
  const decimals = Array.isArray(result.assets) ? result.assets.map(asset => Number(asset.decimals)) : [6, 8, 8, 8, 8];
  return result.machines.map(machine => {
    const rewards = machine.claimable.map(BigInt);
    const pending = machine.pending.map(BigInt);
    const fareBase = BigInt(machine.fareBase);
    const secondsLeft = Math.max(0, Number(machine.activeUntil) - protocolNow);
    const repairCost = calculateRepairQuote(fareBase, pending[0] || 0n, secondsLeft);
    return {
      asset: machine.asset,
      machineAddress: machine.machine,
      name: machine.name,
      image: machine.image,
      weight: machine.weight,
      durability: calculateDurabilityPercent(secondsLeft),
      rewards,
      rewardDisplay: {
        fare: formatTokenAmount(rewards[0], decimals[0]),
        stocks: ['UBERx', 'TSLAx', 'GOOGLx', 'AMZNx'].map((symbol, index) => ({
          symbol,
          amount: formatTokenAmount(rewards[index + 1], decimals[index + 1]),
          rawFallback: false,
        })),
      },
      fareBase,
      repairCost,
      repairCostDisplay: formatTokenAmount(repairCost, decimals[0]),
      missingSeconds: MAX_DURABILITY - secondsLeft,
      calculatedUntil: BigInt(result.protocolNow),
      rewardActive: machine.rewardActive,
      closed: machine.closed,
    };
  });
}

export async function loadDatabaseEarningHistory(owner, period = '24h') {
  const result = await request(`/api/fleet/history/${encodeURIComponent(owner)}?period=${encodeURIComponent(period)}`);
  const decimals = Number(result.assets?.[0]?.decimals ?? 6);
  return {
    period: result.period,
    points: result.points.map(point => ({
      ...point,
      fare: Number(point.claimable[0] || 0) / (10 ** decimals),
      fareDisplay: formatTokenAmount(BigInt(point.claimable[0] || 0), decimals),
    })),
  };
}

export async function saveMintToDatabase({ signature, asset, owner }, { attempts = 1, pollMs = 1_000, onPending } = {}) {
  let result;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    result = await request('/api/fleet/mints', {
      method: 'POST',
      body: JSON.stringify({ signature, asset, owner }),
    });
    if (result.indexed) return result;
    onPending?.(result, attempt + 1);
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  return result;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(body, `Public data API failed with HTTP ${response.status}`));
  return body;
}
