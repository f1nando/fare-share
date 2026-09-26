import {
  address,
  createSolanaRpc,
  getProgramDerivedAddress,
  getUtf8Encoder,
} from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';
import { getWallets } from '@wallet-standard/app';
import {
  base64Bytes,
  buildActivateTraineeInstructions,
  buildClaimInstructions,
  buildClaimTraineeInstructions,
  buildMintMachine,
  buildRepairInstructions,
  buildTransferCoreAssetInstruction,
  chooseEventPage,
  decodeConfiguration,
  decodeEventQueue,
  decodeMachine,
  decodeRewardPool,
  decodeTrainee,
  decodeTraineeBucket,
  deriveTraineeAddresses,
  deriveTaxiAddresses,
  sendWalletInstructions,
} from './anchorClient.js';

const env = import.meta.env ?? {};

export const PROGRAM_ID = address(
  env.VITE_TAXI_PROGRAM_ID || '9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv',
);
export const RPC_URL = env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
export const SOLANA_CHAIN = resolveSolanaChain(env.VITE_SOLANA_CHAIN, RPC_URL);

const DAS_URL = env.VITE_SOLANA_DAS_URL || RPC_URL;
const BACKEND_URL = String(env.VITE_BACKEND_URL || '').replace(/\/$/, '');
const rpc = createSolanaRpc(RPC_URL);
const utf8 = getUtf8Encoder();
const ACCUMULATOR_SCALE = 1_000_000_000_000_000_000n;
const MAX_DURABILITY = 5 * 24 * 60 * 60;
const STOCK_SYMBOLS = ['UBERx', 'TSLAx', 'GOOGLx', 'AMZNx'];
const XSTOCKS_API_URL = 'https://api.xstocks.fi/api/v2/public/assets';

export function resolveSolanaChain(configuredChain, rpcUrl) {
  if (configuredChain === 'solana:devnet' || configuredChain === 'solana:mainnet') return configuredChain;
  if (configuredChain) throw new Error('VITE_SOLANA_CHAIN must be solana:devnet or solana:mainnet.');
  return String(rpcUrl).includes('devnet') ? 'solana:devnet' : 'solana:mainnet';
}

export function calculateRepairQuote(fareBase, pendingFare, secondsLeft) {
  const boundedRemaining = Math.max(0, Math.min(MAX_DURABILITY, Number(secondsLeft)));
  const missingSeconds = BigInt(MAX_DURABILITY - boundedRemaining);
  const effectiveBase = BigInt(fareBase) + BigInt(pendingFare);
  if (effectiveBase === 0n || missingSeconds === 0n) return 0n;
  return (effectiveBase * 25n + 99n) / 100n;
}

export function calculateProtocolTime(config, chainUnixTime) {
  const chainTime = BigInt(chainUnixTime);
  const frozenTime = config.pausedAt !== 0n ? config.pausedAt : chainTime;
  return frozenTime - config.totalPausedSeconds;
}

export function calculateDurabilityPercent(secondsLeft) {
  const boundedRemaining = Math.max(0, Math.min(MAX_DURABILITY, Number(secondsLeft)));
  if (boundedRemaining === MAX_DURABILITY) return 100;
  return Math.floor(boundedRemaining * 1000 / MAX_DURABILITY) / 10;
}

export function calculateTraineeReward(trainee, pool, startBucket, endBucket) {
  const effectiveUntil = pool.effectiveCalculatedUntil;
  if (!startBucket?.processed || effectiveUntil < trainee.activeFrom) return 0n;
  const target = effectiveUntil >= trainee.activeUntil
    ? (endBucket?.processed ? endBucket.accumulator : null)
    : pool.accumulators[0];
  if (target === null) return 0n;
  const checkpoint = trainee.checkpointInitialized ? trainee.checkpoint : startBucket.accumulator;
  return target >= checkpoint ? (target - checkpoint) / ACCUMULATOR_SCALE : 0n;
}

export function selectActiveMultiplier(value, nowSeconds = Math.floor(Date.now() / 1000)) {
  const current = Number(value?.currentMultiplier);
  const pending = Number(value?.newMultiplier);
  const activatesAt = Number(value?.activationDateTime);
  if (Number.isFinite(pending) && pending > 0 && Number.isFinite(activatesAt) && activatesAt <= nowSeconds) {
    return pending;
  }
  return Number.isFinite(current) && current > 0 ? current : 1;
}

