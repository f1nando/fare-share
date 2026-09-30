import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';

import {
  PROGRAM_ID,
  calculateDurabilityPercent,
  calculateRepairQuote,
  calculateProtocolTime,
  calculateTraineeReward,
  disconnectWallet,
  formatTokenAmount,
  formatSolAmount,
  loadDASAssets,
  loadMultipleAccounts,
  MAX_CLAIM_MACHINES_PER_TRANSACTION,
  MAX_REPAIR_MACHINES_PER_TRANSACTION,
  networkName,
  protocolAddresses,
  resolveSolanaChain,
  selectActiveMultiplier,
  shortAddress,
} from '../src/protocol/solana.js';
import {
  buildActivateTraineeInstructions,
  buildMintMachine,
  buildClaimAllInstructions,
  buildClaimInstructions,
  claimLookupTableAddresses,
  buildRepairAllInstructions,
  buildRepairInstructions,
  buildTransferCoreAssetInstruction,
  buildClaimTraineeInstructions,
  chooseEventPage,
  decodeConfiguration,
  decodeEventQueue,
  MAX_CLAIM_MACHINES_PER_TRANSACTION as MAX_CLAIM_MACHINES_ONCHAIN,
  TAXI_DISCRIMINATORS,
  sendWalletInstructions,
  waitForFinalizedSignature,
} from '../src/protocol/anchorClient.js';

const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

test('protocol PDAs are deterministic and distinct', async () => {
  const first = await protocolAddresses();
  const second = await protocolAddresses();

  assert.deepEqual(first, second);
  assert.equal(new Set(Object.values(first)).size, Object.keys(first).length);
  assert.notEqual(String(first.config), String(PROGRAM_ID));
});

test('mint routing chooses a page with room for both machine events', () => {
  const queue = { pages: [{ index: 0, count: 127 }, { index: 1, count: 126 }] };
  assert.equal(chooseEventPage(queue, 2), 1);
  assert.deepEqual([...TAXI_DISCRIMINATORS.mintMachine], [163, 170, 168, 54, 183, 79, 113, 45]);
});

test('event queue decoder reads the bounded on-chain vector layout', () => {
  const bytes = new Uint8Array(1_461);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 80, true);
  view.setUint16(12, 7, true);
  view.setBigInt64(14, 123n, true);
  view.setBigUint64(22, 9n, true);
  view.setBigUint64(12 + 80 * 18, 42n, true);
  const queue = decodeEventQueue(bytes);
  assert.deepEqual(queue.pages[0], { index: 0, count: 7, minTimestamp: 123n, minEventNumber: 9n });
  assert.equal(queue.nextEventNumber, 42n);
});

test('every wallet instruction uses the current Anchor discriminator', () => {
  const names = {
    mintMachine: 'mint_machine',
    claim: 'claim',
    claimMany: 'claim_many',
    repair: 'repair',
    activateTrainee: 'activate_trainee',
    claimTrainee: 'claim_trainee',
  };
  for (const [key, name] of Object.entries(names)) {
    const expected = createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
    assert.deepEqual(Buffer.from(TAXI_DISCRIMINATORS[key]), expected, key);
  }
});

test('wallet addresses are shortened for the primitive UI', () => {
  assert.equal(shortAddress('GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4'), 'GHGq…i3i4');
  assert.equal(shortAddress('short'), 'short');
});

test('wallet disconnect uses the Wallet Standard feature', async () => {
  let calls = 0;
  await disconnectWallet({
    wallet: {
      features: {
        'standard:disconnect': { disconnect: async () => { calls += 1; } },
      },
    },
  });
  assert.equal(calls, 1);
  await assert.rejects(() => disconnectWallet({ wallet: { features: {} } }), /does not support/);
});

test('wallet chain is explicit for private RPC URLs', () => {
  assert.equal(resolveSolanaChain('solana:devnet', 'https://private-rpc.example'), 'solana:devnet');
  assert.equal(resolveSolanaChain('solana:mainnet', 'https://api.devnet.solana.com'), 'solana:mainnet');
  assert.throws(() => resolveSolanaChain('devnet', 'https://rpc.example'), /VITE_SOLANA_CHAIN/);
});

