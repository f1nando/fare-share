import { requestQueues, runRateLimitedAttempts } from './requestLimits.js';

export class SolanaRpcHttpError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'SolanaRpcHttpError';
  }
}

export class AmbiguousSolanaWriteError extends Error {
  constructor(cause: unknown) {
    super('sendTransaction result is unknown; reconcile the signed transaction before another submission', { cause });
    this.name = 'AmbiguousSolanaWriteError';
  }
}

export async function solanaRpcCall<T>(
  url: string,
  method: string,
  params: unknown[],
  options: { timeoutMs?: number; maximumAttempts?: number; fetchImplementation?: typeof fetch } = {},
): Promise<T> {
  if (method === 'sendTransaction') {
    return solanaSendTransactionCall<T>(url, params, options);
  }

  const fetcher = options.fetchImplementation || fetch;
  return runRateLimitedAttempts({
    queue: requestQueues.solanaRpc,
    maximumAttempts: options.maximumAttempts ?? 2,
    shouldRetry: isRetryableReadError,
    task: async () => {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
      if (!response.ok) throw new SolanaRpcHttpError(`Solana RPC ${method} failed with HTTP ${response.status}`, response.status);
      const payload = await response.json() as { result?: T; error?: { code?: number; message?: string } };
      if (payload.error) {
        throw new SolanaRpcHttpError(`Solana RPC ${method}: ${payload.error.message || 'unknown error'}`, payload.error.code);
      }
      if (payload.result === undefined) throw new SolanaRpcHttpError(`Solana RPC ${method} returned no result`);
      return payload.result;
    },
  });
}

export async function solanaSendTransactionCall<T>(
  url: string,
  params: unknown[],
  options: { timeoutMs?: number; fetchImplementation?: typeof fetch } = {},
): Promise<T> {
  const fetcher = options.fetchImplementation || fetch;
  try {
    return await requestQueues.solanaSendTransaction.schedule(async () => {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
      if (!response.ok) throw new SolanaRpcHttpError(`Solana RPC sendTransaction failed with HTTP ${response.status}`, response.status);
      const payload = await response.json() as {
        result?: T;
        error?: { message?: string; data?: { logs?: string[] } };
      };
      if (payload.error) {
        const logs = payload.error.data?.logs?.length ? `\n${payload.error.data.logs.join('\n')}` : '';
        throw new SolanaRpcHttpError(`Solana RPC sendTransaction: ${payload.error.message || 'unknown error'}${logs}`);
      }
      if (payload.result === undefined) throw new SolanaRpcHttpError('Solana RPC sendTransaction returned no result');
      return payload.result;
    });
  } catch (error) {
    if (error instanceof SolanaRpcHttpError) throw error;
    throw new AmbiguousSolanaWriteError(error);
  }
}

function isRetryableReadError(error: unknown) {
  if (!(error instanceof SolanaRpcHttpError)) return true;
  return error.status === 429 || error.status === undefined || error.status >= 500 || error.status <= -32000;
}
