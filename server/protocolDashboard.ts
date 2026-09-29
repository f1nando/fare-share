import { findAssociatedTokenPda } from '@solana-program/token';
import { address, getAddressDecoder, type Address } from '@solana/kit';
import type { WorkerStatusDocument } from './database.js';
import { decodeEventQueueState, MACHINE_ACCOUNT_SIZE, type EventQueueState } from './programState.js';
import { solanaRpcCall } from './solanaRpc.js';
import { decodeWorkerConfiguration } from './solanaState.js';
import { protocolAddresses } from './setup.js';

const addressDecoder = getAddressDecoder();
const ACCUMULATOR_SCALE = 1_000_000_000_000_000_000n;
const CLASS_NAMES = new Map([[1, 'Economy'], [3, 'Comfort'], [10, 'Business'], [30, 'Legend']]);
const ASSET_SYMBOLS = ['FARE', 'UBERx', 'TSLAx', 'GOOGLx', 'AMZNx'];

export async function loadProtocolDashboard(
  rpcUrl: string,
  programId: Address,
  worker: WorkerStatusDocument | null,
  workerIntervalMs: number,
) {
  const addresses = await protocolAddresses(programId);
  const [configAccount, poolAccount, traineePoolAccount, queueAccount, traineeQueueAccount, feeVaultAccount, machineAccounts] = await Promise.all([
    getAccount(rpcUrl, addresses.config),
    getAccount(rpcUrl, addresses.pool),
    getAccount(rpcUrl, addresses.traineePool),
    getAccount(rpcUrl, addresses.queue),
    getAccount(rpcUrl, addresses.traineeQueue),
    getRpcAccount(rpcUrl, addresses.feeVault),
    listMachines(rpcUrl, programId),
  ]);
  const configuration = decodeWorkerConfiguration(configAccount);
  const assetMints = [configuration.fareMint, ...configuration.stockMints];
  const mintDetails = await getMintDetails(rpcUrl, assetMints);
  const vaultAddresses = await Promise.all(assetMints.map((mint, index) => findAssociatedTokenPda({ owner: addresses.config, mint, tokenProgram: mintDetails[index].tokenProgram }).then(([vault]) => vault)));
  const vaultBalances = await getTokenBalances(rpcUrl, vaultAddresses);
  const feeVaultRent = await solanaRpcCall<number>(rpcUrl, 'getMinimumBalanceForRentExemption', [feeVaultAccount.data.length, { commitment: 'finalized' }]);
  const pool = decodeDashboardPool(poolAccount);
  const traineePool = decodeDashboardPool(traineePoolAccount);
  const queue = decodeEventQueueState(queueAccount);
  const traineeQueue = decodeEventQueueState(traineeQueueAccount);
  const nowSeconds = (configuration.pausedAt || BigInt(Math.floor(Date.now() / 1000))) - configuration.totalPausedSeconds;
  const machines = machineAccounts.map(item => machineSummary(item.pubkey, item.data, pool));
  const updatedAt = worker?.updatedAt?.getTime() || 0;
  const online = updatedAt > 0 && Date.now() - updatedAt <= workerIntervalMs * 2 + 15_000;

  return {
    protocol: {
      state: configuration.pausedAt !== 0n ? 'paused' : configuration.saleStarted ? 'live' : 'ready',
      paused: configuration.pausedAt !== 0n,
      saleStarted: configuration.saleStarted,
      teamAccount: String(configuration.teamAccount),
      fareMint: String(configuration.fareMint),
      mintedByClass: configuration.mintedByClass,
      machineCount: machines.length,
    },
    worker: {
      state: online ? worker?.state || 'idle' : 'offline',
      online,
      lastSuccessAt: worker?.lastSuccessAt || null,
      lastErrorAt: worker?.lastErrorAt || null,
      error: worker?.error || null,
      nextRunAt: online ? worker?.nextRunAt || null : null,
      intervalMs: workerIntervalMs,
    },
    queues: {
      main: queueSummary(queue, pool, nowSeconds),
      trainee: queueSummary(traineeQueue, traineePool, nowSeconds),
    },
    distribution: {
      assets: ASSET_SYMBOLS.map((symbol, index) => ({ symbol, decimals: mintDetails[index].decimals })),
      activeWeight: pool.totalActiveWeight.toString(),
      calculatedUntil: pool.calculatedUntil.toString(),
      seriesActive: pool.seriesActive,
      seriesStart: pool.seriesStart.toString(),
      seriesEnd: pool.seriesEnd.toString(),
      seriesCursor: pool.seriesCursor.toString(),
      nextPool: pool.nextPool.map(String),
      seriesRemaining: pool.seriesRemaining.map(String),
      obligations: pool.obligations.map(String),
    },
    vaults: {
      solLamports: String(Math.max(0, feeVaultAccount.lamports - feeVaultRent)),
      tokens: ASSET_SYMBOLS.map((symbol, index) => ({ symbol, mint: String(assetMints[index]), decimals: mintDetails[index].decimals, amount: vaultBalances[index].toString() })),
    },
    machines: machines.sort((a, b) => Number(BigInt(b.claimable[0]) - BigInt(a.claimable[0]))),
    observedAt: new Date().toISOString(),
  };
}

interface DashboardPool {
  calculatedUntil: bigint;
  totalActiveWeight: bigint;
  accumulators: bigint[];
  obligations: bigint[];
  nextPool: bigint[];
  seriesStart: bigint;
  seriesEnd: bigint;
  seriesCursor: bigint;
  seriesRemaining: bigint[];
  seriesEventCutoff: bigint;
  seriesActive: boolean;
}