test('network label follows the explicitly configured wallet chain', () => {
  assert.equal(networkName(), 'devnet');
});

test('repair quote charges 25% of earned FARE for any non-zero wear', () => {
  assert.equal(calculateRepairQuote(20_000_000n, 0n, 4 * 24 * 60 * 60), 5_000_000n);
  assert.equal(calculateRepairQuote(18_000_000n, 2_000_000n, 0), 5_000_000n);
  assert.equal(calculateRepairQuote(20_000_000n, 0n, 5 * 24 * 60 * 60), 0n);
  assert.equal(calculateRepairQuote(1n, 0n, 5 * 24 * 60 * 60 - 1), 1n);
});

test('durability uses finalized Solana time and freezes during pause', () => {
  assert.equal(calculateProtocolTime({ pausedAt: 0n, totalPausedSeconds: 50n }, 1050), 1000n);
  assert.equal(calculateProtocolTime({ pausedAt: 900n, totalPausedSeconds: 50n }, 5000), 850n);
  assert.equal(calculateDurabilityPercent(5 * 24 * 60 * 60), 100);
  assert.equal(calculateDurabilityPercent(5 * 24 * 60 * 60 - 1), 99.9);
  assert.equal(calculateDurabilityPercent(4 * 24 * 60 * 60 + 6 * 60 * 60), 85);
});

test('mint instruction accepts only class and queue page, never a client-selected variant', async () => {
  const signers = await Promise.all(Array.from({ length: 5 }, () => generateKeyPairSigner()));
  const [owner, configAddress, queue, fareMint, teamAccount] = signers.map(signer => signer.address);
  const assetSigner = await generateKeyPairSigner();
  const quote = {
    owner, asset: assetSigner.address, fareMint, classIndex: 2,
    amountFareRaw: '123456', priceUsdCents: '30000', expiresAt: '2000000000',
    backendSigner: teamAccount,
    signature: Buffer.alloc(64, 7).toString('base64'),
    message: Buffer.alloc(203, 9).toString('base64'),
  };
  const collection = address('11111111111111111111111111111111');
  const result = await buildMintMachine({
    programAddress: PROGRAM_ID,
    owner,
    configAddress,
    config: { collection, teamAccount, fareMint },
    queue,
    classIndex: 2,
    pageIndex: 7,
    fareTokenProgram: TOKEN_PROGRAM,
    assetSigner,
    quote,
  });
  assert.deepEqual([...result.instruction.data.slice(0, 10)], [...TAXI_DISCRIMINATORS.mintMachine, 2, 7]);
  assert.equal(result.instructions.length, 3);
  assert.equal(String(result.instructions.at(-2).programAddress), 'Ed25519SigVerify111111111111111111111111111');
  assert.equal(result.instructions.at(-1), result.instruction);
  assert.equal(result.instruction.accounts.length, 14);
  const [expectedOwnerFare] = await findAssociatedTokenPda({ owner, mint: fareMint, tokenProgram: TOKEN_PROGRAM });
  const [expectedTeamFare] = await findAssociatedTokenPda({ owner: teamAccount, mint: fareMint, tokenProgram: TOKEN_PROGRAM });
  assert.equal(String(result.instruction.accounts[7].address), String(fareMint));
  assert.equal(String(result.instruction.accounts[8].address), String(expectedOwnerFare));
  assert.equal(String(result.instruction.accounts[9].address), String(expectedTeamFare));
  assert.equal(String(result.instruction.accounts[10].address), String(TOKEN_PROGRAM));
  assert.equal(result.instruction.accounts[8].role, AccountRole.WRITABLE);
  assert.equal(result.instruction.accounts[9].role, AccountRole.WRITABLE);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    transaction => setTransactionMessageFeePayer(owner, transaction),
    transaction => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 1n,
    }, transaction),
    transaction => appendTransactionMessageInstructions(result.instructions, transaction),
  );
  const transactionBytes = getTransactionEncoder().encode(compileTransaction(message));
  assert.ok(transactionBytes.length <= 1232, `mint transaction is ${transactionBytes.length} bytes`);

  const existingTeamAta = await buildMintMachine({
    programAddress: PROGRAM_ID,
    owner,
    configAddress,
    config: { collection, teamAccount, fareMint },
    queue,
    classIndex: 2,
    pageIndex: 7,
    fareTokenProgram: TOKEN_PROGRAM,
    teamFareAccountExists: true,
    assetSigner,
    quote,
  });
  assert.equal(existingTeamAta.instructions.length, 2);
});

