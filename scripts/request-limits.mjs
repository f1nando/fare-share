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

const standardQueue = new FifoRequestQueue(boundedNumber('SOLANA_RPC_MAX_REQUESTS_PER_SECOND', 20, 20));
const sendQueue = new FifoRequestQueue(boundedNumber('SOLANA_SEND_TRANSACTION_MAX_REQUESTS_PER_SECOND', 2, 2));

export function createRateLimitedSolanaRpc(url) {
  const transport = createDefaultRpcTransport({ url });
  return createSolanaRpcFromTransport(config => {
    const queue = config.payload?.method === 'sendTransaction' ? sendQueue : standardQueue;
    return queue.schedule(() => transport(config));
  });
}

export function rateLimitedRpcFetch(url, init) {
  return standardQueue.schedule(() => fetch(url, init));
}

function boundedNumber(name, fallback, maximum) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be greater than zero and no greater than ${maximum}`);
  }
  return value;
}
