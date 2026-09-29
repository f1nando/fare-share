import { createHash } from 'node:crypto';
import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';
import { loadServerConfig } from './config.js';
import {
  buildEd25519Instruction,
  buildJupiterRoute,
  buildSwapPlanMessage,
  computeUnitLimitInstruction,
  encodeProcessSwapData,
  hashJupiterRoute,
  type SwapPlan,
} from './jupiter.js';
import {
  decodeEventPageState,
  decodeEventQueueState,
  decodeMachineCleanupState,
  decodeMachineRewardState,
  decodeRewardPoolState,
  expiryIsPrunable,
  MACHINE_ACCOUNT_SIZE,
  queueHasReadyEvent,
  selectEventBatch,
  selectWritableQueuePage,
  type EventPageState,
} from './programState.js';
import { parseBackendSigner, parseSecretBytes, type BackendSigner } from './signing.js';
import { decodeWorkerConfiguration, loadProtocolClock } from './solanaState.js';
import { createWorkerSigner, sendInstructions } from './transaction.js';
import { solanaRpcCall } from './solanaRpc.js';

const utf8 = getUtf8Encoder();
const addressEncoder = getAddressEncoder();
const WSOL_MINT = address('So11111111111111111111111111111111111111112');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const MPL_CORE_PROGRAM = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111');
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const ACCUMULATOR_SCALE = 1_000_000_000_000_000_000n;

let lastBurnScanAt = 0;

type QueueKind = 'main' | 'trainee';

export async function runWorkerCycle() {
  const config = loadServerConfig();
  if (!config.workerSecret) throw new Error('Missing required environment variable WORKER_KEYPAIR_SECRET_KEY');
  const signer = await createWorkerSigner(parseSecretBytes(config.workerSecret, 'WORKER_KEYPAIR_SECRET_KEY'));
  const backendSigner = parseBackendSigner(config.signerSecret);
  const addresses = await deriveAddresses(config.programId);
  const clock = await loadProtocolClock(config.solanaRpcUrl, config.programId);
  if (clock.paused) {
    console.log('Taxi protocol is paused; worker cycle skipped.');
    return;
  }
  if (String(backendSigner.publicKey) !== String(clock.backendSigner)) {
    throw new Error('Backend signer key does not match Configuration.backend_signer');
  }
  const configurationAccount = await getAccount(config.solanaRpcUrl, addresses.config);
  const configuration = decodeWorkerConfiguration(configurationAccount.data);
  if (await hasCollectableFees(config.solanaRpcUrl, addresses.feeVault)) {
    const signature = await sendInstructions(config.solanaRpcUrl, signer, [collectFeesInstruction(
      config.programId,
      signer.address,
      addresses,
      configuration.teamAccount,
    )]);
    console.log(`collect_fees finalized: ${signature}`);
  }

  if (String(configuration.fareMint) === '11111111111111111111111111111111') {
    console.log('FARE mint is not configured; swap jobs were skipped.');
  } else if (config.jupiterApiKey) {
    await processPendingSwaps(config, signer, backendSigner, addresses, clock.chainTime);
  } else {
    console.log('JUPITER_API_KEY is not configured; accumulated swap reserves were left untouched.');
  }

  if (Date.now() - lastBurnScanAt >= config.burnScanIntervalMs) {
    await cleanupBurnedMachines(
      config.solanaRpcUrl,
      config.programId,
      signer,
      addresses,
      config.burnCleanupLimit,
    );
    lastBurnScanAt = Date.now();
  }

  await drainRewards(config.solanaRpcUrl, config.programId, signer, addresses, 'main');
  await pruneStaleMainEvents(config.solanaRpcUrl, config.programId, signer, addresses);
  await drainRewards(config.solanaRpcUrl, config.programId, signer, addresses, 'trainee');
}

