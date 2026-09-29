export class QueueDeadlineError extends Error {
  constructor(public readonly queueName: string) {
    super(`${queueName} request expired while waiting for its rate-limit slot`);
    this.name = 'QueueDeadlineError';
  }
}

interface QueueItem<T> {
  task: () => Promise<T>;
  deadlineAt: number;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export class FifoRequestQueue {
  private readonly intervalMs: number;
  private readonly items: QueueItem<unknown>[] = [];
  private draining = false;
  private nextStartAt = 0;

  constructor(public readonly name: string, requestsPerSecond: number) {
    if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0) {
      throw new Error(`${name} requests per second must be greater than zero`);
    }
    this.intervalMs = Math.ceil(1_000 / requestsPerSecond);
  }

  schedule<T>(task: () => Promise<T>, options: { deadlineAt?: number } = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.items.push({
        task,
        deadlineAt: options.deadlineAt ?? Number.POSITIVE_INFINITY,
        resolve: resolve as QueueItem<unknown>['resolve'],
        reject,
      });
      void this.drain();
    });
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.items.length > 0) {
        const waitMs = Math.max(0, this.nextStartAt - Date.now());
        if (waitMs > 0) await delay(waitMs);

        const item = this.items.shift()!;
        if (Date.now() >= item.deadlineAt) {
          item.reject(new QueueDeadlineError(this.name));
          continue;
        }

        this.nextStartAt = Date.now() + this.intervalMs;
        Promise.resolve()
          .then(item.task)
          .then(item.resolve, item.reject);
      }
    } finally {
      this.draining = false;
      if (this.items.length > 0) void this.drain();
    }
  }
}

export interface RequestQueues {
  jupiter: FifoRequestQueue;
  solanaRpc: FifoRequestQueue;
  solanaSendTransaction: FifoRequestQueue;
  solanaDas: FifoRequestQueue;
}

export function createRequestQueues(input: {
  jupiterRequestsPerSecond: number;
  solanaRpcRequestsPerSecond: number;
  solanaSendTransactionRequestsPerSecond: number;
  solanaDasRequestsPerSecond: number;
}): RequestQueues {
  return {
    jupiter: new FifoRequestQueue('Jupiter', input.jupiterRequestsPerSecond),
    solanaRpc: new FifoRequestQueue('Solana RPC', input.solanaRpcRequestsPerSecond),
    solanaSendTransaction: new FifoRequestQueue('Solana sendTransaction', input.solanaSendTransactionRequestsPerSecond),
    solanaDas: new FifoRequestQueue('Solana DAS', input.solanaDasRequestsPerSecond),
  };
}

export const requestQueues = createRequestQueues({
  jupiterRequestsPerSecond: boundedNumber('JUPITER_REQUESTS_PER_SECOND', 10, 10),
  solanaRpcRequestsPerSecond: boundedNumber('SOLANA_RPC_MAX_REQUESTS_PER_SECOND', 50, 50),
  solanaSendTransactionRequestsPerSecond: boundedNumber('SOLANA_SEND_TRANSACTION_MAX_REQUESTS_PER_SECOND', 5, 5),
  solanaDasRequestsPerSecond: boundedNumber('SOLANA_DAS_MAX_REQUESTS_PER_SECOND', 10, 10),
});

export async function runRateLimitedAttempts<T>(input: {
  queue: FifoRequestQueue;
  task: (attempt: number) => Promise<T>;
  maximumAttempts?: number;
  deadlineAt?: number;
  shouldRetry?: (error: unknown) => boolean;
}): Promise<T> {
  const maximumAttempts = input.maximumAttempts ?? 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await input.queue.schedule(() => input.task(attempt), { deadlineAt: input.deadlineAt });
    } catch (error) {
      lastError = error;
      if (error instanceof QueueDeadlineError || attempt >= maximumAttempts || !input.shouldRetry?.(error)) throw error;
    }
  }
  throw lastError;
}

function boundedNumber(name: string, fallback: number, maximum: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be a number greater than zero and no greater than ${maximum}`);
  }
  return value;
}

function delay(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}
