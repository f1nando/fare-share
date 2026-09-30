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
  'simulateTransaction',
]);

const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const METHOD_MAX_RESPONSE_BYTES: Record<string, number> = {
  getAssetsByOwner: 8 * 1024 * 1024,
  getMultipleAccounts: 2 * 1024 * 1024,
  getProgramAccounts: 1024 * 1024,
};

type FetchLike = typeof fetch;

export class SolanaProxyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function createSolanaProxy(
  rpcUrl: string,
  options: { programId?: string; fetchImpl?: FetchLike } = {},
) {
  const requests = new Map<string, { windowStartedAt: number; reads: number; sends: number }>();
  const fetchImpl = options.fetchImpl || fetch;

  return async (body: unknown, client: string) => {
    const payload = validatePayload(body, { programId: options.programId });
    enforceRateLimit(requests, client, payload.method);
    const response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new SolanaProxyError(`Solana RPC returned HTTP ${response.status}.`, 502);
    return readLimitedJson(response, METHOD_MAX_RESPONSE_BYTES[payload.method] || DEFAULT_MAX_RESPONSE_BYTES);
  };
}

export function validatePayload(
  value: unknown,
  options: { programId?: string } = {},
): Record<string, unknown> & { method: string } {
  const payload = record(value, 'JSON-RPC object');
  exactKeys(payload, ['jsonrpc', 'id', 'method', 'params']);
  if (payload.jsonrpc !== '2.0' || typeof payload.method !== 'string' || !ALLOWED_METHODS.has(payload.method)) {
    throw new SolanaProxyError('Solana RPC method is not allowed.', 403);
  }
  if (!validId(payload.id)) throw new SolanaProxyError('Invalid JSON-RPC id.', 400);

  switch (payload.method) {
    case 'getAccountInfo': validateGetAccountInfo(payload.params); break;
    case 'getAssetsByOwner': validateGetAssetsByOwner(payload.params); break;
    case 'getBlockTime': validateGetBlockTime(payload.params); break;
    case 'getLatestBlockhash': validateGetLatestBlockhash(payload.params); break;
    case 'getMultipleAccounts': validateGetMultipleAccounts(payload.params); break;
    case 'getProgramAccounts': validateGetProgramAccounts(payload.params, options.programId); break;
    case 'getSignatureStatuses': validateGetSignatureStatuses(payload.params); break;
    case 'getSlot': validateGetSlot(payload.params); break;
    case 'sendTransaction': validateSendTransaction(payload.params); break;
    case 'simulateTransaction': validateSimulateTransaction(payload.params); break;
  }
  return payload as Record<string, unknown> & { method: string };
}

function validateGetAccountInfo(value: unknown) {
  const params = tuple(value, 1, 2);
  solanaAddress(params[0], 'account address');
  if (params[1] !== undefined) accountConfig(params[1]);
}

function validateGetMultipleAccounts(value: unknown) {
  const params = tuple(value, 1, 2);
  if (!Array.isArray(params[0]) || params[0].length < 1 || params[0].length > 100) invalid('getMultipleAccounts accepts 1 to 100 addresses.');
  for (const account of params[0]) solanaAddress(account, 'account address');
  if (params[1] !== undefined) accountConfig(params[1]);
}

function validateSimulateTransaction(value: unknown) {
  const params = tuple(value, 2, 2);
  if (typeof params[0] !== 'string' || params[0].length < 1 || params[0].length > 2_000 || !BASE64_PATTERN.test(params[0])) {
    invalid('simulateTransaction requires one bounded base64 transaction.');
  }
  const config = record(params[1], 'simulateTransaction config');
  exactKeys(config, ['commitment', 'encoding', 'sigVerify', 'replaceRecentBlockhash']);
  if (config.commitment !== 'confirmed' || config.encoding !== 'base64' || config.sigVerify !== false || config.replaceRecentBlockhash !== false) {
    invalid('Only confirmed simulation with sigVerify disabled is allowed.');
  }
}

function validateGetProgramAccounts(value: unknown, programId?: string) {
  const params = tuple(value, 2, 2);
  const requestedProgram = solanaAddress(params[0], 'program address');
  if (programId && requestedProgram !== programId) throw new SolanaProxyError('Program account scan is not allowed.', 403);
  const config = record(params[1], 'getProgramAccounts config');
  exactKeys(config, ['commitment', 'encoding', 'filters']);
  if (config.commitment !== 'finalized' || config.encoding !== 'base64' || !Array.isArray(config.filters) || config.filters.length !== 2) {
    invalid('Only the bounded trainee account scan is allowed.');
  }
  const dataSize = config.filters.map(filter => record(filter, 'program account filter')).find(filter => 'dataSize' in filter);
  const memcmp = config.filters.map(filter => record(filter, 'program account filter')).find(filter => 'memcmp' in filter);
  if (!dataSize || Object.keys(dataSize).length !== 1 || dataSize.dataSize !== 122) invalid('Program account dataSize filter is required.');
  if (!memcmp || Object.keys(memcmp).length !== 1) invalid('Program account owner filter is required.');
  const comparison = record(memcmp.memcmp, 'memcmp filter');
  exactKeys(comparison, ['offset', 'bytes']);
  if (comparison.offset !== 8) invalid('Program account owner filter has an invalid offset.');
  solanaAddress(comparison.bytes, 'trainee owner');
}