test('configuration decoder reads all 16 metadata URIs in class and variant order', () => {
  const strings = Array.from({ length: 16 }, (_, index) => `uri-${index}`);
  const stringBytes = strings.map(value => {
    const bytes = Buffer.from(value);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    return Buffer.concat([length, bytes]);
  });
  const bytes = Buffer.concat([
    Buffer.alloc(8),
    Buffer.alloc(32 * 5),
    Buffer.alloc(32),
    Buffer.alloc(8 + 8 * 4),
    Buffer.alloc(32 + 32 + 32 * 4),
    ...stringBytes,
    Buffer.alloc(8 * 4),
    Buffer.alloc(2 * 4),
    Buffer.alloc(1 + 8 + 8 + 1),
  ]);
  assert.deepEqual(decodeConfiguration(bytes).metadataUris, strings);
});

test('trainee reward uses processed start/end bucket boundaries', () => {
  const trainee = {
    activeFrom: 60n,
    activeUntil: 3600n,
    checkpointInitialized: false,
    checkpoint: 0n,
  };
  const start = { processed: true, accumulator: 3n * 1_000_000_000_000_000_000n };
  const end = { processed: true, accumulator: 8n * 1_000_000_000_000_000_000n };
  const activePool = { effectiveCalculatedUntil: 120n, accumulators: [5n * 1_000_000_000_000_000_000n] };
  assert.equal(calculateTraineeReward(trainee, activePool, start, end), 2n);
  assert.equal(calculateTraineeReward(trainee, { ...activePool, effectiveCalculatedUntil: 4000n }, start, end), 5n);
  assert.equal(calculateTraineeReward(trainee, { ...activePool, effectiveCalculatedUntil: 4000n }, start, null), 0n);
});

test('stock display activates the scheduled xStocks multiplier without changing raw accounting', () => {
  const update = { currentMultiplier: 1.01, newMultiplier: 1.02, activationDateTime: 200 };
  assert.equal(selectActiveMultiplier(update, 199), 1.01);
  assert.equal(selectActiveMultiplier(update, 200), 1.02);
  assert.equal(formatTokenAmount(100_000_000n, 8, 1.02).replace(',', '.'), '1.02');
});

test('SOL fees and token estimates use their own decimals', () => {
  assert.equal(formatSolAmount(49_000_000n), '0.049');
  assert.equal(formatSolAmount(1_000_000_001n), '1.000000001');
  assert.equal(formatTokenAmount(3_500_000n, 6).replace(',', '.'), '3.5');
});

test('DAS garage loads every page when a wallet owns more than one thousand assets', async () => {
  const owner = '11111111111111111111111111111111';
  const collection = 'collection';
  const calls = [];
  const fetchImplementation = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request.params.page);
    const count = request.params.page === 1 ? 1000 : 1;
    return {
      ok: true,
      json: async () => ({
        result: {
          items: Array.from({ length: count }, (_, index) => ({
            id: `${request.params.page}-${index}`,
            grouping: [{ group_key: 'collection', group_value: collection }],
          })),
        },
      }),
    };
  };

  const assets = await loadDASAssets(owner, collection, fetchImplementation);
  assert.equal(assets.length, 1001);
  assert.deepEqual(calls, [1, 2]);
});

