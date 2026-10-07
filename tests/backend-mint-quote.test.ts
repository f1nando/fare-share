import assert from 'node:assert/strict';
import test from 'node:test';
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { ceilDiv, createMintQuoteService, mintDataIsExactTransferCompatible, MintQuoteError, type MintMarketProvider } from '../server/mintQuoteService.js';
import { buildMintQuoteMessage, parseBackendSigner } from '../server/signing.js';

const PROGRAM = address('GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4');
const OWNER = address('2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF');
const ASSET = address('5DwDHVk2ciBi4J9rLAxEpoqea26WJpwd9Xbu31N5nroP');
const FARE = address('4fg5Nh2wjVddSfDPW1AATQ9Tvmdc1Np1pBQQGL4Mpump');
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const publicBytes = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex');
const secret = JSON.stringify([...seed, ...publicBytes]);
const signer = parseBackendSigner(secret);

function state(overrides: Record<string, unknown> = {}) {
  return {
    configuration: {
      saleStarted: true,
      pausedAt: 0n,
      fareMint: FARE,
      backendSigner: signer.publicKey,
      deploymentId: new Uint8Array(32).fill(9),
      mintedByClass: [0, 0, 0, 0],
      mintPrices: [2500n, 2500n, 2500n, 2500n],
      mintAssignmentRoot: new Uint8Array(12).fill(7),
      ...overrides,
    },
    decimals: 6,
    tokenProgram: TOKEN_PROGRAM,
    mintData: new Uint8Array(82),
    chainTime: 1_000n,
  } as any;
}

function market(overrides: Partial<MintMarketProvider> = {}): MintMarketProvider {
  return {
    referenceUsd: async () => ({ usdPrice: 0.005, observedAtMs: 1_000_000 }),
    sellToUsdc: async (_mint, amount) => ({
      inputMint: String(FARE),
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      inAmount: amount.toString(),
      outAmount: (amount / 200n).toString(),
      priceImpactPct: '0.2',
      routePlan: [{}],
    }),
    ...overrides,
  };
}

const config = {
  programId: PROGRAM,
  signerSecret: secret,
  mintQuoteTtlSeconds: 45,
  mintQuoteMarketMaxAgeMs: 15_000,
  mintQuoteMaxPriceImpactPct: 3,
  mintQuoteMaxPriceDivergencePct: 10,
} as any;
const assignment = async (index: number) => ({ assignmentIndex: index, classIndex: 0, variantIndex: 2, proof: Array(11).fill('00'.repeat(12)) });

test('USD cents convert to raw FARE with upward rounding and a signed bound payload', async () => {
  const issue = createMintQuoteService(config, { market: market(), now: () => 1_000_000, loadState: async () => state(), loadAssignment: assignment });
  const quote = await issue({ owner: OWNER, asset: ASSET });
  assert.equal(quote.priceUsdCents, '2500');
  assert.equal(quote.amountFareRaw, '5000000000');
  assert.equal(quote.expiresAt, '1045');
  const expected = buildMintQuoteMessage(PROGRAM, new Uint8Array(32).fill(9), {
    owner: OWNER, asset: ASSET, assignmentIndex: 0, classIndex: 0, variantIndex: 2, fareMint: FARE,
    amountFareRaw: 5_000_000_000n, priceUsdCents: 2_500n, expiresAt: 1_045n,
  });
  assert.deepEqual(Buffer.from(quote.message, 'base64'), Buffer.from(expected));
  assert.equal(Buffer.from(quote.signature, 'base64').length, 64);
  assert.equal(ceilDiv(10n, 3n), 4n);
});

test('stale market data is rejected', async () => {
  const stale = market({ referenceUsd: async () => ({ usdPrice: 0.005, observedAtMs: 900_000 }) });
  const issue = createMintQuoteService(config, { market: stale, now: () => 1_000_000, loadState: async () => state(), loadAssignment: assignment });
  await assert.rejects(issue({ owner: OWNER, asset: ASSET }), (error: unknown) => error instanceof MintQuoteError && /stale/.test(error.message));
});

test('owner-only quotes bind the canonical PDA and the current assignment', async () => {
  const issue = createMintQuoteService(config, { market: market(), now: () => 1_000_000,
    loadState: async () => state({ mintedByClass: [1, 1, 0, 0] }), loadAssignment: assignment });
  const quote = await issue({ owner: OWNER });
  const [asset] = await getProgramDerivedAddress({ programAddress: PROGRAM,
    seeds: [new TextEncoder().encode('paid-asset'), getAddressEncoder().encode(OWNER), Uint8Array.of(2, 0)] });
  assert.equal(quote.asset, asset);
  assert.equal(quote.assignmentIndex, 2);
  assert.deepEqual(Buffer.from(quote.message, 'base64'), Buffer.from(buildMintQuoteMessage(
    PROGRAM, new Uint8Array(32).fill(9), {
      owner: OWNER, asset, assignmentIndex: 2, classIndex: 0, variantIndex: 2, fareMint: FARE,
      amountFareRaw: 5_000_000_000n, priceUsdCents: 2_500n, expiresAt: 1_045n,
    },
  )));
  await assert.rejects(issue({ owner: OWNER, asset: '' }), /Invalid asset address/);
});

