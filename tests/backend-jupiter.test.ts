import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import test from 'node:test';
import { AccountRole, address, getAddressEncoder } from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';
import {
  buildEd25519Instruction,
  buildJupiterRoute,
  buildSwapPlanMessage,
  activeJupiterDexExclusions,
  encodeProcessSwapData,
  hashJupiterRoute,
  quarantineJupiterDexes,
  type SwapPlan,
} from '../server/jupiter.js';
import { parseBackendSigner } from '../server/signing.js';

const PROGRAM = address('GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4');
const CONFIG = address('11111111111111111111111111111111');
const SOURCE = address('So11111111111111111111111111111111111111112');
const DESTINATION = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const SECRET = JSON.stringify([
  ...Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'),
  ...Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'),
]);

function response(overrides: Record<string, unknown> = {}) {
  return {
    inputMint: SOURCE,
    outputMint: DESTINATION,
    inAmount: '1000',
    outAmount: '950',
    otherAmountThreshold: '900',
    setupInstructions: [],
    cleanupInstruction: null,
    otherInstructions: [],
    tipInstruction: null,
    swapInstruction: {
      programId: PROGRAM,
      accounts: [
        { pubkey: CONFIG, isSigner: true, isWritable: false },
        { pubkey: SOURCE, isSigner: false, isWritable: true },
        { pubkey: DESTINATION, isSigner: false, isWritable: true },
      ],
      data: Buffer.from([4, 5, 6]).toString('base64'),
    },
    addressesByLookupTableAddress: { [PROGRAM]: [SOURCE, DESTINATION] },
    routePlan: [{ swapInfo: { label: 'TestDex' } }],
    ...overrides,
  };
}

test('Jupiter V2 route is validated and converted for a PDA-signed CPI', async () => {
  let requested = '';
  const route = await buildJupiterRoute({
    apiKey: 'test-key',
    inputMint: SOURCE,
    outputMint: DESTINATION,
    amountIn: 1000n,
    taker: CONFIG,
    payer: PROGRAM,
    destinationTokenAccount: DESTINATION,
    jupiterProgram: PROGRAM,
    slippageBps: 500,
    maxAccounts: 48,
    excludeDexes: 'ConfiguredDex',
    fixedWritableAccounts: new Set([String(CONFIG), String(SOURCE), String(DESTINATION)]),
    fetchImplementation: async (input, init) => {
      requested = String(input);
      assert.equal((init?.headers as Record<string, string>)['x-api-key'], 'test-key');
      return new Response(JSON.stringify(response()), { status: 200 });
    },
  });
  assert.match(requested, /swap\/v2\/build\?/);
  assert.match(requested, /wrapAndUnwrapSol=false/);
  assert.match(requested, /restrictIntermediateTokens=true/);
  assert.match(requested, /slippageBps=500/);
  assert.match(requested, /excludeDexes=ConfiguredDex/);
  assert.equal(route.minOut, 900n);
  assert.deepEqual([...route.routeData], [4, 5, 6]);
  assert.equal(route.routeAccounts[0].role, AccountRole.WRITABLE);
  assert.deepEqual(Object.values(route.lookupTables), [[SOURCE, DESTINATION]]);
  assert.deepEqual(route.dexes, ['TestDex']);
});

test('failed Jupiter dexes are quarantined temporarily and merge with configured exclusions', () => {
  quarantineJupiterDexes(['BrokenDex'], 1_000);
  assert.equal(activeJupiterDexExclusions('ConfiguredDex', 1_001), 'BrokenDex,ConfiguredDex');
  assert.equal(activeJupiterDexExclusions('ConfiguredDex', 301_001), 'ConfiguredDex');
});

test('Jupiter route rejects auxiliary instructions and foreign signers', async () => {
  const base = {
    inputMint: SOURCE,
    outputMint: DESTINATION,
    amountIn: 1000n,
    taker: CONFIG,
    payer: PROGRAM,
    destinationTokenAccount: DESTINATION,
    jupiterProgram: PROGRAM,
    slippageBps: 500,
    maxAccounts: 48,
    fixedWritableAccounts: new Set<string>(),
  };
  await assert.rejects(
    buildJupiterRoute({
      ...base,
      fetchImplementation: async () => new Response(JSON.stringify(response({
        setupInstructions: [{ programId: PROGRAM, accounts: [], data: 'AA==' }],
      }))),
    }),
    /requires setup/,
  );
  await assert.rejects(
    buildJupiterRoute({
      ...base,
      fetchImplementation: async () => new Response(JSON.stringify(response({
        swapInstruction: {
          ...response().swapInstruction,
          accounts: [
            { pubkey: CONFIG, isSigner: true, isWritable: false },
            { pubkey: SOURCE, isSigner: true, isWritable: false },
          ],
        },
      }))),
    }),
    /unsupported signer/,
  );
});