test('machine accounts are loaded in Solana RPC batches of at most one hundred', async () => {
  const accountAddresses = Array.from({ length: 205 }, (_, index) => `account-${index}`);
  const batches = [];
  const rpcClient = {
    getMultipleAccounts(batch) {
      batches.push(batch);
      return { send: async () => ({ value: batch.map(value => ({ value })) }) };
    },
  };

  const accounts = await loadMultipleAccounts(accountAddresses, rpcClient);
  assert.deepEqual(batches.map(batch => batch.length), [100, 100, 5]);
  assert.deepEqual(accounts.map(account => account.value), accountAddresses);
});

test('trainee activation puts Ed25519 verification immediately before the program instruction', async () => {
  const programAddress = PROGRAM_ID;
  const owner = '11111111111111111111111111111111';
  const instructions = await buildActivateTraineeInstructions({
    programAddress,
    owner,
    configAddress: (await protocolAddresses()).config,
    traineeQueue: (await protocolAddresses()).traineeQueue,
    voucher: {
      backendSigner: owner,
      signature: Buffer.alloc(64, 7).toString('base64'),
      message: Buffer.from('signed voucher').toString('base64'),
      args: {
        campaignId: '12', nonce: '34', durationMinutes: 360,
        expiresAt: '1000', activeFrom: '1020', activeUntil: '22620', pageIndex: 2,
      },
    },
  });
  assert.equal(instructions.length, 2);
  assert.equal(String(instructions[0].programAddress), 'Ed25519SigVerify111111111111111111111111111');
  assert.deepEqual([...instructions[1].data.slice(0, 8)], [...TAXI_DISCRIMINATORS.activateTrainee]);
  assert.equal(instructions[1].accounts.length, 9);
});

test('claim transaction size is measured with five missing destination accounts', async () => {
  const signers = await Promise.all(Array.from({ length: 10 }, () => generateKeyPairSigner()));
  const [owner, config, pool, machine, asset, ...mints] = signers.map(signer => signer.address);
  const instructions = await buildClaimInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress: config,
    pool,
    machine,
    asset,
    mints,
    tokenPrograms: [TOKEN_PROGRAM, ...Array(4).fill(TOKEN_2022_PROGRAM)],
    amounts: Array(5).fill(1n),
  });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    transaction => setTransactionMessageFeePayer(owner, transaction),
    transaction => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 1n,
    }, transaction),
    transaction => appendTransactionMessageInstructions(instructions, transaction),
  );
  const bytes = getTransactionEncoder().encode(compileTransaction(message));
  assert.ok(bytes.length <= 1100, `claim transaction is ${bytes.length} bytes`);
});

test('claim creates destination token accounts only for non-zero rewards', async () => {
  const signers = await Promise.all(Array.from({ length: 10 }, () => generateKeyPairSigner()));
  const [owner, config, pool, machine, asset, ...mints] = signers.map(signer => signer.address);
  const instructions = await buildClaimInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress: config,
    pool,
    machine,
    asset,
    mints,
    tokenPrograms: [TOKEN_PROGRAM, ...Array(4).fill(TOKEN_2022_PROGRAM)],
    amounts: [5n, 0n, 0n, 7n, 0n],
  });

  assert.equal(instructions.length, 3, 'two ATA creates plus one claim instruction');
  const claim = instructions.at(-1);
  for (const index of [1, 2, 4]) {
    const vault = claim.accounts[6 + index * 4];
    const destination = claim.accounts[7 + index * 4];
    assert.equal(destination.address, vault.address, `zero reward ${index} should reuse its vault placeholder`);
  }
});

test('claim skips redundant token account creation when destinations already exist', async () => {
  const signers = await Promise.all(Array.from({ length: 10 }, () => generateKeyPairSigner()));
  const [owner, config, pool, machine, asset, ...mints] = signers.map(signer => signer.address);
  const instructions = await buildClaimInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress: config,
    pool,
    machine,
    asset,
    mints,
    tokenPrograms: Array(5).fill(TOKEN_PROGRAM),
    amounts: Array(5).fill(1n),
    destinationAccountsExist: Array(5).fill(true),
  });

  assert.equal(instructions.length, 1);
  assert.deepEqual([...instructions[0].data], [...TAXI_DISCRIMINATORS.claim]);
});