async function cleanupBurnedMachines(
  rpcUrl: string,
  programId: Address,
  signer: KeyPairSigner,
  addresses: Awaited<ReturnType<typeof deriveAddresses>>,
  limit: number,
) {
  const machines = await listOpenMachines(rpcUrl, programId);
  const assetAccounts = await getOptionalAccountsInChunks(rpcUrl, machines.map(machine => machine.asset));
  const burned = machines.filter((_, index) => isBurnedCoreAssetAccount(assetAccounts[index])).slice(0, limit);

  for (const machine of burned) {
    try {
      const queue = decodeEventQueueState((await getAccount(rpcUrl, addresses.queue)).data);
      const pageIndex = selectWritableQueuePage(queue);
      const instruction = buildCleanupBurnedMachineInstruction({
        programId,
        caller: signer.address,
        config: addresses.config,
        queue: addresses.queue,
        eventPage: await derivePage(programId, 'main', pageIndex),
        machine: machine.address,
        asset: machine.asset,
        pageIndex,
      });
      const signature = await sendInstructions(rpcUrl, signer, [instruction]);
      console.log(`cleanup_burned_machine ${machine.asset} finalized: ${signature}`);
    } catch (error) {
      console.warn(`cleanup_burned_machine ${machine.asset} lost a finalized-state race; retrying next scan`, error);
    }
  }
}

async function listOpenMachines(rpcUrl: string, programId: Address) {
  const result = await rpcCall(rpcUrl, 'getProgramAccounts', [programId, {
    commitment: 'finalized',
    encoding: 'base64',
    filters: [{ dataSize: MACHINE_ACCOUNT_SIZE }],
  }]) as Array<{ pubkey: string; account: { data: [string, string] } }>;
  return result.flatMap(item => {
    const state = decodeMachineCleanupState(Uint8Array.from(Buffer.from(item.account.data[0], 'base64')));
    return state.closed ? [] : [{ address: address(item.pubkey), asset: state.asset }];
  });
}

export function buildCleanupBurnedMachineInstruction(input: {
  programId: Address;
  caller: Address;
  config: Address;
  queue: Address;
  eventPage: Address;
  machine: Address;
  asset: Address;
  pageIndex: number;
}): Instruction {
  return {
    programAddress: input.programId,
    accounts: [
      meta(input.caller, AccountRole.WRITABLE_SIGNER),
      meta(input.config, AccountRole.READONLY),
      meta(input.queue, AccountRole.WRITABLE),
      meta(input.eventPage, AccountRole.WRITABLE),
      meta(input.machine, AccountRole.WRITABLE),
      meta(input.asset, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM, AccountRole.READONLY),
    ],
    data: Buffer.concat([anchorDiscriminator('cleanup_burned_machine'), Buffer.from([input.pageIndex])]),
  };
}

