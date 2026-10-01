import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { address, getBase58Encoder, type Address } from '@solana/kit';
import type { FleetMachineDocument, PublicSnapshotDocument, TaxiDatabase } from './database.js';
import { loadProtocolDashboard } from './protocolDashboard.js';
import { solanaRpcCall } from './solanaRpc.js';

const CLASS_INDEX = new Map([[1, 0], [3, 1], [10, 2], [30, 3]]);
const SYNC_TTL_MS = 15_000;
const OVERVIEW_CACHE_TTL_MS = 30_000;
const DAS_BATCH_SIZE = 1_000;
const SNAPSHOT_BUCKET_MS = 5 * 60 * 1_000;
const MARKET_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const MAX_MARKET_PRICE_LAMPORTS = 1_000_000n * 1_000_000_000n;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const HISTORY_PERIODS = {
  '24h': { durationMs: 24 * 60 * 60 * 1_000, groupMs: 60 * 60 * 1_000 },
  '7d': { durationMs: 7 * 24 * 60 * 60 * 1_000, groupMs: 6 * 60 * 60 * 1_000 },
  '30d': { durationMs: 30 * 24 * 60 * 60 * 1_000, groupMs: 24 * 60 * 60 * 1_000 },
} as const;

export interface DasAsset {
  id: string;
  content?: {
    metadata?: { name?: string };
    links?: { image?: string };
    files?: Array<{ uri?: string; mime?: string }>;
  };
  ownership?: { owner?: string };
  grouping?: Array<{ group_key?: string; group_value?: string }>;
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
  fareSymbol: string | (() => string);
  loadMarketAsset?: (asset: string) => Promise<DasAsset | null>;
}, database: TaxiDatabase) {
  let lastSyncAt = 0;
  let activeSync: Promise<void> | null = null;
  let activeOverviewRead: Promise<PublicOverview> | null = null;
  let cachedOverview: { value: PublicOverview; expiresAt: number } | null = null;

  async function sync(force = false) {
    if (!force && Date.now() - lastSyncAt < SYNC_TTL_MS) return;
    if (activeSync) return activeSync;
    activeSync = (async () => {
      const worker = await database.workerStatus.findOne({ key: 'protocol-worker' });
      const fareSymbol = typeof config.fareSymbol === 'function' ? config.fareSymbol() : config.fareSymbol;
      const dashboard = await loadProtocolDashboard(config.solanaRpcUrl, config.programId, worker, config.workerIntervalMs, fareSymbol);
      const assets = await loadAssets(config.solanaRpcUrl, [
        ...dashboard.machines.map(machine => machine.asset),
        ...dashboard.trainees.map(trainee => trainee.asset),
      ]);
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
      }
      if (dashboard.trainees.length) {
        await database.fleetTrainees.bulkWrite(dashboard.trainees.map(trainee => {
          const asset = assetsById.get(trainee.asset);
          validateTraineeAsset(asset, trainee.owner, String(dashboard.protocol.collection));
          return {
            updateOne: {
              filter: { asset: trainee.asset },
              update: { $set: {
                ...trainee,
                name: asset?.content?.metadata?.name || 'TAXI Trainee',
                image: asset?.content?.links?.image || asset?.content?.files?.find(file => file.mime?.startsWith('image/'))?.uri || '',
                lastSeenAt: now,
                updatedAt: now,
              } },
              upsert: true,
            },
          };
        }));
      }
      const snapshot = {
        key: 'overview',
        protocol: dashboard.protocol,
        distribution: dashboard.distribution,
        vaults: dashboard.vaults,
        observedAt: new Date(dashboard.observedAt),
        updatedAt: now,
      } satisfies Omit<PublicSnapshotDocument, 'overview'>;
      const machines = await database.fleetMachines.find({ closed: false }).toArray();
      if (dashboard.machines.length) await saveEarningSnapshots(database, now, machines);
      const preparedOverview = buildPublicOverview(snapshot, machines, fareSymbol);
      await database.publicSnapshots.updateOne({ key: 'overview' }, { $set: {
        ...snapshot,
        overview: preparedOverview,
      } }, { upsert: true });
      cachedOverview = { value: preparedOverview, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS };
      lastSyncAt = Date.now();
    })().finally(() => { activeSync = null; });
    return activeSync;
  }

  async function overview() {
    if (cachedOverview && cachedOverview.expiresAt > Date.now()) return cachedOverview.value;
    if (activeOverviewRead) return activeOverviewRead;
    activeOverviewRead = (async () => {
      const snapshot = await database.publicSnapshots.findOne({ key: 'overview' });
      if (!snapshot) throw new PublicDataError('Public protocol snapshot is unavailable.', 503);
      const value = snapshot.overview as PublicOverview | undefined
        || buildPublicOverview(
          snapshot,
          await database.fleetMachines.find({ closed: false }).toArray(),
          typeof config.fareSymbol === 'function' ? config.fareSymbol() : config.fareSymbol,
        );
      cachedOverview = { value, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS };
      return value;
    })().finally(() => { activeOverviewRead = null; });
    return activeOverviewRead;
  }

  async function walletFleet(rawOwner: string) {
    let owner: Address;
    try { owner = address(rawOwner); } catch { throw new PublicDataError('Invalid wallet address.'); }
    const [snapshot, machines, trainees] = await Promise.all([
      database.publicSnapshots.findOne({ key: 'overview' }),
      database.fleetMachines.find({ owner: String(owner), closed: false }).sort({ activeUntil: -1 }).toArray(),
      database.fleetTrainees.find({ owner: String(owner) }).sort({ activeUntil: -1 }).toArray(),
    ]);
    if (!snapshot) throw new PublicDataError('Public protocol snapshot is unavailable.', 503);
    return {
      machines: machines.map(({ _id, lastSeenAt, updatedAt, ...machine }) => machine),
      trainees: trainees.map(({ _id, lastSeenAt, updatedAt, ...trainee }) => trainee),
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
    const rows = await database.marketListings.find({ status: 'active' }).sort({ listedAt: -1 }).limit(250).toArray();
    const machines = rows.length
      ? await database.fleetMachines.find({ asset: { $in: rows.map(row => row.asset) }, closed: false }).toArray()
      : [];
    const machinesByAsset = new Map(machines.map(machine => [machine.asset, machine]));
    const listings = rows.flatMap(row => {
      const machine = machinesByAsset.get(row.asset);
      if (!machine || machine.owner !== row.seller) return [];
      return [{
        id: row.asset,
        asset: row.asset,
        seller: row.seller,
        priceLamports: row.priceLamports,
        listedAt: row.listedAt.getTime(),
        name: machine.name,
        imageUrl: machine.image,
        className: machine.className,
        nftNumber: Number(machine.name.match(/#(\d+)$/)?.[1] || 0),
      }];
    });
    const floorLamports = listings.reduce<bigint | null>((floor, listing) => {
      const price = BigInt(listing.priceLamports);
      return floor === null || price < floor ? price : floor;
    }, null);
    return { listings, floorLamports: floorLamports?.toString() ?? null, totalVolumeLamports: '0' };
  }

  async function marketChallenge(input: unknown) {
    const body = marketBody(input);
    const action = body.action === 'cancel' ? 'cancel' : body.action === 'list' ? 'list' : null;
    if (!action) throw new PublicDataError('Market action must be list or cancel.');
    let owner: Address;
    let asset: Address;
    try { owner = address(body.owner); asset = address(body.asset); } catch { throw new PublicDataError('Invalid owner or asset address.'); }
    const machine = await database.fleetMachines.findOne({ asset: String(asset), closed: false });
    if (!machine) throw new PublicDataError('This asset is not a transferable Fare Share taxi.', 404);
    let priceLamports: string | undefined;
    if (action === 'list') {
      priceLamports = validMarketPrice(body.priceLamports);
      const loadAsset = config.loadMarketAsset || (id => solanaRpcCall<DasAsset | null>(config.solanaRpcUrl, 'getAsset', [{ id }]));
      const liveAsset = await loadAsset(String(asset));
      if (!liveAsset || liveAsset.ownership?.owner !== String(owner)) {
        throw new PublicDataError('The connected wallet is not the current on-chain owner of this taxi.', 409);
      }
    } else {
      const listing = await database.marketListings.findOne({ asset: String(asset), seller: String(owner), status: 'active' });
      if (!listing) throw new PublicDataError('Active listing not found.', 404);
    }
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + MARKET_CHALLENGE_TTL_MS);
    const message = marketMessage({ action, owner: String(owner), asset: String(asset), priceLamports, nonce, expiresAt });
    await database.marketNonces.insertOne({ nonce, action, owner: String(owner), asset: String(asset), priceLamports, message, expiresAt, createdAt: new Date() });
    return { nonce, message, expiresAt: expiresAt.toISOString() };
  }

  async function submitMarketAction(input: unknown) {
    const body = marketBody(input);
    let owner: Address;
    try { owner = address(body.owner); } catch { throw new PublicDataError('Invalid owner address.'); }
    if (!/^[0-9a-f-]{36}$/i.test(body.nonce)) throw new PublicDataError('Invalid market challenge.');
    if (!/^[A-Za-z0-9+/]{86}==$/.test(body.signature)) throw new PublicDataError('Invalid wallet signature.');
    const challenge = await database.marketNonces.findOne({ nonce: body.nonce, owner: String(owner) });
    if (!challenge || challenge.expiresAt.getTime() <= Date.now()) throw new PublicDataError('Market challenge expired. Request a new one.', 409);
    if (!verifyMarketSignature(String(owner), challenge.message, body.signature)) throw new PublicDataError('Wallet signature is invalid.', 401);
    const consumed = await database.marketNonces.findOneAndDelete({ nonce: challenge.nonce, owner: String(owner) });
    if (!consumed) throw new PublicDataError('Market challenge was already used.', 409);
    const now = new Date();
    if (challenge.action === 'cancel') {
      const result = await database.marketListings.updateOne(
        { asset: challenge.asset, seller: challenge.owner, status: 'active' },
        { $set: { status: 'cancelled', updatedAt: now } },
      );
      if (!result.matchedCount) throw new PublicDataError('Active listing not found.', 404);
      return { listed: false, asset: challenge.asset };
    }
    const loadAsset = config.loadMarketAsset || (id => solanaRpcCall<DasAsset | null>(config.solanaRpcUrl, 'getAsset', [{ id }]));
    const liveAsset = await loadAsset(challenge.asset);
    if (!liveAsset || liveAsset.ownership?.owner !== challenge.owner) {
      throw new PublicDataError('Taxi ownership changed before the listing was saved.', 409);
    }
    await database.marketListings.updateOne({ asset: challenge.asset }, {
      $set: { asset: challenge.asset, seller: challenge.owner, priceLamports: challenge.priceLamports!, status: 'active', listedAt: now, updatedAt: now },
    }, { upsert: true });
    return { listed: true, asset: challenge.asset, priceLamports: challenge.priceLamports };
  }

  return { overview, walletFleet, recordMint, earningHistory, market, marketChallenge, submitMarketAction, sync };
}

function marketBody(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublicDataError('JSON object is required.');
  const body = input as Record<string, unknown>;
  return Object.fromEntries(['action', 'owner', 'asset', 'priceLamports', 'nonce', 'signature'].map(key => [key, String(body[key] || '').trim()])) as Record<'action' | 'owner' | 'asset' | 'priceLamports' | 'nonce' | 'signature', string>;
}

function validMarketPrice(raw: string) {
  if (!/^[1-9]\d*$/.test(raw)) throw new PublicDataError('Price must be greater than zero.');
  const value = BigInt(raw);
  if (value > MAX_MARKET_PRICE_LAMPORTS) throw new PublicDataError('Price is above the marketplace limit.');
  return value.toString();
}

function marketMessage(input: { action: 'list' | 'cancel'; owner: string; asset: string; priceLamports?: string; nonce: string; expiresAt: Date }) {
  return [
    'Fare Share Market',
    `Action: ${input.action}`,
    `Owner: ${input.owner}`,
    `Asset: ${input.asset}`,
    ...(input.action === 'list' ? [`Price lamports: ${input.priceLamports}`] : []),
    `Nonce: ${input.nonce}`,
    `Expires at: ${input.expiresAt.toISOString()}`,
  ].join('\n');
}

export function verifyMarketSignature(owner: string, message: string, signatureBase64: string) {
  try {
    const publicKeyBytes = Buffer.from(getBase58Encoder().encode(owner));
    const signature = Buffer.from(signatureBase64, 'base64');
    if (publicKeyBytes.length !== 32 || signature.length !== 64) return false;
    const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(message, 'utf8'), publicKey, signature);
  } catch {
    return false;
  }
}