test('low-priced tokens retain enough precision for a safe quote', async () => {
  const usdPrice = 0.0000034407902217414195;
  const lowPriceMarket = market({
    referenceUsd: async () => ({ usdPrice, observedAtMs: 1_000_000 }),
    sellToUsdc: async (_mint, amount) => ({
      inputMint: String(FARE),
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      inAmount: amount.toString(),
      outAmount: (amount * 3_440_790n / 1_000_000_000_000n).toString(),
      priceImpactPct: '0.1',
      routePlan: [{}],
    }),
  });
  const issue = createMintQuoteService(config, { market: lowPriceMarket, now: () => 1_000_000, loadState: async () => state(), loadAssignment: assignment });
  const quote = await issue({ owner: OWNER, asset: ASSET });
  assert.equal(quote.priceUsdCents, '2500');
  assert.ok(BigInt(quote.quotedUsdcRaw) >= 25_000_000n);
});

test('curved liquidity converges to the full mint price', async () => {
  const reserve = 60_000_000_000n;
  let calls = 0;
  const curvedMarket = market({
    sellToUsdc: async (_mint, amount) => {
      calls += 1;
      return {
        inputMint: String(FARE),
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: amount.toString(),
        outAmount: (amount * reserve / (200n * (reserve + amount))).toString(),
        priceImpactPct: '2.9',
        routePlan: [{}],
      };
    },
  });
  const issue = createMintQuoteService(config, { market: curvedMarket, now: () => 1_000_000, loadState: async () => state(), loadAssignment: assignment });
  const quote = await issue({ owner: OWNER, asset: ASSET });
  assert.ok(calls > 4);
  assert.ok(BigInt(quote.quotedUsdcRaw) >= 25_000_000n);
});

test('missing liquidity and excessive price impact are rejected', async () => {
  const empty = market({ sellToUsdc: async (_mint, amount) => ({ inAmount: amount.toString(), outAmount: '0', routePlan: [] }) });
  await assert.rejects(createMintQuoteService(config, { market: empty, now: () => 1_000_000, loadState: async () => state(), loadAssignment: assignment })({ owner: OWNER, asset: ASSET }), /liquid/);
  const impact = market({ sellToUsdc: async (_mint, amount) => ({ inAmount: amount.toString(), outAmount: (amount / 200n).toString(), priceImpactPct: '4', routePlan: [{}] }) });
  await assert.rejects(createMintQuoteService(config, { market: impact, now: () => 1_000_000, loadState: async () => state(), loadAssignment: assignment })({ owner: OWNER, asset: ASSET }), /price impact/);
});

test('a route for another CA is rejected', async () => {
  const mismatch = market({ sellToUsdc: async (_mint, amount) => ({ inputMint: String(OWNER), inAmount: amount.toString(), outAmount: (amount / 200n).toString(), routePlan: [{}] }) });
  await assert.rejects(createMintQuoteService(config, { market: mismatch, now: () => 1_000_000, loadState: async () => state(), loadAssignment: assignment })({ owner: OWNER, asset: ASSET }), /liquid/);
});

test('only inert Pump metadata extensions are accepted for Token-2022 quotes', () => {
  const token2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  const mintBytes = Uint8Array.from(getAddressEncoder().encode(FARE));
  const data = new Uint8Array(166 + 4 + 64 + 4 + 64);
  data[165] = 1;
  let offset = 166;
  data.set([18, 0, 64, 0], offset);
  data.set(mintBytes, offset + 36);
  offset += 68;
  data.set([19, 0, 64, 0], offset);
  data.set(mintBytes, offset + 36);
  assert.equal(mintDataIsExactTransferCompatible(token2022, FARE, data), true);
  data[166] = 1;
  assert.equal(mintDataIsExactTransferCompatible(token2022, FARE, data), false);
});

test('paused, sold-out, and wrong Economy price states are rejected', async () => {
  for (const configuration of [
    { pausedAt: 1n },
    { mintedByClass: [833, 278, 83, 28] },
    { mintPrices: [2499n, 2500n, 2500n, 2500n] },
  ]) {
    const issue = createMintQuoteService(config, { market: market(), now: () => 1_000_000, loadState: async () => state(configuration), loadAssignment: assignment });
    await assert.rejects(issue({ owner: OWNER, asset: ASSET }));
  }
});
