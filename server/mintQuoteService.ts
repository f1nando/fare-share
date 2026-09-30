import { address, getAddressEncoder, type Address } from '@solana/kit';
import type { ServerConfig } from './config.js';
import { jupiterRequest } from './jupiterHttp.js';
import { buildMintQuoteMessage, parseBackendSigner } from './signing.js';
import { solanaRpcCall } from './solanaRpc.js';
import { decodeWorkerConfiguration } from './solanaState.js';
import { protocolAddresses } from './setup.js';
import { loadMintAssignments, TOTAL_PAID_SUPPLY, type MintAssignmentWithProof } from './mintAssignments.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const ZERO_ADDRESS = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MINT_PRICE_USD_CENTS = 2_500n;
const MINT_BASE_LENGTH = 82;
const TOKEN_2022_ACCOUNT_TYPE_OFFSET = 165;
const TOKEN_2022_TLV_OFFSET = 166;
const METADATA_POINTER_EXTENSION = 18;
const TOKEN_METADATA_EXTENSION = 19;
const addressEncoder = getAddressEncoder();

interface MarketQuote {
  inputMint?: string;
  outputMint?: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
  routePlan?: unknown[];
}

export interface MintMarketProvider {
  referenceUsd(mint: Address): Promise<{ usdPrice: number; observedAtMs: number }>;
  sellToUsdc(mint: Address, amountRaw: bigint): Promise<MarketQuote>;
}

export class MintQuoteError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'MintQuoteError';
  }
}