export function formatTokenAmount(rawAmount, decimals, multiplier = 1) {
  const amount = Number(rawAmount) / (10 ** Number(decimals)) * Number(multiplier);
  if (!Number.isFinite(amount)) return `${rawAmount} raw`;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(amount);
}

export function formatSolAmount(lamports) {
  const value = BigInt(lamports);
  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export async function protocolAddresses() {
  const [[config], [pool], [queue], [traineePool], [traineeQueue], [feeVault]] = await Promise.all([
    getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: [utf8.encode('config')] }),
    getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: [utf8.encode('pool'), utf8.encode('main')] }),
    getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: [utf8.encode('queue'), utf8.encode('main')] }),
    getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: [utf8.encode('pool'), utf8.encode('trainee')] }),
    getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: [utf8.encode('queue'), utf8.encode('trainee')] }),
    getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: [utf8.encode('fees')] }),
  ]);
  return { config, pool, queue, traineePool, traineeQueue, feeVault };
}

export async function loadProtocolStatus() {
  const addresses = await protocolAddresses();
  const accounts = await rpc.getMultipleAccounts([
    addresses.config,
    addresses.pool,
    addresses.queue,
    addresses.traineePool,
    addresses.traineeQueue,
  ], {
    commitment: 'finalized',
    encoding: 'base64',
  }).send();
  const deployed = accounts.value.every(Boolean);
  if (!deployed) return { addresses, deployed: false, network: networkName() };
  const chainUnixTime = await loadFinalizedChainTime().catch(() => Math.floor(Date.now() / 1000));
  return {
    addresses,
    deployed,
    network: networkName(),
    chainUnixTime,
    config: decodeConfiguration(accountBytes(accounts.value[0])),
    pool: decodeRewardPool(accountBytes(accounts.value[1])),
    queue: decodeEventQueue(accountBytes(accounts.value[2])),
    traineePool: decodeRewardPool(accountBytes(accounts.value[3])),
    traineeQueue: decodeEventQueue(accountBytes(accounts.value[4])),
  };
}

export async function loadOwnedTrainees(owner, knownStatus) {
  const status = knownStatus?.deployed ? knownStatus : await loadProtocolStatus();
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'fare-trainees',
      method: 'getProgramAccounts',
      params: [String(PROGRAM_ID), {
        commitment: 'finalized',
        encoding: 'base64',
        filters: [{ dataSize: 90 }, { memcmp: { offset: 8, bytes: String(owner) } }],
      }],
    }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`Could not load trainee cars: ${body.error.message}`);
  const trainees = (body.result || []).map(item => ({
    address: address(item.pubkey),
    ...decodeTrainee(base64Bytes(item.account.data[0])),
  }));
  if (!trainees.length) return [];
  const bucketAddresses = await Promise.all(trainees.map(async trainee => {
    const derived = await deriveTraineeAddresses(
      PROGRAM_ID,
      owner,
      trainee.campaignId,
      trainee.activeFrom,
      trainee.activeUntil,
      0,
    );
    return [derived.startBucket, derived.endBucket];
  }));
  const [bucketAccounts, mintAccount] = await Promise.all([
    loadMultipleAccounts(bucketAddresses.flat()),
    rpc.getAccountInfo(status.config.fareMint, { commitment: 'finalized', encoding: 'base64' }).send(),
  ]);
  if (!mintAccount.value) throw new Error('FARE mint is unavailable.');
  const decimals = mintDecimals(accountBytes(mintAccount.value));
  return trainees.map((trainee, index) => {
    const startAccount = bucketAccounts[index * 2];
    const endAccount = bucketAccounts[index * 2 + 1];
    const start = startAccount ? decodeTraineeBucket(accountBytes(startAccount)) : null;
    const end = endAccount ? decodeTraineeBucket(accountBytes(endAccount)) : null;
    const reward = calculateTraineeReward(trainee, status.traineePool, start, end);
    return { ...trainee, reward, rewardDisplay: formatTokenAmount(reward, decimals) };
  });
}

export async function activateTrainee(connection, campaignId, keyword, knownStatus) {
  const status = await refreshTraineeStatus(knownStatus);
  const pageIndex = chooseEventPage(status.traineeQueue, 2);
  const owner = address(connection.account.address);
  const response = await fetch(`${BACKEND_URL}/api/trainee/voucher`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: owner, campaignId, keyword, pageIndex }),
  });
  const voucher = await response.json();
  if (!response.ok) throw new Error(voucher.error || 'The backend did not issue a voucher.');
  const instructions = await buildActivateTraineeInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress: status.addresses.config,
    traineeQueue: status.addresses.traineeQueue,
    voucher,
  });
  return sendWalletInstructions({
    rpc,
    wallet: connection.wallet,
    account: connection.account,
    chain: SOLANA_CHAIN,
    instructions,
  });
}