test('claim batch aggregates transfers and fits four cars without a lookup table', async () => {
  const signers = await Promise.all(Array.from({ length: 16 }, () => generateKeyPairSigner()));
  const [owner, config, pool, ...rest] = signers.map(signer => signer.address);
  const mints = rest.slice(0, 5);
  const [machineA, assetA, machineB, assetB, machineC, assetC, machineD, assetD] = rest.slice(5);
  const instructions = await buildClaimAllInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress: config,
    pool,
    mints,
    tokenPrograms: Array(5).fill(TOKEN_PROGRAM),
    machines: [
      { machineAddress: machineA, asset: assetA, rewards: Array(5).fill(1n) },
      { machineAddress: machineB, asset: assetB, rewards: Array(5).fill(1n) },
      { machineAddress: machineC, asset: assetC, rewards: Array(5).fill(1n) },
      { machineAddress: machineD, asset: assetD, rewards: Array(5).fill(1n) },
    ],
  });
  assert.equal(MAX_CLAIM_MACHINES_PER_TRANSACTION, 4);
  assert.equal(MAX_CLAIM_MACHINES_ONCHAIN, 10);
  assert.equal(instructions.length, 6, 'five ATA creates plus one aggregated claim');
  assert.deepEqual([...instructions.at(-1).data.slice(0, 8)], [...TAXI_DISCRIMINATORS.claimMany]);
  assert.equal(instructions.at(-1).data[8], 4);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    transaction => setTransactionMessageFeePayer(owner, transaction),
    transaction => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 1n,
    }, transaction),
    transaction => appendTransactionMessageInstructions(instructions, transaction),
  );
  const bytes = getTransactionEncoder().encode(compileTransaction(message));
  assert.ok(bytes.length <= 1232, `four-car claim transaction is ${bytes.length} bytes`);
  await assert.rejects(() => buildClaimAllInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress: config,
    pool,
    mints,
    tokenPrograms: Array(5).fill(TOKEN_PROGRAM),
    machines: Array(11).fill({ machineAddress: machineA, asset: assetA, rewards: Array(5).fill(1n) }),
  }), /at most 10 cars/);
  await assert.rejects(() => buildClaimAllInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress: config,
    pool,
    mints,
    tokenPrograms: Array(5).fill(TOKEN_PROGRAM),
    machines: Array(2).fill({ machineAddress: machineA, asset: assetA, rewards: Array(5).fill(1n) }),
  }), /only once/);
});

test('claim batch fits ten cars with the configured protocol lookup table', async () => {
  const signers = await Promise.all(Array.from({ length: 29 }, () => generateKeyPairSigner()));
  const [owner, config, pool, lookupTable, ...rest] = signers.map(signer => signer.address);
  const mints = rest.slice(0, 5);
  const machineAccounts = rest.slice(5);
  const tokenPrograms = [TOKEN_PROGRAM, ...Array(4).fill(TOKEN_2022_PROGRAM)];
  const machines = Array.from({ length: 10 }, (_, index) => ({
    machineAddress: machineAccounts[index * 2],
    asset: machineAccounts[index * 2 + 1],
    rewards: Array(5).fill(1n),
  }));
  const instructions = await buildClaimAllInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress: config,
    pool,
    mints,
    tokenPrograms,
    machines,
  });
  const lookupAddresses = await claimLookupTableAddresses({
    programAddress: PROGRAM_ID,
    configAddress: config,
    pool,
    mints,
    tokenPrograms,
  });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    transaction => setTransactionMessageFeePayer(owner, transaction),
    transaction => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 1n,
    }, transaction),
    transaction => appendTransactionMessageInstructions(instructions, transaction),
    transaction => compressTransactionMessageUsingAddressLookupTables(transaction, {
      [lookupTable]: lookupAddresses,
    }),
  );
  const bytes = getTransactionEncoder().encode(compileTransaction(message));
  assert.ok(bytes.length <= 1232, `ten-car lookup-table claim is ${bytes.length} bytes`);
});

