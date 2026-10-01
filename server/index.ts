import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Binary, ObjectId } from 'mongodb';
import { loadServerConfig } from './config.js';
import { connectDatabase } from './database.js';
import { createVoucherService, VoucherError } from './voucherService.js';
import { DrivingSceneError, listScenes, parseSceneInput, sceneSummary, type DrivingSceneDocument } from './drivingScenes.js';
import { createTradeService, TradeError } from './trade.js';
import { AdminAuthError, createAdminAuth } from './adminAuth.js';
import { createFeeAdminService, FeeAdminError } from './feeAdmin.js';
import { loadPublicTokenConfig, normalizeTicker, type PublicTokenConfig } from './tokenConfig.js';
import { createPublicDataService, PublicDataError } from './publicData.js';
import { createSolanaProxy, SolanaProxyError } from './solanaProxy.js';
import { createTraineeCampaignAdmin, fixedTraineeCampaignWord, TraineeCampaignAdminError } from './traineeCampaignAdmin.js';
import { createMintQuoteService, loadMintMarketPreview, loadMintMetadata, MintQuoteError } from './mintQuoteService.js';
import { performWorkerAction } from './workerAutomation.js';
import { parseWorkerAction, publicWorkerSettings, loadWorkerSettings, runWorkerAction, updateWorkerSettings, WorkerControlError } from './workerControl.js';
import { createRehearsalBudgetGuard, RehearsalBudgetError } from './rehearsalBudget.js';
import { configureTransactionBudgetGuard } from './transaction.js';
import { createTelegramAlertService } from './telegramAlerts.js';
import { installConsoleErrorPersistence, recordError } from './errorLog.js';

const config = loadServerConfig();
const database = await connectDatabase(config.mongoUri, config.mongoDatabase);
installConsoleErrorPersistence(database.errorLogs);
if (config.rehearsalMode) configureTransactionBudgetGuard(await createRehearsalBudgetGuard({
  rpcUrl: config.solanaRpcUrl,
  collection: database.rehearsalBudget,
  ordinaryLimitLamports: config.rehearsalOrdinaryBudgetLamports,
  hardLimitLamports: config.rehearsalHardBudgetLamports,
  transactionReserveLamports: config.rehearsalTransactionReserveLamports,
  initialSpentLamports: config.rehearsalInitialSpentLamports,
}));
const telegramAlerts = config.telegramBotTokenFile
  ? await createTelegramAlertService(
      config.telegramBotTokenFile,
      database.telegramAlerts,
      database.telegramAlertStates,
      database.telegramAudit,
    )
  : undefined;