export async function claimTrainee(connection, trainee, knownStatus) {
  const status = knownStatus?.deployed ? knownStatus : await loadProtocolStatus();
  const mintAccount = await rpc.getAccountInfo(status.config.fareMint, {
    commitment: 'finalized',
    encoding: 'base64',
  }).send();
  if (!mintAccount.value) throw new Error('FARE mint is unavailable.');
  const instructions = await buildClaimTraineeInstructions({
    programAddress: PROGRAM_ID,
    owner: address(connection.account.address),
    configAddress: status.addresses.config,
    traineePool: status.addresses.traineePool,
    trainee,
    fareMint: status.config.fareMint,
    tokenProgram: address(mintAccount.value.owner),
    amount: trainee.reward,
  });
  return sendWalletInstructions({
    rpc,
    wallet: connection.wallet,
    account: connection.account,
    chain: SOLANA_CHAIN,
    instructions,
  });
}

export async function loadOwnedMachines(owner, knownStatus) {
  const status = knownStatus?.deployed ? knownStatus : await loadProtocolStatus();
  if (!status.deployed) return [];
  const assets = await loadDASAssets(owner, status.config.collection);
  if (!assets.length) return [];
  const derived = await Promise.all(assets.map(item => deriveTaxiAddresses(PROGRAM_ID, address(item.id))));
  const rewardMints = [status.config.fareMint, ...status.config.stockMints];
  const [machineAccounts, mintResponse, stockMultipliers] = await Promise.all([
    loadMultipleAccounts(derived.map(item => item.machine)),
    rpc.getMultipleAccounts(rewardMints, { commitment: 'finalized', encoding: 'base64' }).send(),
    loadStockMultipliers(status.chainUnixTime),
  ]);
  if (mintResponse.value.some(value => !value)) throw new Error('One of the reward mints is unavailable.');
  const rewardDecimals = mintResponse.value.map(value => mintDecimals(accountBytes(value)));
  const protocolNow = Number(calculateProtocolTime(status.config, status.chainUnixTime));
  return assets.flatMap((asset, index) => {
    const account = machineAccounts[index];
    if (!account) return [];
    const machine = decodeMachine(accountBytes(account));
    const pending = machine.rewardActive
      ? machine.checkpoints.map((checkpoint, rewardIndex) => (
        (status.pool.accumulators[rewardIndex] - checkpoint) * BigInt(machine.weight) / ACCUMULATOR_SCALE
      ))
      : [0n, 0n, 0n, 0n, 0n];
    const rewards = machine.claimable.map((value, rewardIndex) => value + pending[rewardIndex]);
    const secondsLeft = Math.max(0, Number(machine.activeUntil) - protocolNow);
    const repairCost = calculateRepairQuote(machine.fareBase, pending[0], secondsLeft);
    const rewardDisplay = {
      fare: formatTokenAmount(rewards[0], rewardDecimals[0]),
      stocks: STOCK_SYMBOLS.map((symbol, rewardIndex) => ({
        symbol,
        amount: formatTokenAmount(
          rewards[rewardIndex + 1],
          rewardDecimals[rewardIndex + 1],
          stockMultipliers?.[rewardIndex] ?? 1,
        ),
        rawFallback: stockMultipliers === null,
      })),
    };
    return [{
      asset: address(asset.id),
      machineAddress: derived[index].machine,
      name: asset.content?.metadata?.name || className(machine.weight),
      image: asset.content?.links?.image || '',
      weight: machine.weight,
      durability: calculateDurabilityPercent(secondsLeft),
      rewards,
      rewardDisplay,
      fareBase: machine.fareBase,
      repairCost,
      repairCostDisplay: formatTokenAmount(repairCost, rewardDecimals[0]),
      missingSeconds: MAX_DURABILITY - secondsLeft,
      calculatedUntil: status.pool.effectiveCalculatedUntil,
      closed: machine.closed,
    }];
  });
}

export async function loadMultipleAccounts(accountAddresses, rpcClient = rpc) {
  const values = [];
  for (let start = 0; start < accountAddresses.length; start += 100) {
    const response = await rpcClient.getMultipleAccounts(accountAddresses.slice(start, start + 100), {
      commitment: 'finalized',
      encoding: 'base64',
    }).send();
    values.push(...response.value);
  }
  return values;
}