async function processPendingSwaps(
  config: ReturnType<typeof loadServerConfig>,
  caller: KeyPairSigner,
  backendSigner: BackendSigner,
  addresses: Awaited<ReturnType<typeof deriveAddresses>>,
  chainTime: bigint,
) {
  const [configurationAccount, feeAccount] = await getAccounts(config.solanaRpcUrl, [
    addresses.config,
    addresses.feeVault,
  ]);
  const configuration = decodeWorkerConfiguration(configurationAccount.data);
  const reserves = decodeFeeReserves(feeAccount.data);
  const mintAddresses = [WSOL_MINT, configuration.fareMint, ...configuration.stockMints];
  const mintAccounts = await getAccounts(config.solanaRpcUrl, mintAddresses);
  const tokenPrograms = mintAccounts.map(account => account.owner);
  const [wsolVault] = await findAssociatedTokenPda({
    owner: addresses.config,
    mint: WSOL_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });
  const rewardVaults = await Promise.all(
    mintAddresses.slice(1).map((mint, index) => findAssociatedTokenPda({
      owner: addresses.config,
      mint,
      tokenProgram: tokenPrograms[index + 1],
    }).then(([vault]) => vault)),
  );

  const swaps = [
    { kind: 0, assetIndex: 0, amountIn: reserves.fare, nonce: configuration.fareSwapNonce },
    ...reserves.stocks.map((amountIn, assetIndex) => ({
      kind: 1,
      assetIndex,
      amountIn,
      nonce: configuration.stockSwapNonces[assetIndex],
    })),
  ];
  for (const pending of swaps) {
    if (pending.amountIn < config.swapMinimumLamports) continue;
    try {
      const outputMint = pending.kind === 0
        ? configuration.fareMint
        : configuration.stockMints[pending.assetIndex];
      const rewardVault = rewardVaults[pending.kind === 0 ? 0 : pending.assetIndex + 1];
      const fixedWritable = new Set<string>([
        String(addresses.config), String(addresses.feeVault), String(addresses.pool),
        String(wsolVault), String(rewardVault),
        ...(pending.kind === 0 ? [String(addresses.traineePool), String(configuration.fareMint)] : []),
      ]);
      const route = await buildJupiterRoute({
        apiKey: config.jupiterApiKey,
        inputMint: WSOL_MINT,
        outputMint,
        amountIn: pending.amountIn,
        taker: addresses.config,
        payer: caller.address,
        destinationTokenAccount: rewardVault,
        jupiterProgram: configuration.jupiterProgram,
        slippageBps: config.swapSlippageBps,
        maxAccounts: config.jupiterMaxAccounts,
        fixedWritableAccounts: fixedWritable,
      });
      const deadline = chainTime + BigInt(config.swapPlanTtlSeconds);
      const plan: SwapPlan = {
        kind: pending.kind,
        assetIndex: pending.assetIndex,
        nonce: pending.nonce,
        amountIn: pending.amountIn,
        minOut: route.minOut,
        deadline,
        routeHash: hashJupiterRoute(route.routeData, route.routeAccounts, addresses.config),
      };
      const message = buildSwapPlanMessage(config.programId, configuration.deploymentId, plan);
      const signatureInstruction = buildEd25519Instruction(backendSigner, message);
      const processInstruction = buildProcessSwapInstruction({
        programId: config.programId,
        caller: caller.address,
        addresses,
        configuration,
        pending,
        wsolVault,
        rewardVault,
        tokenProgram: tokenPrograms[pending.kind === 0 ? 1 : pending.assetIndex + 2],
        plan,
        route,
      });
      const signature = await sendInstructions(
        config.solanaRpcUrl,
        caller,
        [computeUnitLimitInstruction(), signatureInstruction, processInstruction],
        [],
        route.lookupTables,
      );
      console.log(`${pending.kind === 0 ? 'FARE' : `stock ${pending.assetIndex}`} swap finalized: ${signature}`);
    } catch (error) {
      console.error(`${pending.kind === 0 ? 'FARE' : `stock ${pending.assetIndex}`} swap skipped:`, error);
    }
  }
}

function buildProcessSwapInstruction(input: {
  programId: Address;
  caller: Address;
  addresses: Awaited<ReturnType<typeof deriveAddresses>>;
  configuration: ReturnType<typeof decodeWorkerConfiguration>;
  pending: { kind: number; assetIndex: number };
  wsolVault: Address;
  rewardVault: Address;
  tokenProgram: Address;
  plan: SwapPlan;
  route: Awaited<ReturnType<typeof buildJupiterRoute>>;
}): Instruction {
  const isFare = input.pending.kind === 0;
  const mint = isFare
    ? input.configuration.fareMint
    : input.configuration.stockMints[input.pending.assetIndex];
  const fixed = [
    meta(input.caller, AccountRole.READONLY_SIGNER),
    meta(input.addresses.config, AccountRole.WRITABLE),
    meta(input.addresses.feeVault, AccountRole.WRITABLE),
    meta(input.addresses.pool, AccountRole.WRITABLE),
    ...(isFare ? [meta(input.addresses.traineePool, AccountRole.WRITABLE)] : []),
    meta(WSOL_MINT, AccountRole.READONLY),
    meta(input.wsolVault, AccountRole.WRITABLE),
    meta(mint, isFare ? AccountRole.WRITABLE : AccountRole.READONLY),
    meta(input.rewardVault, AccountRole.WRITABLE),
    meta(input.configuration.jupiterProgram, AccountRole.READONLY),
    meta(TOKEN_PROGRAM, AccountRole.READONLY),
    meta(input.tokenProgram, AccountRole.READONLY),
    meta(INSTRUCTIONS_SYSVAR, AccountRole.READONLY),
  ];
  return {
    programAddress: input.programId,
    accounts: [...fixed, ...input.route.routeAccounts],
    data: encodeProcessSwapData(
      anchorDiscriminator(isFare ? 'process_fare_swap' : 'process_stock_swap'),
      input.plan,
      input.route.routeData,
    ),
  };
}

