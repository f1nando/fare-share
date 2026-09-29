import { address, type Address } from '@solana/kit';
import type { TaxiDatabase } from './database.js';
import { loadProtocolDashboard } from './protocolDashboard.js';
import { solanaRpcCall } from './solanaRpc.js';

const CLASS_INDEX = new Map([[1, 0], [3, 1], [10, 2], [30, 3]]);
const SYNC_TTL_MS = 15_000;
const SNAPSHOT_BUCKET_MS = 5 * 60 * 1_000;
const HISTORY_PERIODS = {
  '24h': { durationMs: 24 * 60 * 60 * 1_000, groupMs: 60 * 60 * 1_000 },
  '7d': { durationMs: 7 * 24 * 60 * 60 * 1_000, groupMs: 6 * 60 * 60 * 1_000 },
  '30d': { durationMs: 30 * 24 * 60 * 60 * 1_000, groupMs: 24 * 60 * 60 * 1_000 },
} as const;

interface DasAsset {
  id: string;
  content?: {
    metadata?: { name?: string };
    links?: { image?: string };
    files?: Array<{ uri?: string; mime?: string }>;
  };
  ownership?: { owner?: string };
}

export class PublicDataError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'PublicDataError';
  }
}

export function createPublicDataService(config: {
  solanaRpcUrl: string;
  programId: Address;
  workerIntervalMs: number;
  fareSymbol: string;
}, database: TaxiDatabase) {
  let lastSyncAt = 0;
  let activeSync: Promise<void> | null = null;

  async function sync(force = false) {
    if (!force && Date.now() - lastSyncAt < SYNC_TTL_MS) return;
    if (activeSync) return activeSync;
    activeSync = (async () => {
      const worker = await database.workerStatus.findOne({ key: 'protocol-worker' });
      const dashboard = await loadProtocolDashboard(config.solanaRpcUrl, config.programId, worker, config.workerIntervalMs, config.fareSymbol);
      const assets = await loadAssets(config.solanaRpcUrl, dashboard.machines.map(machine => machine.asset));
      const assetsById = new Map(assets.map(asset => [asset.id, asset]));
      const now = new Date();
      if (dashboard.machines.length) {
        await database.fleetMachines.bulkWrite(dashboard.machines.map(machine => {
          const asset = assetsById.get(machine.asset);
          const owner = asset?.ownership?.owner;
          if (!owner) throw new Error(`DAS owner is unavailable for ${machine.asset}`);
          const classIndex = CLASS_INDEX.get(machine.weight);
          if (classIndex === undefined) throw new Error(`Unknown taxi weight ${machine.weight}`);
          return {
            updateOne: {
              filter: { asset: machine.asset },
              update: { $set: {
                asset: machine.asset,
                machine: machine.machine,
                owner,
                name: asset?.content?.metadata?.name || `${machine.className} Taxi`,
                image: asset?.content?.links?.image || asset?.content?.files?.find(file => file.mime?.startsWith('image/'))?.uri || '',
                className: machine.className,
                classIndex,
                weight: machine.weight,
                activeUntil: machine.activeUntil,
                rewardActive: machine.rewardActive,
                closed: machine.closed,
                claimable: machine.claimable,
                pending: machine.pending,
                fareBase: machine.fareBase,
                lastSeenAt: now,
                updatedAt: now,
              } },
              upsert: true,
            },
          };
        }));
        const pendingReceipts = await database.fleetMintReceipts.find({
          status: 'pending',
          asset: { $in: dashboard.machines.map(machine => machine.asset) },
        }).toArray();
        for (const receipt of pendingReceipts) {
          const machine = await database.fleetMachines.findOne({ asset: receipt.asset, owner: receipt.owner });
          if (!machine) continue;
          await Promise.all([
            database.fleetMachines.updateOne({ asset: receipt.asset }, { $set: {
              mintSignature: receipt.signature,
              mintedAt: receipt.blockTime,
              updatedAt: now,
            } }),
            database.fleetMintReceipts.updateOne({ signature: receipt.signature }, { $set: { status: 'indexed', updatedAt: now } }),
          ]);
        }
        await saveEarningSnapshots(database, now);
      }
      await database.publicSnapshots.updateOne({ key: 'overview' }, { $set: {
        key: 'overview',
        protocol: dashboard.protocol,
        distribution: dashboard.distribution,
        vaults: dashboard.vaults,
        observedAt: new Date(dashboard.observedAt),
        updatedAt: now,
      } }, { upsert: true });
      lastSyncAt = Date.now();
    })().finally(() => { activeSync = null; });
    return activeSync;
  }

  async function overview() {
    await sync();
    const [snapshot, machines] = await Promise.all([
      database.publicSnapshots.findOne({ key: 'overview' }),
      database.fleetMachines.find({ closed: false }).toArray(),
    ]);
    if (!snapshot) throw new PublicDataError('Public protocol snapshot is unavailable.', 503);
    const ownerRows = new Map<string, { owner: string; cars: number; activeWeight: number; claimableFareRaw: bigint }>();
    for (const machine of machines) {
      const row = ownerRows.get(machine.owner) || { owner: machine.owner, cars: 0, activeWeight: 0, claimableFareRaw: 0n };
      row.cars += 1;
      if (machine.rewardActive) row.activeWeight += machine.weight;
      row.claimableFareRaw += BigInt(machine.claimable[0] || '0');
      ownerRows.set(machine.owner, row);
    }
    const leaders = [...ownerRows.values()]
      .sort((left, right) => right.activeWeight - left.activeWeight || right.cars - left.cars || left.owner.localeCompare(right.owner))
      .slice(0, 100)
      .map(row => ({ ...row, claimableFareRaw: row.claimableFareRaw.toString() }));
    const classCounts = [0, 0, 0, 0];
    for (const machine of machines) classCounts[machine.classIndex] += 1;
    return {
      mint: {
        pricesLamports: Array.isArray(snapshot.protocol.mintPrices) ? snapshot.protocol.mintPrices.map(String) : [],
        mintedByClass: Array.isArray(snapshot.protocol.mintedByClass) ? snapshot.protocol.mintedByClass.map(Number) : [],
        paused: Boolean(snapshot.protocol.paused),
        saleStarted: Boolean(snapshot.protocol.saleStarted),
      },
      stats: {
        mintedCars: machines.length,
        activeCars: machines.filter(machine => machine.rewardActive).length,
        uniqueOwners: ownerRows.size,
        activeWeight: String(snapshot.distribution.activeWeight || '0'),
        treasurySolLamports: String(snapshot.vaults.solLamports || '0'),
        fundedRewardAssets: Array.isArray(snapshot.vaults.tokens)
          ? snapshot.vaults.tokens.filter(token => BigInt(String((token as { amount?: unknown }).amount || '0')) > 0n).length
          : 0,
      },
      classCounts,
      leaders,
      observedAt: snapshot.observedAt,
    };
  }

  async function walletFleet(rawOwner: string) {
    let owner: Address;
    try { owner = address(rawOwner); } catch { throw new PublicDataError('Invalid wallet address.'); }
    await sync(true);
    const [snapshot, machines] = await Promise.all([
      database.publicSnapshots.findOne({ key: 'overview' }),
      database.fleetMachines.find({ owner: String(owner), closed: false }).sort({ activeUntil: -1 }).toArray(),
    ]);
    if (!snapshot) throw new PublicDataError('Public protocol snapshot is unavailable.', 503);
    return {
      machines: machines.map(({ _id, lastSeenAt, updatedAt, ...machine }) => machine),
      assets: snapshot.distribution.assets,
      protocolNow: String(snapshot.distribution.protocolNow || '0'),
      observedAt: snapshot.observedAt,
    };
  }

  async function recordMint(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublicDataError('JSON object is required.');
    const body = input as Record<string, unknown>;
    const signature = String(body.signature || '').trim();
    const asset = String(body.asset || '').trim();
    const owner = String(body.owner || '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(signature)) throw new PublicDataError('Invalid transaction signature.');
    try { address(asset); address(owner); } catch { throw new PublicDataError('Invalid asset or owner address.'); }
    const statuses = await solanaRpcCall<{ value: Array<{ confirmationStatus?: string; err: unknown; slot: number } | null> }>(
      config.solanaRpcUrl,
      'getSignatureStatuses',
      [[signature], { searchTransactionHistory: true }],
    );
    const status = statuses.value[0];
    if (!status || status.err || status.confirmationStatus !== 'finalized') throw new PublicDataError('Mint transaction is not finalized.', 409);
    const transaction = await solanaRpcCall<{
      blockTime: number | null;
      transaction: { message: { accountKeys: Array<string | { pubkey: string; signer?: boolean }> } };
    } | null>(config.solanaRpcUrl, 'getTransaction', [signature, { commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
    if (!transaction) throw new PublicDataError('Mint transaction is unavailable.', 409);
    const keys = transaction.transaction.message.accountKeys;
    const keyStrings = keys.map(key => typeof key === 'string' ? key : key.pubkey);
    const ownerSigned = keys.some(key => typeof key !== 'string' && key.pubkey === owner && key.signer);
    if (!ownerSigned || !keyStrings.includes(String(config.programId)) || !keyStrings.includes(asset)) {
      throw new PublicDataError('Transaction does not match this mint program, owner, and asset.', 409);
    }
    const now = new Date();
    const blockTime = new Date((transaction.blockTime || Math.floor(Date.now() / 1000)) * 1000);
    await database.fleetMintReceipts.updateOne({ signature }, {
      $set: { asset, owner, slot: status.slot, blockTime, updatedAt: now },
      $setOnInsert: { signature, status: 'pending', createdAt: now },
    }, { upsert: true });
    await sync(true);
    const machine = await database.fleetMachines.findOne({ asset, owner });
    if (!machine) return { saved: true, indexed: false, asset, owner, signature };
    await database.fleetMachines.updateOne({ asset }, { $set: {
      mintSignature: signature,
      mintedAt: blockTime,
      updatedAt: now,
    } });
    await database.fleetMintReceipts.updateOne({ signature }, { $set: { status: 'indexed', updatedAt: now } });
    return { saved: true, indexed: true, asset, owner, signature };
  }

  async function earningHistory(rawOwner: string, rawPeriod = '24h') {
    let owner: Address;
    try { owner = address(rawOwner); } catch { throw new PublicDataError('Invalid wallet address.'); }
    if (!(rawPeriod in HISTORY_PERIODS)) throw new PublicDataError('History period must be 24h, 7d, or 30d.');
    const period = HISTORY_PERIODS[rawPeriod as keyof typeof HISTORY_PERIODS];
    await sync(true);
    const [snapshot, rows] = await Promise.all([
      database.publicSnapshots.findOne({ key: 'overview' }),
      database.fleetEarningSnapshots.find({
        owner: String(owner),
        bucketAt: { $gte: new Date(Date.now() - period.durationMs) },
      }).sort({ bucketAt: 1 }).toArray(),
    ]);
    const grouped = new Map<number, typeof rows[number]>();
    for (const row of rows) grouped.set(Math.floor(row.bucketAt.getTime() / period.groupMs) * period.groupMs, row);
    return {
      period: rawPeriod,
      assets: snapshot?.distribution.assets || [],
      points: [...grouped.entries()].map(([at, row]) => ({
        at: new Date(at).toISOString(),
        observedAt: row.observedAt,
        claimable: row.claimable,
        cars: row.cars,
        activeWeight: row.activeWeight,
      })),
    };
  }

  async function market() {
    await sync();
    return { listings: [], floorLamports: null, totalVolumeLamports: '0' };
  }

  return { overview, walletFleet, recordMint, earningHistory, market, sync };
}

async function saveEarningSnapshots(database: TaxiDatabase, observedAt: Date) {
  const machines = await database.fleetMachines.find({ closed: false }).toArray();
  const owners = new Map<string, { claimable: bigint[]; cars: number; activeWeight: number }>();
  for (const machine of machines) {
    const aggregate = owners.get(machine.owner) || { claimable: [0n, 0n, 0n, 0n, 0n], cars: 0, activeWeight: 0 };
    aggregate.cars += 1;
    if (machine.rewardActive) aggregate.activeWeight += machine.weight;
    machine.claimable.forEach((amount, index) => { aggregate.claimable[index] += BigInt(amount || '0'); });
    owners.set(machine.owner, aggregate);
  }
  if (!owners.size) return;
  const bucketAt = new Date(Math.floor(observedAt.getTime() / SNAPSHOT_BUCKET_MS) * SNAPSHOT_BUCKET_MS);
  await database.fleetEarningSnapshots.bulkWrite([...owners].map(([owner, aggregate]) => ({
    updateOne: {
      filter: { owner, bucketAt },
      update: {
        $set: {
          observedAt,
          claimable: aggregate.claimable.map(String),
          cars: aggregate.cars,
          activeWeight: aggregate.activeWeight,
          updatedAt: observedAt,
        },
        $setOnInsert: { owner, bucketAt, createdAt: observedAt },
      },
      upsert: true,
    },
  })));
}

async function loadAssets(rpcUrl: string, ids: string[]): Promise<DasAsset[]> {
  if (!ids.length) return [];
  const result = await solanaRpcCall<Array<DasAsset | null>>(rpcUrl, 'getAssetBatch', [ids]);
  return result.filter((asset): asset is DasAsset => Boolean(asset));
}