async function loadStockMultipliers(chainUnixTime) {
  try {
    return await Promise.all(STOCK_SYMBOLS.map(async symbol => {
      const response = await fetch(`${XSTOCKS_API_URL}/${symbol}/multiplier?network=Solana`);
      if (!response.ok) throw new Error(`xStocks multiplier ${symbol}: HTTP ${response.status}`);
      return selectActiveMultiplier(await response.json(), chainUnixTime);
    }));
  } catch {
    return null;
  }
}

async function loadFinalizedChainTime() {
  const slotResponse = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'fare-clock-slot', method: 'getSlot', params: [{ commitment: 'finalized' }] }),
  });
  if (!slotResponse.ok) throw new Error(`Solana RPC getSlot: HTTP ${slotResponse.status}`);
  const slotBody = await slotResponse.json();
  if (slotBody.error || !Number.isSafeInteger(slotBody.result)) throw new Error('Solana RPC did not return a finalized slot');
  const timeResponse = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'fare-clock-time', method: 'getBlockTime', params: [slotBody.result] }),
  });
  if (!timeResponse.ok) throw new Error(`Solana RPC getBlockTime: HTTP ${timeResponse.status}`);
  const timeBody = await timeResponse.json();
  if (timeBody.error || !Number.isSafeInteger(timeBody.result)) throw new Error('Solana RPC did not return finalized block time');
  return timeBody.result;
}

export async function mintMachine(connection, classIndex, knownStatus) {
  const status = knownStatus?.deployed ? knownStatus : await loadProtocolStatus();
  if (!status.deployed) throw new Error('The program is not deployed on the selected network yet.');
  if (!status.config.saleStarted) throw new Error('The car sale is not open yet.');
  const pageIndex = chooseEventPage(status.queue, 2);
  const owner = address(connection.account.address);
  const built = await buildMintMachine({
    programAddress: PROGRAM_ID,
    owner,
    configAddress: status.addresses.config,
    config: status.config,
    queue: status.addresses.queue,
    classIndex,
    pageIndex,
  });
  const signature = await sendWalletInstructions({
    rpc,
    wallet: connection.wallet,
    account: connection.account,
    chain: SOLANA_CHAIN,
    instructions: [built.instruction],
    additionalSigners: [built.assetSigner],
  });
  return { signature, asset: built.assetSigner.address };
}

export async function claimMachine(connection, machine, knownStatus) {
  const status = knownStatus?.deployed ? knownStatus : await loadProtocolStatus();
  const owner = address(connection.account.address);
  const mints = [status.config.fareMint, ...status.config.stockMints];
  const mintAccounts = await rpc.getMultipleAccounts(mints, { commitment: 'finalized', encoding: 'base64' }).send();
  if (mintAccounts.value.some(value => !value)) throw new Error('One of the reward mints is unavailable.');
  const tokenPrograms = mintAccounts.value.map(value => address(value.owner));
  const destinationAddresses = await Promise.all(mints.map((mint, index) => (
    findAssociatedTokenPda({ owner, mint, tokenProgram: tokenPrograms[index] }).then(([result]) => result)
  )));
  const destinationAccounts = await rpc.getMultipleAccounts(destinationAddresses, {
    commitment: 'finalized',
    encoding: 'base64',
  }).send();
  const instructions = await buildClaimInstructions({
    programAddress: PROGRAM_ID,
    owner,
    configAddress: status.addresses.config,
    pool: status.addresses.pool,
    machine: machine.machineAddress,
    asset: machine.asset,
    mints,
    tokenPrograms,
    amounts: machine.rewards,
    destinationAccountsExist: destinationAccounts.value.map(Boolean),
  });
  return sendWalletInstructions({
    rpc,
    wallet: connection.wallet,
    account: connection.account,
    chain: SOLANA_CHAIN,
    instructions,
  });
}

export async function transferMachine(connection, machine, recipient, knownStatus) {
  const status = knownStatus?.deployed ? knownStatus : await loadProtocolStatus();
  const owner = address(connection.account.address);
  const newOwner = address(String(recipient).trim());
  if (String(owner) === String(newOwner)) throw new Error('Choose a different recipient wallet.');
  return sendWalletInstructions({
    rpc,
    wallet: connection.wallet,
    account: connection.account,
    chain: SOLANA_CHAIN,
    instructions: [buildTransferCoreAssetInstruction({
      owner,
      asset: machine.asset,
      collection: status.config.collection,
      newOwner,
    })],
  });
}

