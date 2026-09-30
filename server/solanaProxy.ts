const ALLOWED_METHODS = new Set([
  'getAccountInfo',
  'getAssetsByOwner',
  'getBlockTime',
  'getLatestBlockhash',
  'getMultipleAccounts',
  'getProgramAccounts',
  'getSignatureStatuses',
  'getSlot',
  'sendTransaction',
]);

type FetchLike = typeof fetch;

export class SolanaProxyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function createSolanaProxy(rpcUrl: string, fetchImpl: FetchLike = fetch) {
  const requests = new Map<string, { windowStartedAt: number; reads: number; sends: number }>();

  return async (body: unknown, client: string) => {
    const payload = validatePayload(body);
    enforceRateLimit(requests, client, payload.method);
    const response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new SolanaProxyError(`Solana RPC returned HTTP ${response.status}.`, 502);
    return response.json();
  };
}

export function validatePayload(value: unknown): Record<string, unknown> & { method: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SolanaProxyError('JSON-RPC object is required.', 400);
  }
  const payload = value as Record<string, unknown>;
  if (payload.jsonrpc !== '2.0' || typeof payload.method !== 'string' || !ALLOWED_METHODS.has(payload.method)) {
    throw new SolanaProxyError('Solana RPC method is not allowed.', 403);
  }
  if (payload.params !== undefined && !Array.isArray(payload.params) && typeof payload.params !== 'object') {
    throw new SolanaProxyError('Invalid JSON-RPC params.', 400);
  }
  return payload as Record<string, unknown> & { method: string };
}

function enforceRateLimit(
  requests: Map<string, { windowStartedAt: number; reads: number; sends: number }>,
  client: string,
  method: string,
) {
  const now = Date.now();
  let state = requests.get(client);
  if (!state || now - state.windowStartedAt >= 60_000) {
    state = { windowStartedAt: now, reads: 0, sends: 0 };
    requests.set(client, state);
  }
  if (method === 'sendTransaction') {
    state.sends += 1;
    if (state.sends > 10) throw new SolanaProxyError('Too many transaction submissions.', 429);
  } else {
    state.reads += 1;
    if (state.reads > 120) throw new SolanaProxyError('Too many Solana RPC requests.', 429);
  }
  if (requests.size > 10_000) {
    for (const [key, value] of requests) {
      if (now - value.windowStartedAt >= 60_000) requests.delete(key);
    }
  }
}