test('Core transfer keeps the asset account and changes only its owner', async () => {
  const signers = await Promise.all(Array.from({ length: 4 }, () => generateKeyPairSigner()));
  const [owner, asset, collection, newOwner] = signers.map(signer => signer.address);
  const instruction = buildTransferCoreAssetInstruction({ owner, asset, collection, newOwner });

  assert.equal(String(instruction.programAddress), 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
  assert.deepEqual([...instruction.data], [14, 0]);
  assert.equal(String(instruction.accounts[0].address), String(asset));
  assert.equal(String(instruction.accounts[1].address), String(collection));
  assert.equal(String(instruction.accounts[2].address), String(owner));
  assert.equal(String(instruction.accounts[4].address), String(newOwner));
});

test('free repair does not create a FARE token account while paid repair can create it', async () => {
  const signers = await Promise.all(Array.from({ length: 7 }, () => generateKeyPairSigner()));
  const [owner, configAddress, pool, queue, machine, asset, fareMint] = signers.map(signer => signer.address);
  const input = {
    programAddress: PROGRAM_ID,
    owner,
    configAddress,
    config: { fareMint },
    pool,
    queue,
    machine,
    asset,
    fareTokenProgram: TOKEN_PROGRAM,
    pageIndex: 0,
  };
  assert.equal((await buildRepairInstructions({ ...input, repairCost: 0n })).length, 1);
  assert.equal((await buildRepairInstructions({ ...input, repairCost: 1n })).length, 2);
});

test('repair batch creates the owner FARE account once and fits eight cars', async () => {
  const signers = await Promise.all(Array.from({ length: 21 }, () => generateKeyPairSigner()));
  const [owner, configAddress, pool, queue, fareMint, ...machineAccounts] = signers.map(signer => signer.address);
  const machines = Array.from({ length: MAX_REPAIR_MACHINES_PER_TRANSACTION }, (_, index) => ({
    machineAddress: machineAccounts[index * 2],
    asset: machineAccounts[index * 2 + 1],
    repairCost: BigInt(index + 1),
  }));
  const instructions = await buildRepairAllInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress,
    config: { fareMint },
    pool,
    queue,
    fareTokenProgram: TOKEN_PROGRAM,
    pageIndex: 0,
    machines,
  });
  assert.equal(instructions.length, 9, 'one ATA create plus eight repairs');
  assert.equal(instructions.filter(instruction => (
    Buffer.from(instruction.data || []).subarray(0, 8).equals(Buffer.from(TAXI_DISCRIMINATORS.repair))
  )).length, 8);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    transaction => setTransactionMessageFeePayer(owner, transaction),
    transaction => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 1n,
    }, transaction),
    transaction => appendTransactionMessageInstructions(instructions, transaction),
  );
  const bytes = getTransactionEncoder().encode(compileTransaction(message));
  assert.ok(bytes.length <= 1232, `eight-car repair transaction is ${bytes.length} bytes`);
  await assert.rejects(() => buildRepairAllInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress,
    config: { fareMint },
    pool,
    queue,
    fareTokenProgram: TOKEN_PROGRAM,
    pageIndex: 0,
    machines: [...machines, machines[0]],
  }), /at most 8 cars/);
});