export async function repairMachine(connection, machine, knownStatus) {
  const status = await refreshStatus(knownStatus);
  const pageIndex = chooseEventPage(status.queue, 2);
  const mintAccount = await rpc.getAccountInfo(status.config.fareMint, {
    commitment: 'finalized',
    encoding: 'base64',
  }).send();
  if (!mintAccount.value) throw new Error('FARE mint is unavailable.');
  const instructions = await buildRepairInstructions({
    programAddress: PROGRAM_ID,
    owner: address(connection.account.address),
    configAddress: status.addresses.config,
    config: status.config,
    pool: status.addresses.pool,
    queue: status.addresses.queue,
    machine: machine.machineAddress,
    asset: machine.asset,
    fareTokenProgram: address(mintAccount.value.owner),
    repairCost: machine.repairCost,
    pageIndex,
  });
  return sendWalletInstructions({
    rpc,
    wallet: connection.wallet,
    account: connection.account,
    chain: SOLANA_CHAIN,
    instructions,
  });
}

export async function connectWallet() {
  const wallets = getWallets().get();
  const phantom = wallets.find(wallet => wallet.name.toLowerCase().includes('phantom'));
  if (!phantom) throw new Error('Phantom was not found. Install the extension or open this site in Phantom\'s built-in browser.');
  const connect = phantom.features['standard:connect'];
  if (!connect) throw new Error('This wallet does not support Wallet Standard connect.');
  const result = await connect.connect();
  const account = result.accounts?.[0] || phantom.accounts?.[0];
  if (!account) throw new Error('Phantom did not return an active account.');
  return { wallet: phantom, account };
}

export function shortAddress(value) {
  const text = String(value || '');
  return text.length > 10 ? `${text.slice(0, 4)}…${text.slice(-4)}` : text;
}

export function explorerTransaction(signature) {
  const cluster = SOLANA_CHAIN === 'solana:devnet' ? '?cluster=devnet' : '';
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

async function refreshStatus(status) {
  if (!status?.deployed) return loadProtocolStatus();
  const queueAccount = await rpc.getAccountInfo(status.addresses.queue, {
    commitment: 'finalized',
    encoding: 'base64',
  }).send();
  if (!queueAccount.value) throw new Error('The program queue is unavailable.');
  return { ...status, queue: decodeEventQueue(accountBytes(queueAccount.value)) };
}

async function refreshTraineeStatus(status) {
  if (!status?.deployed) return loadProtocolStatus();
  const queueAccount = await rpc.getAccountInfo(status.addresses.traineeQueue, {
    commitment: 'finalized',
    encoding: 'base64',
  }).send();
  if (!queueAccount.value) throw new Error('The trainee queue is unavailable.');
  return { ...status, traineeQueue: decodeEventQueue(accountBytes(queueAccount.value)) };
}

export async function loadDASAssets(owner, collection, fetchImplementation = fetch) {
  try {
    const matches = [];
    const limit = 1000;
    for (let page = 1; page <= 100; page += 1) {
      const response = await fetchImplementation(DAS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `fare-machines-${page}`,
          method: 'getAssetsByOwner',
          params: { ownerAddress: String(owner), page, limit },
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(body.error.message || 'DAS request failed');
      const items = body.result?.items;
      if (!Array.isArray(items)) throw new Error('DAS returned malformed assets');
      matches.push(...items.filter(item => (
        item.grouping?.some(group => group.group_key === 'collection' && group.group_value === String(collection))
      )));
      if (items.length < limit) return matches;
    }
    throw new Error('DAS pagination exceeded 100 pages');
  } catch (error) {
    throw new Error(`Could not load NFT cars. Check VITE_SOLANA_DAS_URL: ${error.message}`);
  }
}

function accountBytes(account) {
  const encoded = Array.isArray(account.data) ? account.data[0] : account.data;
  return base64Bytes(encoded);
}

function mintDecimals(bytes) {
  if (bytes.length < 45) throw new Error('Invalid reward mint data.');
  return bytes[44];
}

export function networkName() {
  return SOLANA_CHAIN === 'solana:devnet' ? 'devnet' : 'mainnet';
}

function className(weight) {
  return ({ 1: 'Economy', 3: 'Comfort', 10: 'Business', 30: 'Legend' })[weight] || 'Car';
}