export function validateTraineeAsset(asset: DasAsset | undefined, expectedOwner: string, expectedCollection: string) {
  if (!asset || asset.id === '' || asset.ownership?.owner !== expectedOwner) {
    throw new Error('Trainee Core asset owner does not match its on-chain Trainee account');
  }
  const collection = asset.grouping?.find(item => item.group_key === 'collection')?.group_value;
  if (collection !== expectedCollection) {
    throw new Error('Trainee Core asset is not in the configured collection');
  }
}

export function buildPublicOverview(
  snapshot: Pick<PublicSnapshotDocument, 'protocol' | 'distribution' | 'vaults' | 'observedAt'>,
  machines: FleetMachineDocument[],
  fareTicker = 'FARE',
) {
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
      mintPricesUsdCents: Array.isArray(snapshot.protocol.mintPricesUsdCents)
        ? snapshot.protocol.mintPricesUsdCents.map(String)
        : Array.isArray(snapshot.protocol.mintPrices) ? snapshot.protocol.mintPrices.map(String) : [],
      fareMint: String(snapshot.protocol.fareMint || ''),
      fareTicker,
      fareDecimals: Array.isArray(snapshot.distribution.assets)
        ? Number((snapshot.distribution.assets[0] as { decimals?: unknown } | undefined)?.decimals ?? 0)
        : 0,
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

type PublicOverview = ReturnType<typeof buildPublicOverview>;

async function saveEarningSnapshots(database: TaxiDatabase, observedAt: Date, machines: FleetMachineDocument[]) {
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
  const assets: DasAsset[] = [];
  for (let offset = 0; offset < ids.length; offset += DAS_BATCH_SIZE) {
    const result = await solanaRpcCall<Array<DasAsset | null>>(rpcUrl, 'getAssetBatch', [ids.slice(offset, offset + DAS_BATCH_SIZE)]);
    assets.push(...result.filter((asset): asset is DasAsset => Boolean(asset)));
  }
  return assets;
}
