import { createDefaultRpcTransport, createSolanaRpcFromTransport } from '@solana/kit';

class FifoRequestQueue {
  constructor(requestsPerSecond) {
    this.intervalMs = Math.ceil(1000 / requestsPerSecond);
    this.items = [];
    this.draining = false;
    this.nextStartAt = 0;
  }

  schedule(task) {
    return new Promise((resolve, reject) => {
      this.items.push({ task, resolve, reject });
      void this.drain();
    });
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.items.length) {
        const waitMs = Math.max(0, this.nextStartAt - Date.now());
        if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
        const item = this.items.shift();
        this.nextStartAt = Date.now() + this.intervalMs;
        Promise.resolve().then(item.task).then(item.resolve, item.reject);
      }
    } finally {
      this.draining = false;
      if (this.items.length) void this.drain();
    }
  }
}

const env = import.meta.env ?? {};
const standardQueue = new FifoRequestQueue(boundedNumber(env.VITE_SOLANA_RPC_MAX_REQUESTS_PER_SECOND, 20, 20));
const sendQueue = new FifoRequestQueue(boundedNumber(env.VITE_SOLANA_SEND_TRANSACTION_MAX_REQUESTS_PER_SECOND, 2, 2));
const dasQueue = new FifoRequestQueue(boundedNumber(env.VITE_SOLANA_DAS_MAX_REQUESTS_PER_SECOND, 10, 10));

export function createRateLimitedSolanaRpc(url) {
  const transport = createDefaultRpcTransport({ url });
  const limitedTransport = async config => {
    const method = config.payload?.method;
    const queue = method === 'sendTransaction' ? sendQueue : standardQueue;
    const maximumAttempts = method === 'sendTransaction' ? 1 : 2;
    let lastError;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        return await queue.schedule(() => transport(config));
      } catch (error) {
        lastError = error;
        if (attempt === maximumAttempts) throw error;
      }
    }
    throw lastError;
  };
  return createSolanaRpcFromTransport(limitedTransport);
}

export function rateLimitedRpcFetch(url, init) {
  return standardQueue.schedule(() => fetch(url, init));
}

export async function rateLimitedDasFetch(url, init, fetchImplementation = fetch) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await dasQueue.schedule(() => fetchImplementation(url, init));
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
  }
  throw lastError;
}

function boundedNumber(raw, fallback, maximum) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`Request limit must be greater than zero and no greater than ${maximum}`);
  }
  return value;
}