function validateGetAssetsByOwner(value: unknown) {
  const params = record(value, 'getAssetsByOwner params');
  exactKeys(params, ['ownerAddress', 'page', 'limit']);
  solanaAddress(params.ownerAddress, 'asset owner');
  boundedInteger(params.page, 1, 100, 'DAS page');
  boundedInteger(params.limit, 1, 1_000, 'DAS limit');
}

function validateGetSlot(value: unknown) {
  const params = tuple(value, 0, 1);
  if (params[0] !== undefined) commitmentConfig(params[0], ['commitment']);
}

function validateGetBlockTime(value: unknown) {
  const params = tuple(value, 1, 1);
  boundedInteger(params[0], 0, Number.MAX_SAFE_INTEGER, 'slot');
}

function validateGetLatestBlockhash(value: unknown) {
  const params = tuple(value, 0, 1);
  if (params[0] !== undefined) commitmentConfig(params[0], ['commitment', 'minContextSlot']);
}

function validateGetSignatureStatuses(value: unknown) {
  const params = tuple(value, 1, 2);
  if (!Array.isArray(params[0]) || params[0].length < 1 || params[0].length > 20) invalid('Signature status accepts 1 to 20 signatures.');
  for (const signature of params[0]) {
    if (typeof signature !== 'string' || !SIGNATURE_PATTERN.test(signature)) invalid('Invalid transaction signature.');
  }
  if (params[1] !== undefined) {
    const config = record(params[1], 'signature status config');
    exactKeys(config, ['searchTransactionHistory']);
    if (typeof config.searchTransactionHistory !== 'boolean') invalid('Invalid signature status config.');
  }
}

function validateSendTransaction(value: unknown) {
  const params = tuple(value, 1, 2);
  if (typeof params[0] !== 'string' || params[0].length < 1 || params[0].length > 4_096 || !BASE64_PATTERN.test(params[0])) {
    invalid('Invalid serialized transaction.');
  }
  if (params[1] === undefined) return;
  const config = record(params[1], 'sendTransaction config');
  exactKeys(config, ['encoding', 'maxRetries', 'preflightCommitment', 'skipPreflight']);
  if (config.encoding !== 'base64') invalid('Only base64 transactions are allowed.');
  if (config.maxRetries !== undefined) boundedInteger(config.maxRetries, 0, 10, 'maxRetries');
  if (config.preflightCommitment !== undefined && !['confirmed', 'finalized'].includes(String(config.preflightCommitment))) invalid('Invalid preflight commitment.');
  if (config.skipPreflight !== undefined && typeof config.skipPreflight !== 'boolean') invalid('Invalid skipPreflight value.');
}

function accountConfig(value: unknown) {
  const config = record(value, 'account config');
  commitmentConfig(config, ['commitment', 'encoding', 'minContextSlot']);
  if (config.encoding !== undefined && config.encoding !== 'base64') invalid('Only base64 account encoding is allowed.');
}

function commitmentConfig(value: unknown, keys: string[]) {
  const config = record(value, 'commitment config');
  exactKeys(config, keys);
  if (config.commitment !== undefined && !['confirmed', 'finalized'].includes(String(config.commitment))) invalid('Invalid commitment.');
  if (config.minContextSlot !== undefined) boundedInteger(config.minContextSlot, 0, Number.MAX_SAFE_INTEGER, 'minContextSlot');
}

async function readLimitedJson(response: Response, maximumBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new SolanaProxyError('Solana RPC response is too large.', 502);
  if (!response.body) throw new SolanaProxyError('Solana RPC returned an empty response.', 502);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new SolanaProxyError('Solana RPC response is too large.', 502);
    }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks, total).toString('utf8')); }
  catch { throw new SolanaProxyError('Solana RPC returned invalid JSON.', 502); }
}

function tuple(value: unknown, minimum: number, maximum: number) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid('Invalid Solana RPC parameters.');
  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} is required.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid('Unsupported Solana RPC parameter.');
}

function solanaAddress(value: unknown, name: string) {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) invalid(`Invalid ${name}.`);
  return value as string;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid(`Invalid ${name}.`);
}

function validId(value: unknown) {
  return (typeof value === 'string' && value.length <= 128) || (Number.isSafeInteger(value) && Number(value) >= 0);
}

function invalid(message: string): never {
  throw new SolanaProxyError(message, 400);
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
    for (const [key, current] of requests) {
      if (now - current.windowStartedAt >= 60_000) requests.delete(key);
    }
  }
}
