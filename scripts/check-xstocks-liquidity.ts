const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const XSTOCKS = {
  UBERx: 'XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB',
  TSLAx: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
  GOOGLx: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN',
  AMZNx: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg',
} as const;

const amount = process.env.XSTOCKS_CHECK_LAMPORTS?.trim() || '100000000';
if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
  throw new Error('XSTOCKS_CHECK_LAMPORTS must be a positive integer');
}

let failed = false;
for (const [symbol, outputMint] of Object.entries(XSTOCKS)) {
  const query = new URLSearchParams({
    inputMint: WSOL_MINT,
    outputMint,
    amount,
    slippageBps: '500',
    restrictIntermediateTokens: 'true',
  });
  try {
    const response = await jupiterRequest(`https://lite-api.jup.ag/swap/v1/quote?${query}`, {
      headers: { accept: 'application/json' },
    }, {
      requestTimeoutMs: 15_000,
      operation: '/quote',
    });
    const quote = await response.json() as {
      inAmount?: string;
      outAmount?: string;
      otherAmountThreshold?: string;
      priceImpactPct?: string;
      routePlan?: unknown[];
      error?: string;
    };
    if (quote.error) throw new Error(quote.error);
    if (quote.inAmount !== amount || !quote.outAmount || BigInt(quote.outAmount) <= 0n || !quote.routePlan?.length) {
      throw new Error('empty or malformed route');
    }
    console.log(`${symbol}: route OK, out=${quote.outAmount}, hops=${quote.routePlan.length}, impact=${quote.priceImpactPct || 'n/a'}%`);
  } catch (error) {
    failed = true;
    console.error(`${symbol}: NO ROUTE (${(error as Error).message})`);
  }
}

if (failed) process.exitCode = 1;
import { jupiterRequest } from '../server/jupiterHttp.js';