export function createMintQuoteService(
  config: ServerConfig,
  options: {
    market?: MintMarketProvider;
    now?: () => number;
    loadState?: () => Promise<Awaited<ReturnType<typeof loadMintState>>>;
    loadAssignment?: (index: number, root: Uint8Array) => Promise<MintAssignmentWithProof>;
  } = {},
) {
  const signer = parseBackendSigner(config.signerSecret);
  const now = options.now || Date.now;
  const market = options.market || jupiterMarket(config);
  const loadState = options.loadState || (() => loadMintState(config));
  let assignmentsPromise: ReturnType<typeof loadMintAssignments> | undefined;
  const loadAssignment = options.loadAssignment || (async (index: number, root: Uint8Array) => {
    assignmentsPromise ||= loadMintAssignments(config.mintAssignmentsPath);
    const assignments = await assignmentsPromise;
    if (!Buffer.from(assignments.root).equals(Buffer.from(root))) throw new Error('MINT_ASSIGNMENTS_PATH does not match the on-chain assignment root');
    return assignments.assignment(index);
  });

  return async function issueMintQuote(input: unknown) {
    const body = validateInput(input);
    const state = await loadState();
    if (!state.configuration.saleStarted) throw new MintQuoteError('The car sale is not open.', 409);
    if (state.configuration.pausedAt !== 0n) throw new MintQuoteError('The protocol is paused.', 503);
    if (String(state.configuration.fareMint) === ZERO_ADDRESS) throw new MintQuoteError('FARE is not configured.', 503);
    if (state.configuration.backendSigner !== signer.publicKey) throw new Error('BACKEND_SIGNER_SECRET_KEY does not match the on-chain backend signer');
    const assignmentIndex = state.configuration.mintedByClass.reduce((total, value) => total + value, 0);
    if (assignmentIndex >= TOTAL_PAID_SUPPLY) throw new MintQuoteError('The taxi collection is sold out.', 409);
    if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(state.tokenProgram)) throw new MintQuoteError('FARE uses an unsupported Token Program.', 503);
    if (!mintDataIsExactTransferCompatible(state.tokenProgram, state.configuration.fareMint, state.mintData)) {
      throw new MintQuoteError('This Token-2022 mint has extensions that cannot guarantee an exact payment.', 503);
    }
    const priceUsdCents = state.configuration.mintPrices[0];
    if (!state.configuration.mintPrices.every(price => price === MINT_PRICE_USD_CENTS)) throw new MintQuoteError('Mint price must be exactly $25.', 503);
    const assignment = await loadAssignment(assignmentIndex, state.configuration.mintAssignmentRoot);
    const reference = await market.referenceUsd(state.configuration.fareMint);
    if (!Number.isFinite(reference.usdPrice) || reference.usdPrice <= 0) throw new MintQuoteError('A reliable FARE market price is unavailable.', 503);
    if (now() - reference.observedAtMs > config.mintQuoteMarketMaxAgeMs) throw new MintQuoteError('FARE market data is stale.', 503);

    const targetUsdcRaw = priceUsdCents * 10_000n;
    const referenceUsdMicros = BigInt(Math.floor(reference.usdPrice * 1_000_000));
    if (referenceUsdMicros <= 0n) throw new MintQuoteError('FARE price precision is too low for a safe quote.', 503);
    let amountFareRaw = ceilDiv(targetUsdcRaw * 10n ** BigInt(state.decimals), referenceUsdMicros);
    let route: MarketQuote | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      route = await market.sellToUsdc(state.configuration.fareMint, amountFareRaw);
      validateRoute(route, state.configuration.fareMint, amountFareRaw, config.mintQuoteMaxPriceImpactPct);
      const output = BigInt(route.outAmount);
      if (output >= targetUsdcRaw) break;
      amountFareRaw = ceilDiv(amountFareRaw * targetUsdcRaw, output);
    }
    if (!route || BigInt(route.outAmount) < targetUsdcRaw) throw new MintQuoteError('FARE liquidity is insufficient for this mint.', 503);
    if (amountFareRaw > 18_446_744_073_709_551_615n) throw new MintQuoteError('The required FARE amount exceeds the on-chain limit.', 503);
    const effectiveMicrosPerToken = Number(BigInt(route.outAmount) * 10n ** BigInt(state.decimals) / amountFareRaw);
    const effectiveUsd = effectiveMicrosPerToken / 1_000_000;
    const divergencePct = Math.abs(effectiveUsd - reference.usdPrice) / reference.usdPrice * 100;
    if (divergencePct > config.mintQuoteMaxPriceDivergencePct) throw new MintQuoteError('FARE market prices are inconsistent.', 503);

    const expiresAt = state.chainTime + BigInt(config.mintQuoteTtlSeconds);
    const fields = {
      owner: body.owner,
      asset: body.asset,
      assignmentIndex,
      classIndex: assignment.classIndex,
      variantIndex: assignment.variantIndex,
      fareMint: state.configuration.fareMint,
      amountFareRaw,
      priceUsdCents,
      expiresAt,
    };
    const message = buildMintQuoteMessage(config.programId, state.configuration.deploymentId, fields);
    return {
      ...fields,
      owner: String(fields.owner),
      asset: String(fields.asset),
      fareMint: String(fields.fareMint),
      amountFareRaw: fields.amountFareRaw.toString(),
      priceUsdCents: fields.priceUsdCents.toString(),
      expiresAt: fields.expiresAt.toString(),
      fareDecimals: state.decimals,
      backendSigner: String(signer.publicKey),
      message: Buffer.from(message).toString('base64'),
      signature: Buffer.from(signer.sign(message)).toString('base64'),
      quotedUsdcRaw: route.outAmount,
      priceImpactPct: Number(route.priceImpactPct || 0),
      assignmentProof: assignment.proof,
    };
  };
}

export function ceilDiv(numerator: bigint, denominator: bigint) {
  if (numerator < 0n || denominator <= 0n) throw new Error('ceilDiv expects a non-negative numerator and positive denominator');
  return (numerator + denominator - 1n) / denominator;
}