const issueVoucher = createVoucherService(config, database);
const issueMintQuote = createMintQuoteService(config);
let publicToken: PublicTokenConfig = await loadPublicTokenConfig(config.solanaRpcUrl, config.programId, database.tokenConfig)
  .catch(error => {
    console.warn(`Public token configuration is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return { configured: false, mint: null, ticker: null };
  });
let trade = publicToken.configured && publicToken.mint && publicToken.ticker
  ? createTradeService(config, database, { mint: publicToken.mint, ticker: publicToken.ticker })
  : undefined;
const adminValues = [config.adminUsername, config.adminPasswordScrypt, config.adminSessionSecret, config.protocolAdminSecret, config.pumpFeeRecipientSecret];
if (adminValues.some(Boolean) && !adminValues.every(Boolean)) throw new Error('Admin configuration is incomplete');
const adminAuth = adminValues.every(Boolean) ? createAdminAuth({
  username: config.adminUsername!,
  passwordScrypt: config.adminPasswordScrypt!,
  sessionSecret: config.adminSessionSecret!,
  secureCookies: config.adminSecureCookies,
}, database.adminLoginLimits) : null;
const feeAdmin = adminAuth ? await createFeeAdminService({
  rpcUrl: config.solanaRpcUrl,
  programId: config.programId,
  adminSecret: config.protocolAdminSecret!,
  feeRecipientSecret: config.pumpFeeRecipientSecret!,
  cluster: config.solanaCluster,
  minimumWalletLamports: config.adminMinimumWalletLamports,
  workerIntervalMs: config.workerIntervalMs,
}, database.adminFeeActions, database.adminFeeOperations, database.tokenConfig, database.workerStatus) : null;
const publicData = createPublicDataService({ ...config, fareSymbol: () => publicToken.ticker || 'FARE' }, database);
const workerDefaults = { enabled: config.workerInitiallyEnabled, intervalMs: config.workerIntervalMs, minimumLamports: config.swapMinimumLamports };
await loadWorkerSettings(database.workerStatus, workerDefaults);
const proxySolana = createSolanaProxy(config.solanaRpcUrl, { programId: String(config.programId) });
const traineeCampaigns = createTraineeCampaignAdmin({
  ...config,
  primaryWord: fixedTraineeCampaignWord(config.mongoDatabase),
}, database);
if (publicToken.ticker) await traineeCampaigns.ensurePrimary(publicToken.ticker);

const server = createServer(async (request, response) => {
  setCors(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  try {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/api/admin')) requireAdminOrigin(request);
    if (url.pathname.startsWith('/api/driving-scenes')) requireLocalSceneAccess(request);
    if (request.method === 'GET' && request.url === '/api/health') {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/token') {
      json(response, 200, publicToken, { 'cache-control': 'no-store' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/public/overview') {
      json(response, 200, await publicData.overview(), { 'cache-control': 'public, max-age=15, stale-while-revalidate=60' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/public/market') {
      json(response, 200, await publicData.market());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/market/transactions') {
      requirePublicOrigin(request);
      json(response, 200, await publicData.recordMarketTransaction(await readJson(request)));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/solana-rpc') {
      requirePublicOrigin(request);
      json(response, 200, await proxySolana(await readJson(request, 65_536), clientAddress(request)));
      return;
    }
    const walletFleetRoute = /^\/api\/fleet\/wallet\/([^/]+)$/.exec(url.pathname);
    const walletHistoryRoute = /^\/api\/fleet\/history\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && walletFleetRoute) {
      json(response, 200, await publicData.walletFleet(decodeURIComponent(walletFleetRoute[1])));
      return;
    }
    if (request.method === 'GET' && walletHistoryRoute) {
      json(response, 200, await publicData.earningHistory(
        decodeURIComponent(walletHistoryRoute[1]),
        url.searchParams.get('period') || '24h',
      ));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/fleet/mints') {
      json(response, 201, await publicData.recordMint(await readJson(request)));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/login') {
      const services = requireAdminServices();
      const body = asRecord(await readJson(request));
      const session = await services.auth.login(body.username, body.password, request.socket.remoteAddress || 'unknown');
      services.auth.setSessionCookie(response, session.token);
      json(response, 200, { csrf: session.csrf, expiresAt: session.expiresAt });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/logout') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      services.auth.clearSessionCookie(response);
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/session') {
      const services = requireAdminServices();
      json(response, 200, services.auth.require(request));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/status') {
      const services = requireAdminServices();
      services.auth.require(request);
      const status = await services.fees.status();
      const budget = config.rehearsalMode
        ? await database.rehearsalBudget.findOne({ key: 'disposable-rehearsal' })
        : null;
      json(response, 200, {
        ...status,
        ...(budget ? { rehearsalBudget: {
          spentLamports: String(budget.spentLamports),
          reservedLamports: String(budget.reservedLamports),
          ordinaryLimitLamports: String(budget.ordinaryLimitLamports),
          hardLimitLamports: String(budget.hardLimitLamports),
          pendingReservations: Object.keys(budget.reservations).length,
        } } : {}),
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/trainee-campaigns') {
      const services = requireAdminServices();
      services.auth.require(request);
      json(response, 200, { campaigns: await traineeCampaigns.list() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/trainee-campaigns') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      json(response, 201, await traineeCampaigns.create(await readJson(request)));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/mint/inspect') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      const body = asRecord(await readJson(request));
      const inspected = await services.fees.inspectMint(body.ca);
      const ticker = normalizeAdminTicker(body.ticker);
      const [market, metadata] = await Promise.all([
        loadMintMarketPreview(config, inspected.mint, inspected.decimals, body.pricesUsd),
        loadMintMetadata(config.solanaRpcUrl, inspected.mint),
      ]);
      json(response, 200, { mint: String(inspected.mint), creator: String(inspected.creator), ticker, decimals: inspected.decimals, tokenProgram: String(inspected.tokenProgram), metadata, market, ready: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/mint/bind') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      const body = asRecord(await readJson(request));
      const result = await services.fees.bindMint(body.ca, body.ticker);
      publicToken = { configured: true, mint: result.mint, ticker: result.ticker };
      await traineeCampaigns.ensurePrimary(result.ticker);
      trade?.stop();
      trade = createTradeService(config, database, { mint: result.mint, ticker: result.ticker });
      void publicData.sync(true).catch(error => {
        console.warn(`Public data refresh after token replacement failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      json(response, 200, result);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/team') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      const body = asRecord(await readJson(request));
      json(response, 200, await services.fees.setTeamAccount(body.teamAccount));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/protocol/pause') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      const body = asRecord(await readJson(request));
      json(response, 200, await services.fees.setPaused(body.paused, body.migrationConfirmed));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/protocol/rescue') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      const body = asRecord(await readJson(request));
      json(response, 200, await services.fees.emergencyRescue(body.recipient));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/fees/claim') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      json(response, 200, await services.fees.claim(asRecord(await readJson(request)).operationId));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/fees/deposit') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      const body = asRecord(await readJson(request));
      json(response, 200, await services.fees.deposit(body.amountLamports, body.operationId));
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
    if (request.method === 'GET' && url.pathname === '/api/admin/worker/settings') {
      const services = requireAdminServices();
      services.auth.require(request);
      json(response, 200, publicWorkerSettings(await loadWorkerSettings(database.workerStatus, workerDefaults)));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/worker/settings') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      json(response, 200, await updateWorkerSettings(database.workerStatus, asRecord(await readJson(request)), workerDefaults));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/worker/run') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      const action = parseWorkerAction(asRecord(await readJson(request)).action);
      json(response, 200, await runWorkerAction(database.workerStatus, workerDefaults, action, 'manual', (settings, runId) => (
        performWorkerAction(action, 'manual', settings, runId, services.fees)
      )));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/mint/prices') {
      const services = requireAdminServices();
      services.auth.require(request, true);
      const body = asRecord(await readJson(request));
      json(response, 200, await services.fees.setMintPrices(body.pricesUsd));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/mint/quote') {
      requirePublicOrigin(request);
      try {
        const quote = await issueMintQuote(await readJson(request));
        await telegramAlerts?.recovery('mint-quote', 'Mint quote generation is succeeding again.').catch(() => undefined);
        json(response, 200, quote);
      } catch (error) {
        const alertableQuoteFailure = !(error instanceof MintQuoteError)
          || (error.status >= 500 && /market|liquidity|route|price|jupiter|solana time/i.test(error.message));
        if (alertableQuoteFailure) {
          await telegramAlerts?.failure('mint-quote', 'Mint quote generation failed repeatedly. Check protected backend logs.', 3).catch(() => undefined);
        }
        throw error;
      }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/errors') {
      requirePublicOrigin(request);
      if (!allowClientError(clientAddress(request))) {
        json(response, 429, { error: 'Too many error reports.' });
        return;
      }
      const body = asRecord(await readJson(request, 16_384));
      if (typeof body.message !== 'string' || !body.message.trim()) throw new VoucherError('Error message is required.', 400);
      const errorId = await recordError(database.errorLogs, {
        source: 'client',
        name: body.name,
        message: body.message,
        stack: body.stack,
        path: body.path,
        context: body.context,
      });
      json(response, 202, { logged: true, errorId });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/mint/buy-quote') {
      requirePublicOrigin(request);
      requireTrade(trade);
      json(response, 200, await trade.createMintBuyQuote(await readJson(request)));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/mint/buy-build') {
      requirePublicOrigin(request);
      requireTrade(trade);
      json(response, 200, await trade.buildMintBuyInstructions(await readJson(request)));
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
    const status = error instanceof RehearsalBudgetError ? 409 : error instanceof VoucherError || error instanceof MintQuoteError || error instanceof DrivingSceneError || error instanceof TradeError || error instanceof AdminAuthError || error instanceof FeeAdminError || error instanceof WorkerControlError || error instanceof PublicDataError || error instanceof SolanaProxyError || error instanceof TraineeCampaignAdminError ? error.status : 500;
    const url = new URL(request.url || '/', 'http://localhost');
    const errorId = await recordError(database.errorLogs, {
      source: 'server', error, status, method: request.method, path: url.pathname,
      context: { rehearsalMode: config.rehearsalMode },
    }).catch(logError => {
      console.error('Unable to persist request error', logError, error);
      return undefined;
    });
    json(response, status, {
      error: status === 500 ? 'Internal server error.' : String((error as Error).message),
      ...(errorId ? { errorId } : {}),
    });
  }
});

