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
import { loadServerConfig } from './config.js';
import {
  decodeEventPageState,
  decodeEventQueueState,
  decodeRewardPoolState,
  queueHasReadyEvent,
  selectEventBatch,
  type EventPageState,
} from './programState.js';
import { parseSecretBytes } from './signing.js';
import { decodeClockFields, loadProtocolClock } from './solanaState.js';
import { createWorkerSigner, sendInstructions } from './transaction.js';

const utf8 = getUtf8Encoder();
const addressEncoder = getAddressEncoder();

type QueueKind = 'main' | 'trainee';

export async function runWorkerCycle() {
  const config = loadServerConfig();
  const signer = await createWorkerSigner(parseSecretBytes(config.signerSecret, 'BACKEND_SIGNER_SECRET_KEY'));
  const addresses = await deriveAddresses(config.programId);
  const clock = await loadProtocolClock(config.solanaRpcUrl, config.programId);
  if (clock.paused) {
    console.log('Taxi protocol is paused; worker cycle skipped.');
    return;
  }
  const configurationAccount = await getAccount(config.solanaRpcUrl, addresses.config);
  const configuration = decodeClockFields(configurationAccount.data);
  if (String(signer.address) !== String(clock.backendSigner)) {
    throw new Error('Worker key does not match Configuration.backend_signer');
  }

  if (await hasCollectableFees(config.solanaRpcUrl, addresses.feeVault)) {
    const signature = await sendInstructions(config.solanaRpcUrl, signer, [collectFeesInstruction(
      config.programId,
      signer.address,
      addresses,
      configuration.teamAccount,
    )]);
    console.log(`collect_fees finalized: ${signature}`);
  }

  await drainRewards(config.solanaRpcUrl, config.programId, signer, addresses, 'main');
  await drainRewards(config.solanaRpcUrl, config.programId, signer, addresses, 'trainee');
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
    const hasDistributableMoney = pool.totalActiveWeight > 0n && pool.nextPool.some(value => value > 0n);
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
    const signature = await sendInstructions(rpcUrl, signer, [instruction]);
    console.log(`${kind} calculate_rewards (${batch.selected.length} events) finalized: ${signature}`);
  }
  throw new Error(`${kind} queue did not drain after 500 transactions`);
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

interface RpcAccount { data: Uint8Array; lamports: bigint }

async function getAccount(rpcUrl: string, account: Address): Promise<RpcAccount> {
  return (await getAccounts(rpcUrl, [account]))[0];
}

async function getAccounts(rpcUrl: string, accounts: Address[]): Promise<RpcAccount[]> {
  if (accounts.length === 0) return [];
  const result = await rpcCall(rpcUrl, 'getMultipleAccounts', [accounts, {
    commitment: 'finalized', encoding: 'base64',
  }]) as { value: Array<{ data: [string, string]; lamports: number } | null> };
  return result.value.map((value, index) => {
    if (!value) throw new Error(`Required Solana account ${accounts[index]} is missing`);
    return { data: Uint8Array.from(Buffer.from(value.data[0], 'base64')), lamports: BigInt(value.lamports) };
  });
}

async function rpcCall(url: string, method: string, params: unknown[]) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Solana RPC ${method} failed with HTTP ${response.status}`);
  const payload = await response.json() as { result?: unknown; error?: { message?: string } };
  if (payload.error) throw new Error(`Solana RPC ${method}: ${payload.error.message || 'unknown error'}`);
  return payload.result;
}