async function drainRewards(
  rpcUrl: string,
  programId: Address,
  signer: KeyPairSigner,
  addresses: Awaited<ReturnType<typeof deriveAddresses>>,
  kind: QueueKind,
) {
  for (let transactionCount = 0; transactionCount < 500; transactionCount += 1) {
    const clock = await loadProtocolClock(rpcUrl, programId);
    if (clock.paused) return;
    const poolAddress = kind === 'main' ? addresses.pool : addresses.traineePool;
    const queueAddress = kind === 'main' ? addresses.queue : addresses.traineeQueue;
    const [poolAccount, queueAccount] = await getAccounts(rpcUrl, [poolAddress, queueAddress]);
    const pool = decodeRewardPoolState(poolAccount.data);
    const queue = decodeEventQueueState(queueAccount.data);
    const ready = queueHasReadyEvent(queue, pool, clock.protocolTime);
    const hasDistributableMoney = hasAssignableRewards(pool.nextPool, pool.totalActiveWeight);
    if (!pool.seriesActive && !ready && !hasDistributableMoney) return;

    const end = pool.seriesActive ? pool.seriesEnd : clock.protocolTime;
    const cutoff = pool.seriesActive ? pool.seriesEventCutoff : queue.nextEventNumber - 1n;
    const eligibleIndexes = queue.pages.flatMap((page, index) => (
      page.count > 0 && page.minTimestamp <= end && page.minEventNumber <= cutoff ? [index] : []
    ));
    const pageAddresses = await Promise.all(eligibleIndexes.map(index => derivePage(programId, kind, index)));
    const pageAccounts = await getAccounts(rpcUrl, pageAddresses);
    const pages = new Map<number, EventPageState>();
    pageAccounts.forEach((account, offset) => pages.set(eligibleIndexes[offset], decodeEventPageState(account.data)));
    const batch = selectEventBatch(queue, pool, clock.protocolTime, pages);
    if (ready && batch.selected.length === 0) throw new Error(`${kind} reward queue is ready but no safe batch could be built`);

    const remaining: Array<ReturnType<typeof meta>> = [];
    for (const pageIndex of batch.pageIndexes) {
      remaining.push(meta(await derivePage(programId, kind, pageIndex), AccountRole.WRITABLE));
    }
    for (const target of batch.targets) {
      const targetAddress = kind === 'main' ? await deriveMachine(programId, address(target)) : address(target);
      remaining.push(meta(targetAddress, AccountRole.WRITABLE));
    }
    const limit = Math.max(1, batch.selected.length);
    const instruction: Instruction = {
      programAddress: programId,
      accounts: [
        meta(signer.address, AccountRole.READONLY_SIGNER),
        meta(addresses.config, AccountRole.READONLY),
        meta(poolAddress, AccountRole.WRITABLE),
        meta(queueAddress, AccountRole.WRITABLE),
        ...remaining,
      ],
      data: Buffer.concat([anchorDiscriminator(kind === 'main' ? 'calculate_rewards' : 'calculate_trainee_rewards'), Buffer.from([limit])]),
    };
    const signature = await sendInstructions(rpcUrl, signer, [computeUnitLimitInstruction(), instruction]);
    console.log(`${kind} calculate_rewards (${batch.selected.length} events) finalized: ${signature}`);
  }
  throw new Error(`${kind} queue did not drain after 500 transactions`);
}