export async function loadMintMarketPreview(config: ServerConfig, mint: Address, decimals: number, rawPricesUsd: unknown) {
  if (!Array.isArray(rawPricesUsd) || rawPricesUsd.length !== 4) throw new MintQuoteError('Four matching USD prices are required for liquidity inspection.');
  const pricesUsdCents = rawPricesUsd.map((value, index) => {
    const cents = Math.round(Number(value) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) throw new MintQuoteError(`Class ${index + 1} USD price is invalid.`);
    return BigInt(cents);
  });
  if (!pricesUsdCents.every(price => price === MINT_PRICE_USD_CENTS)) throw new MintQuoteError('Every mint must cost exactly $25.');
  const provider = jupiterMarket(config);
  const reference = await provider.referenceUsd(mint);
  if (!Number.isFinite(reference.usdPrice) || reference.usdPrice <= 0) throw new MintQuoteError('A reliable FARE market price is unavailable.', 503);
  const examples = [];
  for (const cents of pricesUsdCents) {
    const amount = ceilDiv(cents * 10_000n * 10n ** BigInt(decimals), BigInt(Math.floor(reference.usdPrice * 1_000_000)));
    const route = await provider.sellToUsdc(mint, amount);
    validateRoute(route, mint, amount, config.mintQuoteMaxPriceImpactPct);
    examples.push({ priceUsdCents: cents.toString(), amountFareRaw: amount.toString(), priceImpactPct: Number(route.priceImpactPct || 0) });
  }
  return { usdPrice: reference.usdPrice, liquidity: 'available', examples };
}

export async function loadMintMetadata(rpcUrl: string, mint: Address) {
  try {
    const asset = await solanaRpcCall<{ content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string } } }>(rpcUrl, 'getAsset', [{ id: String(mint) }]);
    return {
      name: asset.content?.metadata?.name || null,
      symbol: asset.content?.metadata?.symbol || null,
      image: asset.content?.links?.image || null,
    };
  } catch {
    return { name: null, symbol: null, image: null };
  }
}

function validateRoute(route: MarketQuote, fareMint: Address, amount: bigint, maximumImpact: number) {
  if ((route.inputMint && route.inputMint !== String(fareMint))
    || (route.outputMint && route.outputMint !== USDC_MINT)
    || route.inAmount !== amount.toString() || !route.routePlan?.length || !/^\d+$/.test(route.outAmount || '') || BigInt(route.outAmount) <= 0n) {
    throw new MintQuoteError('No liquid FARE to USDC route is available.', 503);
  }
  const impact = Number(route.priceImpactPct || 0);
  if (!Number.isFinite(impact) || impact < 0 || impact > maximumImpact) {
    throw new MintQuoteError('FARE price impact is above the mint safety limit.', 503);
  }
}

function validateInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MintQuoteError('JSON object is required.');
  const value = input as Record<string, unknown>;
  let owner: Address;
  let asset: Address;
  try { owner = address(String(value.owner || '').trim()); } catch { throw new MintQuoteError('Invalid owner wallet.'); }
  try { asset = address(String(value.asset || '').trim()); } catch { throw new MintQuoteError('Invalid asset address.'); }
  return { owner, asset };
}

async function loadMintState(config: ServerConfig) {
  const addresses = await protocolAddresses(config.programId);
  const account = await solanaRpcCall<{ value: { data: [string, string] } | null }>(config.solanaRpcUrl, 'getAccountInfo', [addresses.config, { commitment: 'finalized', encoding: 'base64' }]);
  if (!account.value) throw new MintQuoteError('Taxi configuration is unavailable.', 503);
  const configuration = decodeWorkerConfiguration(Buffer.from(account.value.data[0], 'base64'));
  const [mintAccount, slot] = await Promise.all([
    solanaRpcCall<{ value: { owner: string; data: [string, string] } | null }>(config.solanaRpcUrl, 'getAccountInfo', [configuration.fareMint, { commitment: 'finalized', encoding: 'base64' }]),
    solanaRpcCall<number>(config.solanaRpcUrl, 'getSlot', [{ commitment: 'finalized' }]),
  ]);
  if (!mintAccount.value) throw new MintQuoteError('FARE mint account is unavailable.', 503);
  const mintData = Buffer.from(mintAccount.value.data[0], 'base64');
  if (mintData.length < 82 || mintData[45] !== 1) throw new MintQuoteError('FARE mint account is invalid.', 503);
  const blockTime = await solanaRpcCall<number | null>(config.solanaRpcUrl, 'getBlockTime', [slot]);
  if (blockTime === null) throw new MintQuoteError('Finalized Solana time is unavailable.', 503);
  return { configuration, decimals: mintData[44], tokenProgram: mintAccount.value.owner, mintData, chainTime: BigInt(blockTime) };
}

