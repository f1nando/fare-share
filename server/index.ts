import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Binary, ObjectId } from 'mongodb';
import { loadServerConfig } from './config.js';
import { connectDatabase } from './database.js';
import { createVoucherService, VoucherError } from './voucherService.js';
import { DrivingSceneError, listScenes, parseSceneInput, sceneSummary, type DrivingSceneDocument } from './drivingScenes.js';
import { createTradeService, TradeError } from './trade.js';

const config = loadServerConfig();
const database = await connectDatabase(config.mongoUri, config.mongoDatabase);
const issueVoucher = createVoucherService(config, database);
const trade = createTradeService(config, database);

const server = createServer(async (request, response) => {
  setCors(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  try {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/api/driving-scenes')) requireLocalSceneAccess(request);
    if (request.method === 'GET' && request.url === '/api/health') {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/trainee/voucher') {
      const body = await readJson(request);
      const forwarded = config.trustProxy ? request.headers['x-forwarded-for'] : undefined;
      const remote = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown';
      json(response, 200, await issueVoucher(body, remote));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/driving-scenes') {
      json(response, 200, { scenes: await listScenes(database.drivingScenes) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/trade/token') {
      requireTrade(trade);
      json(response, 200, await trade.tokenSnapshot());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/trade/trades') {
      requireTrade(trade);
      json(response, 200, await trade.listTrades(numberParam(url, 'limit', 50), url.searchParams.get('before') || undefined));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/trade/holders') {
      requireTrade(trade);
      json(response, 200, await trade.listHolders(numberParam(url, 'limit', 50), numberParam(url, 'skip', 0)));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/trade/candles') {
      requireTrade(trade);
      json(response, 200, await trade.candles(url.searchParams.get('interval') || '1h', numberParam(url, 'limit', 300)));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/trade/stream') {
      requireTrade(trade);
      trade.openStream(response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/trade/quote') {
      requireTrade(trade);
      json(response, 200, await trade.createQuote(await readJson(request)));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/trade/build') {
      requireTrade(trade);
      json(response, 200, await trade.buildSwap(await readJson(request)));
      return;
    }
    const tradeStatusRoute = /^\/api\/trade\/status\/([^/]+)$/.exec(url.pathname);
    const tradeBalanceRoute = /^\/api\/trade\/balance\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && tradeBalanceRoute) {
      requireTrade(trade);
      json(response, 200, await trade.walletBalances(decodeURIComponent(tradeBalanceRoute[1])));
      return;
    }
    if (request.method === 'GET' && tradeStatusRoute) {
      requireTrade(trade);
      json(response, 200, await trade.signatureStatus(decodeURIComponent(tradeStatusRoute[1])));
      return;
    }
    const sceneRoute = /^\/api\/driving-scenes\/([a-f0-9]{24})(?:\/(image))?$/.exec(url.pathname);
    if (request.method === 'GET' && sceneRoute?.[2] === 'image') {
      const scene = await database.drivingScenes.findOne({ _id: new ObjectId(sceneRoute[1]) }, { projection: { image: 1, imageMime: 1, updatedAt: 1 } });
      if (!scene) throw new DrivingSceneError('Scene not found.', 404);
      response.writeHead(200, {
        'content-type': scene.imageMime,
        'cache-control': 'public, max-age=31536000, immutable',
      });
      response.end(Buffer.from(scene.image.buffer));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/driving-scenes') {
      const input = parseSceneInput(await readJson(request, 12 * 1024 * 1024), true);
      const now = new Date();
      const document = {
        _id: new ObjectId(),
        name: input.name,
        image: new Binary(input.image!.bytes),
        imageMime: input.image!.mime,
        settings: input.settings,
        vehicleClass: input.vehicleClass,
        lightsOn: input.lightsOn,
        createdAt: now,
        updatedAt: now,
      };
      await database.drivingScenes.insertOne(document);
      const { image: _image, ...summary } = document;
      json(response, 201, { scene: sceneSummary(summary) });
      return;
    }
    if (request.method === 'PUT' && sceneRoute && !sceneRoute[2]) {
      const input = parseSceneInput(await readJson(request, 12 * 1024 * 1024), false);
      const now = new Date();
      const update: Record<string, unknown> = {
        name: input.name,
        settings: input.settings,
        vehicleClass: input.vehicleClass,
        lightsOn: input.lightsOn,
        updatedAt: now,
      };
      if (input.image) {
        update.image = new Binary(input.image.bytes);
        update.imageMime = input.image.mime;
      }
      const result = await database.drivingScenes.findOneAndUpdate(
        { _id: new ObjectId(sceneRoute[1]) },
        { $set: update },
        { returnDocument: 'after', projection: { image: 0 } },
      );
      if (!result) throw new DrivingSceneError('Scene not found.', 404);
      json(response, 200, { scene: sceneSummary(result as Omit<DrivingSceneDocument, 'image'>) });
      return;
    }
    if (request.method === 'DELETE' && sceneRoute && !sceneRoute[2]) {
      const result = await database.drivingScenes.deleteOne({ _id: new ObjectId(sceneRoute[1]) });
      if (!result.deletedCount) throw new DrivingSceneError('Scene not found.', 404);
      response.writeHead(204).end();
      return;
    }
    json(response, 404, { error: 'Not found' });
  } catch (error) {
    const status = error instanceof VoucherError || error instanceof DrivingSceneError || error instanceof TradeError ? error.status : 500;
    if (status === 500) console.error(error);
    json(response, status, { error: status === 500 ? 'Internal server error.' : String((error as Error).message) });
  }
});

server.listen(config.port, () => {
  console.log(`Taxi backend listening on http://127.0.0.1:${config.port}`);
});

async function readJson(request: IncomingMessage, maximumSize = 16_384): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumSize) throw new VoucherError('Request is too large.', 413);
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new VoucherError('Invalid JSON.', 400); }
}

function setCors(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  const localOrigin = typeof origin === 'string' && /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
  response.setHeader('access-control-allow-origin', localOrigin ? origin : config.allowedOrigin);
  response.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('vary', 'origin');
}

function requireLocalSceneAccess(request: IncomingMessage) {
  const address = request.socket.remoteAddress || '';
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') {
    throw new DrivingSceneError('Driving scene library is available only on this computer.', 403);
  }
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function shutdown() {
  server.close();
  trade?.stop();
  await database.client.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function requireTrade(value: typeof trade): asserts value is NonNullable<typeof trade> {
  if (!value) throw new TradeError('Trade service is not configured.', 503);
}

function numberParam(url: URL, name: string, fallback: number) {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new TradeError(`${name} must be an integer.`);
  return value;
}