server.listen(config.port, () => {
  console.log(`Taxi backend listening on http://127.0.0.1:${config.port}`);
  publicData.sync().catch(error => console.error('Initial public data sync failed', error));
  const publicDataTimer = setInterval(() => {
    publicData.sync().catch(error => console.error('Scheduled public data sync failed', error));
  }, 5 * 60 * 1_000);
  publicDataTimer.unref();
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
  response.setHeader('access-control-allow-credentials', 'true');
  response.setHeader('access-control-allow-headers', 'content-type, x-csrf-token');
  response.setHeader('vary', 'origin');
}

function requireLocalSceneAccess(request: IncomingMessage) {
  const address = request.socket.remoteAddress || '';
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') {
    throw new DrivingSceneError('Driving scene library is available only on this computer.', 403);
  }
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
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

function requireAdminServices() {
  if (!adminAuth || !feeAdmin) throw new FeeAdminError('Admin service is not configured.', 503);
  return { auth: adminAuth, fees: feeAdmin };
}

function requireAdminOrigin(request: IncomingMessage) {
  if (request.method === 'GET') return;
  const origin = request.headers.origin;
  if (typeof origin !== 'string') throw new AdminAuthError('Origin header is required.', 403);
  const local = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
  if (!local && origin !== config.allowedOrigin) throw new AdminAuthError('Origin is not allowed.', 403);
}

function requirePublicOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string') throw new SolanaProxyError('Origin header is required.', 403);
  const local = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
  if (!local && origin !== config.allowedOrigin) throw new SolanaProxyError('Origin is not allowed.', 403);
}

function clientAddress(request: IncomingMessage) {
  const forwarded = config.trustProxy ? request.headers['x-forwarded-for'] : undefined;
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()) || request.socket.remoteAddress || 'unknown';
}

const clientErrorWindows = new Map<string, { startedAt: number; count: number }>();
function allowClientError(client: string) {
  const now = Date.now();
  const current = clientErrorWindows.get(client);
  if (!current || now - current.startedAt >= 60_000) {
    clientErrorWindows.set(client, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 20;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VoucherError('JSON object is required.', 400);
  return value as Record<string, unknown>;
}

function normalizeAdminTicker(value: unknown) {
  try { return normalizeTicker(value); } catch (error) { throw new FeeAdminError((error as Error).message); }
}