export function mintDataIsExactTransferCompatible(tokenProgram: string, mint: Address, data: Uint8Array) {
  if (tokenProgram === TOKEN_PROGRAM) return data.length >= MINT_BASE_LENGTH;
  if (tokenProgram !== TOKEN_2022_PROGRAM || data.length < MINT_BASE_LENGTH) return false;
  if (data.length === MINT_BASE_LENGTH) return true;
  if (data.length < TOKEN_2022_TLV_OFFSET
    || data.subarray(MINT_BASE_LENGTH, TOKEN_2022_ACCOUNT_TYPE_OFFSET).some(byte => byte !== 0)
    || data[TOKEN_2022_ACCOUNT_TYPE_OFFSET] !== 1) return false;

  const mintBytes = Uint8Array.from(addressEncoder.encode(mint));
  let offset = TOKEN_2022_TLV_OFFSET;
  let metadataPointer = false;
  let tokenMetadata = false;
  while (offset < data.length) {
    if (offset + 4 > data.length) return false;
    const extensionType = data[offset] | (data[offset + 1] << 8);
    const extensionLength = data[offset + 2] | (data[offset + 3] << 8);
    offset += 4;
    if (offset + extensionLength > data.length) return false;
    const extension = data.subarray(offset, offset + extensionLength);
    if (extensionType === METADATA_POINTER_EXTENSION && !metadataPointer && extensionLength === 64) {
      if (extension.subarray(0, 32).some(byte => byte !== 0)
        || !extension.subarray(32, 64).every((byte, index) => byte === mintBytes[index])) return false;
      metadataPointer = true;
    } else if (extensionType === TOKEN_METADATA_EXTENSION && !tokenMetadata && extensionLength >= 64) {
      if (extension.subarray(0, 32).some(byte => byte !== 0)
        || !extension.subarray(32, 64).every((byte, index) => byte === mintBytes[index])) return false;
      tokenMetadata = true;
    } else {
      return false;
    }
    offset += extensionLength;
  }
  return metadataPointer && tokenMetadata;
}

function jupiterMarket(config: ServerConfig): MintMarketProvider {
  const headers = { accept: 'application/json', ...(config.jupiterApiKey ? { 'x-api-key': config.jupiterApiKey } : {}) };
  return {
    async referenceUsd(mint) {
      if (!config.jupiterApiKey) throw new MintQuoteError('Jupiter pricing is unavailable.', 503);
      const response = await jupiterRequest(`https://api.jup.ag/price/v3?ids=${encodeURIComponent(String(mint))}`, { headers }, { operation: 'mint reference price', requestTimeoutMs: 8_000 });
      const payload = await response.json() as Record<string, { usdPrice?: number }>;
      return { usdPrice: Number(payload[String(mint)]?.usdPrice || 0), observedAtMs: Date.now() };
    },
    async sellToUsdc(mint, amountRaw) {
      const quote = async (outputMint: string) => {
        const query = new URLSearchParams({ inputMint: String(mint), outputMint, amount: amountRaw.toString(), slippageBps: '0', restrictIntermediateTokens: 'true' });
        const response = await jupiterRequest(`https://api.jup.ag/swap/v1/quote?${query}`, { headers }, { operation: 'mint liquidity quote', requestTimeoutMs: 10_000 });
        return await response.json() as MarketQuote;
      };
      const direct = await quote(USDC_MINT).catch(() => null);
      if (direct?.routePlan?.length && BigInt(direct.outAmount || '0') > 0n) return direct;
      const solRoute = await quote(WSOL_MINT);
      const priceResponse = await jupiterRequest(`https://api.jup.ag/price/v3?ids=${WSOL_MINT}`, { headers }, { operation: 'SOL fallback price', requestTimeoutMs: 8_000 });
      const pricePayload = await priceResponse.json() as Record<string, { usdPrice?: number }>;
      const solUsdMicros = BigInt(Math.floor(Number(pricePayload[WSOL_MINT]?.usdPrice || 0) * 1_000_000));
      if (solUsdMicros <= 0n) throw new MintQuoteError('The SOL/USD fallback price is unavailable.', 503);
      return {
        ...solRoute,
        inputMint: String(mint),
        outputMint: USDC_MINT,
        outAmount: (BigInt(solRoute.outAmount) * solUsdMicros / 1_000_000_000n).toString(),
      };
    },
  };
}
