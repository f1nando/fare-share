import { requestQueues, runRateLimitedAttempts } from './requestLimits.js';

export class JupiterHttpError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'JupiterHttpError';
  }
}

export async function jupiterRequest(
  url: string,
  init: RequestInit = {},
  options: {
    fetchImplementation?: typeof fetch;
    queueTimeoutMs?: number;
    requestTimeoutMs?: number;
    maximumAttempts?: number;
    operation?: string;
  } = {},
) {
  const fetcher = options.fetchImplementation || fetch;
  const method = (init.method || 'GET').toUpperCase();
  const safeToRetry = method === 'GET' || method === 'HEAD';
  const deadlineAt = Date.now() + (options.queueTimeoutMs ?? 10_000);
  return runRateLimitedAttempts({
    queue: requestQueues.jupiter,
    deadlineAt,
    maximumAttempts: safeToRetry ? options.maximumAttempts ?? 2 : 1,
    shouldRetry: isRetryableJupiterError,
    task: async () => {
      const response = await fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(options.requestTimeoutMs ?? 12_000),
      });
      if (!response.ok) {
        throw new JupiterHttpError(
          `Jupiter ${options.operation || method} failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
          response.status,
        );
      }
      return response;
    },
  });
}

function isRetryableJupiterError(error: unknown) {
  if (!(error instanceof JupiterHttpError)) return true;
  return error.status === 429 || error.status === undefined || error.status >= 500;
}