test('trainee claim creates a FARE token account only for a positive reward', async () => {
  const signers = await Promise.all(Array.from({ length: 5 }, () => generateKeyPairSigner()));
  const [owner, configAddress, traineePool, traineeAddress, fareMint] = signers.map(signer => signer.address);
  const input = {
    programAddress: PROGRAM_ID,
    owner,
    configAddress,
    traineePool,
    trainee: { address: traineeAddress, campaignId: 1n, activeFrom: 60n, activeUntil: 3600n },
    fareMint,
    tokenProgram: TOKEN_PROGRAM,
  };
  assert.equal((await buildClaimTraineeInstructions({ ...input, amount: 0n })).length, 1);
  assert.equal((await buildClaimTraineeInstructions({ ...input, amount: 1n })).length, 2);
});

test('wallet transaction waits until Solana reports finalized', async () => {
  const states = [null, { confirmationStatus: 'confirmed', err: null }, { confirmationStatus: 'finalized', err: null }];
  let calls = 0;
  const rpc = {
    getSignatureStatuses() {
      const status = states[calls++];
      return { send: async () => ({ value: [status] }) };
    },
  };
  await waitForFinalizedSignature(rpc, 'signature', { timeoutMs: 1000, pollMs: 0, sleep: async () => {} });
  assert.equal(calls, 3);
});

test('wallet transaction surfaces an on-chain failure before showing success', async () => {
  const rpc = {
    getSignatureStatuses() {
      return { send: async () => ({ value: [{ confirmationStatus: 'finalized', err: { InstructionError: [0, 'Custom'] } }] }) };
    },
  };
  const error = await waitForFinalizedSignature(
    rpc,
    'signature',
    { timeoutMs: 1000, pollMs: 0, sleep: async () => {} },
  ).catch(value => value);
  assert.match(error.message, /Solana transaction failed/);
  assert.equal(error.signature, 'signature');
});

test('wallet transaction timeout keeps its signature for Explorer verification', async () => {
  const rpc = {
    getSignatureStatuses() {
      return { send: async () => ({ value: [null] }) };
    },
  };
  const error = await waitForFinalizedSignature(
    rpc,
    'pending-signature',
    { timeoutMs: -1, pollMs: 0, sleep: async () => {} },
  ).catch(value => value);
  assert.match(error.message, /Explorer before retrying/);
  assert.equal(error.signature, 'pending-signature');
});

test('multi-signer mint lets the wallet sign before adding the asset signature', async () => {
  const owner = await generateKeyPairSigner();
  const asset = await generateKeyPairSigner();
  const blockhash = await generateKeyPairSigner();
  const signature = '1'.repeat(64);
  let sentTransaction;
  let signAndSendCalled = false;
  const rpc = {
    getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: String(blockhash.address), lastValidBlockHeight: 999n } }) }),
    sendTransaction: wire => ({
      send: async () => {
        sentTransaction = getTransactionDecoder().decode(Buffer.from(wire, 'base64'));
        return signature;
      },
    }),
    getSignatureStatuses: () => ({ send: async () => ({ value: [{ confirmationStatus: 'finalized', err: null }] }) }),
  };
  const wallet = { features: {
    'solana:signTransaction': {
      signTransaction: async ({ transaction }) => {
        const decoded = getTransactionDecoder().decode(transaction);
        const signed = await partiallySignTransaction([owner.keyPair], decoded);
        return [{ signedTransaction: getTransactionEncoder().encode(signed) }];
      },
    },
    'solana:signAndSendTransaction': {
      signAndSendTransaction: async () => {
        signAndSendCalled = true;
        throw new Error('Unexpected sign-and-send call');
      },
    },
  } };
  const result = await sendWalletInstructions({
    rpc,
    wallet,
    account: { address: owner.address },
    chain: 'solana:mainnet',
    instructions: [{
      programAddress: PROGRAM_ID,
      accounts: [
        { address: owner.address, role: AccountRole.WRITABLE_SIGNER },
        { address: asset.address, role: AccountRole.WRITABLE_SIGNER },
      ],
      data: new Uint8Array(),
    }],
    additionalSigners: [asset],
  });
  assert.equal(result, signature);
  assert.equal(signAndSendCalled, false);
  assert.ok(sentTransaction.signatures[owner.address]);
  assert.ok(sentTransaction.signatures[asset.address]);
});
