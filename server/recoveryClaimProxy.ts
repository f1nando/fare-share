import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createSolanaProxy, SolanaProxyError } from './solanaProxy.js';

const PROGRAM_ID = 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4';
const rpcUrl = required('SOLANA_RPC_URL');
const allowedOrigin = process.env.RECOVERY_CLAIM_ORIGIN?.trim() || 'https://ownataxi.com';
const port = Number(process.env.PORT || 8787);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('PORT is invalid');
const proxy = createSolanaProxy(rpcUrl, { programId: PROGRAM_ID });

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/health') {
      json(response, 200, { ok: true, mode: 'recovery-claim' });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/solana-rpc') {
      requireOrigin(request);
      json(response, 200, await proxy(await readJson(request), clientAddress(request)));
      return;
    }
    json(response, 503, { error: 'The service is in recovery claim mode.' });
  } catch (error) {
    if (error instanceof SolanaProxyError) json(response, error.status, { error: error.message });
    else json(response, 400, { error: error instanceof Error ? error.message : 'Invalid request.' });
  }
}).listen(port, '127.0.0.1', () => console.log(`Recovery claim proxy listening on 127.0.0.1:${port}`));

function requireOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (origin !== allowedOrigin) throw new SolanaProxyError('Origin is not allowed.', 403);
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 65_536) throw new SolanaProxyError('Request is too large.', 413);
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SolanaProxyError('Invalid JSON.', 400); }
}

function clientAddress(request: IncomingMessage) {
  const forwarded = request.headers['cf-connecting-ip'] || request.headers['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim())
    || request.socket.remoteAddress
    || 'unknown';
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