async function pruneStaleMainEvents(
  rpcUrl: string,
  programId: Address,
  signer: KeyPairSigner,
  addresses: Awaited<ReturnType<typeof deriveAddresses>>,
) {
  const queue = decodeEventQueueState((await getAccount(rpcUrl, addresses.queue)).data);
  const pageIndexes = queue.pages
    .map((page, index) => ({ ...page, index }))
    .filter(page => page.count > 0)
    .sort((left, right) => right.count - left.count)
    .map(page => page.index);
  let transactionCount = 0;

  for (const pageIndex of pageIndexes) {
    if (transactionCount >= 10) break;
    const pageAddress = await derivePage(programId, 'main', pageIndex);
    const page = decodeEventPageState((await getAccount(rpcUrl, pageAddress)).data);
    const expiryEvents = page.events.filter(event => event.kind === 1);
    if (expiryEvents.length === 0) continue;

    const targetAddresses = [...new Set(expiryEvents.map(event => String(event.target)))].map(address);
    const machineAddresses = await Promise.all(targetAddresses.map(target => deriveMachine(programId, target)));
    const machineAccounts = await getAccountsInChunks(rpcUrl, machineAddresses);
    const machines = new Map(targetAddresses.map((target, index) => [
      String(target),
      { address: machineAddresses[index], state: decodeMachineRewardState(machineAccounts[index].data) },
    ]));
    const stale = expiryEvents
      .filter(event => expiryIsPrunable(event, machines.get(String(event.target))!.state))
      .slice(0, 20);
    if (stale.length === 0) continue;

    const staleMachines = [...new Set(stale.map(event => String(event.target)))]
      .map(target => machines.get(target)!.address);
    const instruction: Instruction = {
      programAddress: programId,
      accounts: [
        meta(signer.address, AccountRole.READONLY_SIGNER),
        meta(addresses.config, AccountRole.READONLY),
        meta(addresses.queue, AccountRole.WRITABLE),
        meta(pageAddress, AccountRole.WRITABLE),
        ...staleMachines.map(machine => meta(machine, AccountRole.READONLY)),
      ],
      data: encodePruneStaleEvents(pageIndex, stale.map(event => event.eventNumber)),
    };
    try {
      const signature = await sendInstructions(rpcUrl, signer, [instruction]);
      transactionCount += 1;
      console.log(`prune_stale_events page ${pageIndex} (${stale.length} events) finalized: ${signature}`);
    } catch (error) {
      console.warn(`prune_stale_events page ${pageIndex} lost a finalized-state race; retrying next cycle`, error);
    }
  }
}

async function hasCollectableFees(rpcUrl: string, feeVault: Address) {
  const account = await getAccount(rpcUrl, feeVault);
  const rent = BigInt(await rpcCall(rpcUrl, 'getMinimumBalanceForRentExemption', [account.data.length, { commitment: 'finalized' }]) as number);
  const view = new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength);
  let reserved = 0n;
  for (let index = 0; index < 5; index += 1) reserved += view.getBigUint64(8 + index * 8, true);
  return account.lamports > rent + reserved;
}

function collectFeesInstruction(
  programId: Address,
  caller: Address,
  addresses: Awaited<ReturnType<typeof deriveAddresses>>,
  teamAccount: Address,
): Instruction {
  return {
    programAddress: programId,
    accounts: [
      meta(caller, AccountRole.READONLY_SIGNER),
      meta(addresses.config, AccountRole.READONLY),
      meta(addresses.feeVault, AccountRole.WRITABLE),
      meta(teamAccount, AccountRole.WRITABLE),
    ],
    data: anchorDiscriminator('collect_fees'),
  };
}

export function absorbPumpWsolFeesInstruction(
  programId: Address,
  caller: Address,
  addresses: Awaited<ReturnType<typeof deriveAddresses>>,
  pumpWsolVault: Address,
): Instruction {
  return {
    programAddress: programId,
    accounts: [
      meta(caller, AccountRole.WRITABLE_SIGNER),
      meta(addresses.config, AccountRole.READONLY),
      meta(addresses.feeVault, AccountRole.WRITABLE),
      meta(pumpWsolVault, AccountRole.WRITABLE),
      meta(TOKEN_PROGRAM, AccountRole.READONLY),
    ],
    data: anchorDiscriminator('absorb_pump_wsol_fees'),
  };
}

async function deriveAddresses(programAddress: Address) {
  const derive = (...seeds: string[]) => getProgramDerivedAddress({
    programAddress,
    seeds: seeds.map(seed => utf8.encode(seed)),
  }).then(([result]) => result);
  const [config, pool, traineePool, queue, traineeQueue, feeVault] = await Promise.all([
    derive('config'), derive('pool', 'main'), derive('pool', 'trainee'),
    derive('queue', 'main'), derive('queue', 'trainee'), derive('fees'),
  ]);
  return { config, pool, traineePool, queue, traineeQueue, feeVault };
}

async function derivePage(programAddress: Address, kind: QueueKind, index: number) {
  return (await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8.encode(kind === 'main' ? 'event-page' : 'trainee-event-page'), Uint8Array.of(index)],
  }))[0];
}

async function deriveMachine(programAddress: Address, asset: Address) {
  return (await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8.encode('machine'), Uint8Array.from(addressEncoder.encode(asset))],
  }))[0];
}