export function decodeDashboardPool(bytes: Uint8Array): DashboardPool {
  const reader = new Reader(bytes);
  const calculatedUntil = reader.i64();
  const totalActiveWeight = reader.u64();
  const accumulators = Array.from({ length: 5 }, () => reader.u128());
  const obligations = Array.from({ length: 5 }, () => reader.u64());
  const nextPool = Array.from({ length: 5 }, () => reader.u64());
  reader.skip(8 * 5);
  const seriesRemaining = Array.from({ length: 5 }, () => reader.u64());
  const seriesStart = reader.i64();
  const seriesEnd = reader.i64();
  const seriesCursor = reader.i64();
  const seriesEventCutoff = reader.u64();
  const seriesActive = reader.u8() !== 0;
  return { calculatedUntil, totalActiveWeight, accumulators, obligations, nextPool, seriesStart, seriesEnd, seriesCursor, seriesRemaining, seriesEventCutoff, seriesActive };
}

export function decodeDashboardMachine(bytes: Uint8Array, pool: DashboardPool) {
  if (bytes.length !== MACHINE_ACCOUNT_SIZE) throw new Error('Invalid Machine account size');
  const reader = new Reader(bytes);
  const asset = reader.pubkey();
  const weight = reader.u16();
  const activeUntil = reader.i64();
  reader.skip(4 + 4);
  const rewardActive = reader.u8() !== 0;
  const closed = reader.u8() !== 0;
  const checkpoints = Array.from({ length: 5 }, () => reader.u128());
  const storedClaimable = Array.from({ length: 5 }, () => reader.u64());
  const claimable = storedClaimable.map((amount, index) => (
    rewardActive ? amount + ((pool.accumulators[index] - checkpoints[index]) * BigInt(weight)) / ACCUMULATOR_SCALE : amount
  ));
  return { asset, weight, activeUntil, rewardActive, closed, claimable };
}

function machineSummary(machine: string, bytes: Uint8Array, pool: DashboardPool) {
  const state = decodeDashboardMachine(bytes, pool);
  return {
    machine,
    asset: String(state.asset),
    className: CLASS_NAMES.get(state.weight) || `Weight ${state.weight}`,
    weight: state.weight,
    activeUntil: state.activeUntil.toString(),
    rewardActive: state.rewardActive,
    closed: state.closed,
    claimable: state.claimable.map(String),
  };
}

function queueSummary(queue: EventQueueState, pool: DashboardPool, now: bigint) {
  const count = queue.pages.reduce((total, page) => total + page.count, 0);
  const readyPages = queue.pages.reduce((total, page) => total + (page.count > 0 && page.minTimestamp <= (pool.seriesActive ? pool.seriesEnd : now) && page.minEventNumber <= (pool.seriesActive ? pool.seriesEventCutoff : queue.nextEventNumber - 1n) ? 1 : 0), 0);
  return { count, readyPages, capacity: queue.pages.length * 128, nextEventNumber: queue.nextEventNumber.toString() };
}

async function listMachines(rpcUrl: string, programId: Address) {
  const result = await solanaRpcCall<Array<{ pubkey: string; account: { data: [string, string] } }>>(rpcUrl, 'getProgramAccounts', [programId, {
    commitment: 'finalized', encoding: 'base64', filters: [{ dataSize: MACHINE_ACCOUNT_SIZE }],
  }]);
  return result.map(item => ({ pubkey: item.pubkey, data: Uint8Array.from(Buffer.from(item.account.data[0], 'base64')) }));
}

async function getAccount(rpcUrl: string, account: Address) {
  return (await getRpcAccount(rpcUrl, account)).data;
}

async function getRpcAccount(rpcUrl: string, account: Address) {
  const result = await solanaRpcCall<{ value: { lamports: number; data: [string, string] } | null }>(rpcUrl, 'getAccountInfo', [account, { commitment: 'finalized', encoding: 'base64' }]);
  if (!result.value) throw new Error(`Protocol account ${account} is not deployed`);
  return { lamports: result.value.lamports, data: Uint8Array.from(Buffer.from(result.value.data[0], 'base64')) };
}

async function getMintDetails(rpcUrl: string, mints: Address[]) {
  const fallback = [6, 8, 8, 8, 8];
  const result = await solanaRpcCall<{ value: Array<{ owner: string; data: [string, string] } | null> }>(rpcUrl, 'getMultipleAccounts', [mints, { commitment: 'finalized', encoding: 'base64' }]);
  return result.value.map((account, index) => ({ decimals: account ? Buffer.from(account.data[0], 'base64')[44] : fallback[index], tokenProgram: address(account?.owner || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }));
}

async function getTokenBalances(rpcUrl: string, accounts: Address[]) {
  const result = await solanaRpcCall<{ value: Array<{ data: [string, string] } | null> }>(rpcUrl, 'getMultipleAccounts', [accounts, { commitment: 'finalized', encoding: 'base64' }]);
  return result.value.map(account => {
    if (!account) return 0n;
    const data = Buffer.from(account.data[0], 'base64');
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
  });
}

class Reader {
  private readonly view: DataView;
  private offset = 8;
  constructor(private readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  skip(length: number) { this.offset += length; }
  take(length: number) { const value = this.bytes.slice(this.offset, this.offset + length); this.offset += length; return value; }
  u8() { return this.bytes[this.offset++]; }
  u16() { const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u64() { const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value; }
  i64() { const value = this.view.getBigInt64(this.offset, true); this.offset += 8; return value; }
  u128() { const low = this.u64(); const high = this.u64(); return low + (high << 64n); }
  pubkey() { return address(addressDecoder.decode(this.take(32))); }
}