test('Jupiter route permits only idempotent setup for pre-created protocol vaults', async () => {
  const tokenProgram = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const [setupAta] = await findAssociatedTokenPda({ owner: CONFIG, mint: SOURCE, tokenProgram });
  const setupInstruction = {
    programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    accounts: [
      { pubkey: PROGRAM, isSigner: true, isWritable: true },
      { pubkey: setupAta, isSigner: false, isWritable: true },
      { pubkey: CONFIG, isSigner: false, isWritable: false },
      { pubkey: SOURCE, isSigner: false, isWritable: false },
      { pubkey: CONFIG, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]).toString('base64'),
  };
  setupInstruction.accounts[4].pubkey = address('11111111111111111111111111111111');
  const route = await buildJupiterRoute({
    inputMint: SOURCE,
    outputMint: DESTINATION,
    amountIn: 1000n,
    taker: CONFIG,
    payer: PROGRAM,
    destinationTokenAccount: DESTINATION,
    jupiterProgram: PROGRAM,
    slippageBps: 500,
    maxAccounts: 48,
    fixedWritableAccounts: new Set([String(DESTINATION)]),
    fetchImplementation: async () => new Response(JSON.stringify(response({ setupInstructions: [setupInstruction] }))),
  });
  assert.equal(route.minOut, 900n);
  assert.equal(route.setupInstructions.length, 1);

  await assert.rejects(
    buildJupiterRoute({
      inputMint: SOURCE,
      outputMint: DESTINATION,
      amountIn: 1000n,
      taker: CONFIG,
      payer: PROGRAM,
      destinationTokenAccount: DESTINATION,
      jupiterProgram: PROGRAM,
      slippageBps: 500,
      maxAccounts: 48,
      fixedWritableAccounts: new Set([String(DESTINATION)]),
      fetchImplementation: async () => new Response(JSON.stringify(response({
        setupInstructions: [{ ...setupInstruction, data: Buffer.from([0]).toString('base64') }],
      }))),
    }),
    /requires setup/,
  );
});

test('swap plan bytes, route hash, and Ed25519 envelope match the Rust contract', () => {
  const accounts = [
    { address: CONFIG, role: AccountRole.WRITABLE },
    { address: SOURCE, role: AccountRole.READONLY },
  ];
  const routeData = Uint8Array.of(7, 8, 9);
  const routeHash = hashJupiterRoute(routeData, accounts, CONFIG);
  const encoder = getAddressEncoder();
  const expectedHash = createHash('sha256').update(Buffer.concat([
    Buffer.from(routeData),
    Buffer.from(encoder.encode(CONFIG)), Buffer.from([1, 1]),
    Buffer.from(encoder.encode(SOURCE)), Buffer.from([0, 0]),
  ])).digest();
  assert.deepEqual(Buffer.from(routeHash), expectedHash);

  const plan: SwapPlan = {
    kind: 0,
    assetIndex: 0,
    nonce: 11n,
    amountIn: 12n,
    minOut: 13n,
    deadline: 14n,
    routeHash,
  };
  const deployment = Uint8Array.from({ length: 32 }, (_, index) => index);
  const message = buildSwapPlanMessage(PROGRAM, deployment, plan);
  assert.equal(Buffer.from(message.slice(0, 12)).toString(), 'TAXI_SWAP_V1');
  const instructionData = encodeProcessSwapData(Uint8Array.from({ length: 8 }, () => 1), plan, routeData);
  assert.equal(new DataView(instructionData.buffer).getUint32(74, true), 3);
  assert.deepEqual([...instructionData.slice(78)], [7, 8, 9]);

  const signer = parseBackendSigner(SECRET);
  const ed25519 = buildEd25519Instruction(signer, message);
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from((JSON.parse(SECRET) as number[]).slice(32)),
    ]),
    format: 'der', type: 'spki',
  });
  const signature = Buffer.from(ed25519.data!.slice(48, 112));
  assert.equal(verify(null, Buffer.from(message), publicKey, signature), true);
});