function anchorDiscriminator(name: string) {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function meta(value: Address, role: AccountRole) { return { address: value, role }; }

interface RpcAccount { data: Uint8Array; lamports: bigint; owner: Address }

export function isBurnedCoreAssetAccount(account: Pick<RpcAccount, 'data' | 'owner'> | null) {
  return account === null || (
    String(account.owner) === String(MPL_CORE_PROGRAM)
    && account.data.length === 1
    && account.data[0] === 0
  );
}

export function hasAssignableRewards(amounts: bigint[], totalWeight: bigint) {
  if (totalWeight <= 0n) return false;
  return amounts.some(amount => (
    amount * ACCUMULATOR_SCALE / totalWeight
  ) * totalWeight / ACCUMULATOR_SCALE > 0n);
}

async function getAccount(rpcUrl: string, account: Address): Promise<RpcAccount> {
  return (await getAccounts(rpcUrl, [account]))[0];
}

async function getOptionalAccount(rpcUrl: string, account: Address): Promise<RpcAccount | null> {
  const result = await rpcCall(rpcUrl, 'getAccountInfo', [account, {
    commitment: 'finalized', encoding: 'base64',
  }]) as { value: { data: [string, string]; lamports: number; owner: string } | null };
  if (!result.value) return null;
  return {
    data: Uint8Array.from(Buffer.from(result.value.data[0], 'base64')),
    lamports: BigInt(result.value.lamports),
    owner: address(result.value.owner),
  };
}

async function getAccounts(rpcUrl: string, accounts: Address[]): Promise<RpcAccount[]> {
  if (accounts.length === 0) return [];
  const result = await rpcCall(rpcUrl, 'getMultipleAccounts', [accounts, {
    commitment: 'finalized', encoding: 'base64',
  }]) as { value: Array<{ data: [string, string]; lamports: number; owner: string } | null> };
  return result.value.map((value, index) => {
    if (!value) throw new Error(`Required Solana account ${accounts[index]} is missing`);
    return {
      data: Uint8Array.from(Buffer.from(value.data[0], 'base64')),
      lamports: BigInt(value.lamports),
      owner: address(value.owner),
    };
  });
}

async function getAccountsInChunks(rpcUrl: string, accounts: Address[]) {
  const result: RpcAccount[] = [];
  for (let offset = 0; offset < accounts.length; offset += 100) {
    result.push(...await getAccounts(rpcUrl, accounts.slice(offset, offset + 100)));
  }
  return result;
}

async function getOptionalAccountsInChunks(rpcUrl: string, accounts: Address[]) {
  const result: Array<RpcAccount | null> = [];
  for (let offset = 0; offset < accounts.length; offset += 100) {
    const chunk = accounts.slice(offset, offset + 100);
    const response = await rpcCall(rpcUrl, 'getMultipleAccounts', [chunk, {
      commitment: 'finalized', encoding: 'base64',
    }]) as { value: Array<{ data: [string, string]; lamports: number; owner: string } | null> };
    result.push(...response.value.map(value => value ? {
      data: Uint8Array.from(Buffer.from(value.data[0], 'base64')),
      lamports: BigInt(value.lamports),
      owner: address(value.owner),
    } : null));
  }
  return result;
}

function encodePruneStaleEvents(pageIndex: number, eventNumbers: bigint[]) {
  const count = Buffer.alloc(4);
  count.writeUInt32LE(eventNumbers.length);
  return Buffer.concat([
    anchorDiscriminator('prune_stale_events'),
    Buffer.from([pageIndex]),
    count,
    ...eventNumbers.map(eventNumber => {
      const encoded = Buffer.alloc(8);
      encoded.writeBigUInt64LE(eventNumber);
      return encoded;
    }),
  ]);
}

function decodeFeeReserves(bytes: Uint8Array) {
  if (bytes.length < 49) throw new Error('Invalid FeeVault account');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    fare: view.getBigUint64(8, true),
    stocks: Array.from({ length: 4 }, (_, index) => view.getBigUint64(16 + index * 8, true)),
  };
}

async function rpcCall(url: string, method: string, params: unknown[]) {
  return solanaRpcCall<unknown>(url, method, params);
}
