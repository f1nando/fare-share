import { createHash } from 'node:crypto';
import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, getUtf8Encoder, type Address } from '@solana/kit';
import type { FleetMachineDocument, PublicSnapshotDocument, TaxiDatabase } from './database.js';
import { jupiterRequest } from './jupiterHttp.js';
import { decodeDashboardMachine, decodeDashboardPool, loadProtocolDashboard } from './protocolDashboard.js';
import { solanaRpcCall } from './solanaRpc.js';
import { protocolAddresses } from './setup.js';

const CLASS_INDEX = new Map([[1, 0], [3, 1], [10, 2], [30, 3]]);
const SYNC_TTL_MS = 15_000;
const MARKET_SYNC_TTL_MS = 5_000;
const OVERVIEW_CACHE_TTL_MS = 30_000;
const DAS_BATCH_SIZE = 1_000;
const SNAPSHOT_BUCKET_MS = 5 * 60 * 1_000;
const MARKET_LISTING_ACCOUNT_SIZE = 81;
const MARKET_LISTING_DISCRIMINATOR_BASE58 = 'WMPLAdohQsZ';
const MARKET_OFFER_ACCOUNT_SIZE = 82;
const MARKET_OFFER_DISCRIMINATOR_BASE58 = 'ajwsU7aDXDU';
const CLASS_NAME_BY_WEIGHT = new Map([[1, 'Economy'], [3, 'Comfort'], [10, 'Business'], [30, 'Legend']]);
const MODEL_NAMES = [
  ['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'],
  ['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'],
  ['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'],
  ['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'],
] as const;
const MODEL_CLASS_WEIGHTS = [1, 3, 10, 30] as const;
const REWARDS_CLAIMED_DISCRIMINATOR = createHash('sha256').update('event:RewardsClaimed').digest().subarray(0, 8);
const TRAINEE_REWARDS_CLAIMED_DISCRIMINATOR = createHash('sha256').update('event:TraineeRewardsClaimed').digest().subarray(0, 8);
const utf8 = getUtf8Encoder();
const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();
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
  assetLoader?: (rpcUrl: string, ids: string[]) => Promise<DasAsset[]>;
    taxiIndexRefresher?: () => Promise<void>;
    mintReceiptVerifier?: (signature: string, asset: string, owner: string) => Promise<{ slot: number; blockTime: Date }>;
    mintMachineLoader?: (asset: string, owner: string) => Promise<FleetMachineDocument | null>;
    jupiterApiKey?: string;
    usdPriceLoader?: (mints: string[]) => Promise<Map<string, number>>;
  }, database: TaxiDatabase) {
  let lastSyncAt = 0;
  let activeSync: Promise<void> | null = null;
  let lastMarketSyncAt = 0;
  let activeMarketSync: Promise<void> | null = null;
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
      const rewardAssets = dashboard.vaults.tokens.map(token => ({ mint: token.mint, decimals: token.decimals }));
      await syncRewardClaims(config.solanaRpcUrl, config.programId, database, rewardAssets);
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
      await syncMarket(true);
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
      const claimedUsdByOwner = await loadLifetimeClaimUsd(
        database,
        config.usdPriceLoader || (mints => loadUsdPrices(mints, config.jupiterApiKey)),
      );
      const preparedOverview = buildPublicOverview(snapshot, machines, fareSymbol, claimedUsdByOwner);
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
    const [snapshot, storedMachines, trainees] = await Promise.all([
      database.publicSnapshots.findOne({ key: 'overview' }),
      database.fleetMachines.find({ owner: String(owner), closed: false }).sort({ activeUntil: -1 }).toArray(),
      database.fleetTrainees.find({ owner: String(owner) }).sort({ activeUntil: -1 }).toArray(),
    ]);
    if (!snapshot) throw new PublicDataError('Public protocol snapshot is unavailable.', 503);
    const liveAssets = await (config.assetLoader || loadAssets)(config.solanaRpcUrl, storedMachines.map(machine => machine.asset));
    const liveOwners = new Map(liveAssets.map(asset => [asset.id, asset.ownership?.owner]));
    const ownershipChanges = storedMachines.filter(machine => liveOwners.get(machine.asset) && liveOwners.get(machine.asset) !== machine.owner);
    if (ownershipChanges.length) {
      const now = new Date();
      await database.fleetMachines.bulkWrite(ownershipChanges.map(machine => ({
        updateOne: {
          filter: { asset: machine.asset },
          update: { $set: { owner: liveOwners.get(machine.asset)!, updatedAt: now } },
        },
      })));
    }
    const machines = storedMachines.filter(machine => liveOwners.get(machine.asset) === String(owner));
    return {
      machines: machines.map(({ _id, lastSeenAt, updatedAt, ...machine }) => machine),
      trainees: trainees.map(({ _id, lastSeenAt, updatedAt, ...trainee }) => trainee),
      assets: snapshot.distribution.assets,
      protocolNow: String(snapshot.distribution.protocolNow || '0'),
      observedAt: snapshot.observedAt,
    };
  }

  async function taxi(rawIdentifier: string) {
    const identifier = rawIdentifier.trim();
    if (!identifier) throw new PublicDataError('Enter an NFT address or number.');
    const numberMatch = /^#?(\d{1,4})$/.exec(identifier);
    let machine: FleetMachineDocument | null;
    let findMachine: () => Promise<FleetMachineDocument | null>;
    if (numberMatch) {
      const nftNumber = Number(numberMatch[1]);
      if (nftNumber < 1) return { minted: false, error: 'NFT number must be greater than zero.' };
      findMachine = () => database.fleetMachines.findOne({
        name: { $regex: new RegExp(`#${String(nftNumber).padStart(4, '0')}$`) },
        closed: false,
      });
    } else {
      let asset: Address;
      try { asset = address(identifier); } catch { return { minted: false, error: 'Enter a valid NFT address or minted NFT number.' }; }
      findMachine = () => database.fleetMachines.findOne({ asset: String(asset), closed: false });
    }
    machine = await findMachine();
    if (!machine) {
      await (config.taxiIndexRefresher ? config.taxiIndexRefresher() : sync());
      machine = await findMachine();
    }
    if (!machine) return { minted: false, error: 'This NFT has not been minted yet or is unavailable.' };
    return {
      asset: machine.asset,
      owner: machine.owner,
      name: machine.name,
      imageUrl: machine.image,
      className: machine.className,
      weight: machine.weight,
      nftNumber: Number(machine.name.match(/#(\d+)$/)?.[1] || 0),
      minted: true,
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
    const verified = config.mintReceiptVerifier
      ? await config.mintReceiptVerifier(signature, asset, owner)
      : await verifyMintReceipt(config.solanaRpcUrl, config.programId, signature, asset, owner);
    const now = new Date();
    const blockTime = verified.blockTime;
    await database.fleetMintReceipts.updateOne({ signature }, {
      $set: { asset, owner, slot: verified.slot, blockTime, updatedAt: now },
      $setOnInsert: { signature, status: 'pending', createdAt: now },
    }, { upsert: true });
    let machine: FleetMachineDocument | null = await database.fleetMachines.findOne({ asset, owner });
    if (!machine) {
      try {
        machine = config.mintMachineLoader
          ? await config.mintMachineLoader(asset, owner)
          : await loadMintMachine(config.solanaRpcUrl, config.programId, asset, owner, config.assetLoader || loadAssets);
        if (machine) {
          await database.fleetMachines.updateOne(
            { asset },
            { $set: machine },
            { upsert: true },
          );
        }
      } catch (error) {
        console.warn(`Targeted mint indexing failed for ${asset}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
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
    const [rows, offerRows] = await Promise.all([
      database.marketListings.find({ status: 'active' }).sort({ listedAt: -1 }).toArray(),
      database.marketOffers.find({ status: 'active' }).sort({ updatedAt: -1 }).toArray(),
    ]);
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
    const offerAssets = offerRows.flatMap(offer => offer.asset ? [offer.asset] : []);
    const offerMachines = offerAssets.length
      ? await database.fleetMachines.find({ asset: { $in: offerAssets }, closed: false }).toArray()
      : [];
    const offerMachinesByAsset = new Map(offerMachines.map(machine => [machine.asset, machine]));
    const offers = offerRows.map(offer => {
      const machine = offer.asset ? offerMachinesByAsset.get(offer.asset) : undefined;
      return {
        id: offer.offer,
        kind: offer.kind,
        buyer: offer.buyer,
        asset: offer.asset,
        weight: offer.weight,
        className: offer.weight ? CLASS_NAME_BY_WEIGHT.get(offer.weight) : machine?.className,
        modelName: offer.modelName,
        priceLamports: offer.priceLamports,
        createdAt: offer.createdAt.getTime(),
        name: machine?.name,
        imageUrl: machine?.image,
        owner: machine?.owner,
        nftNumber: Number(machine?.name.match(/#(\d+)$/)?.[1] || 0),
      };
    });
    return { listings, offers, floorLamports: floorLamports?.toString() ?? null, totalVolumeLamports: '0' };
  }

  async function syncMarket(force = false) {
    if (!force && Date.now() - lastMarketSyncAt < MARKET_SYNC_TTL_MS) return;
    if (activeMarketSync) return activeMarketSync;
    activeMarketSync = (async () => {
      const now = new Date();
      await Promise.all([
        syncMarketListings(config.solanaRpcUrl, config.programId, database, now),
        syncMarketOffers(config.solanaRpcUrl, config.programId, database, now),
      ]);
      lastMarketSyncAt = Date.now();
    })().finally(() => { activeMarketSync = null; });
    return activeMarketSync;
  }

  async function recordMarketTransaction(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublicDataError('JSON object is required.');
    const body = input as Record<string, unknown>;
    const action = String(body.action || '');
    const signature = String(body.signature || '').trim();
    let asset: Address | undefined;
    let actor: Address;
    try {
      actor = address(String(body.actor || ''));
      if (body.asset) asset = address(String(body.asset));
    } catch { throw new PublicDataError('Invalid asset or wallet address.'); }
    const offerActions = ['offer-asset', 'offer-class', 'offer-model', 'cancel-offer', 'accept-offer'];
    if (![...offerActions, 'list', 'cancel', 'buy'].includes(action)) throw new PublicDataError('Invalid marketplace action.');
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(signature)) throw new PublicDataError('Invalid transaction signature.');
    const statuses = await solanaRpcCall<{ value: Array<{ confirmationStatus?: string; err: unknown } | null> }>(config.solanaRpcUrl, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
    const status = statuses.value[0];
    if (!status || status.err || status.confirmationStatus !== 'finalized') throw new PublicDataError('Marketplace transaction is not finalized.', 409);
    const transaction = await solanaRpcCall<{ transaction: { message: { accountKeys: Array<string | { pubkey: string; signer?: boolean }> } } } | null>(
      config.solanaRpcUrl,
      'getTransaction',
      [signature, { commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
    );
    const keys = transaction?.transaction.message.accountKeys || [];
    const keyStrings = keys.map(key => typeof key === 'string' ? key : key.pubkey);
    const actorSigned = keys.some(key => typeof key !== 'string' && key.pubkey === String(actor) && key.signer);
    if (!actorSigned || !keyStrings.includes(String(config.programId)) || (asset && !keyStrings.includes(String(asset)))) {
      throw new PublicDataError('Transaction does not match this marketplace action.', 409);
    }
    if (offerActions.includes(action)) {
      let offer: Address;
      try { offer = address(String(body.offer || '')); } catch { throw new PublicDataError('Invalid offer address.'); }
      if (!keyStrings.includes(String(offer))) throw new PublicDataError('Transaction does not contain this offer.', 409);
      if (action === 'accept-offer') {
        if (!asset) throw new PublicDataError('Asset address is required.');
        await refreshMachineOwner(asset, actor);
      }
      await syncMarket(true);
      return { offer: String(offer), active: action === 'offer-asset' || action === 'offer-class' || action === 'offer-model' };
    }
    if (!asset) throw new PublicDataError('Asset address is required.');
    const [listingAddress] = await getProgramDerivedAddress({ programAddress: config.programId, seeds: [utf8.encode('listing'), addressEncoder.encode(asset)] });
    const listingResponse = await solanaRpcCall<{ value: { owner: string; data: [string, string] } | null }>(
      config.solanaRpcUrl,
      'getAccountInfo',
      [String(listingAddress), { commitment: 'finalized', encoding: 'base64' }],
    );
    const now = new Date();
    if (action === 'list') {
      if (!listingResponse.value || listingResponse.value.owner !== String(config.programId)) throw new PublicDataError('On-chain listing account was not found.', 409);
      const listing = decodeMarketListing(Buffer.from(listingResponse.value.data[0], 'base64'));
      if (listing.asset !== String(asset) || listing.seller !== String(actor)) throw new PublicDataError('On-chain listing does not match this wallet and asset.', 409);
      await database.marketListings.updateOne({ asset: String(asset) }, { $set: {
        asset: String(asset), seller: String(actor), priceLamports: listing.priceLamports, status: 'active', listedAt: now, updatedAt: now, transactionSignature: signature,
      } }, { upsert: true });
      return { listed: true, asset: String(asset), priceLamports: listing.priceLamports };
    }
    if (listingResponse.value) throw new PublicDataError('On-chain listing is still active.', 409);
    const current = await database.marketListings.findOne({ asset: String(asset), status: 'active' });
    if (!current) throw new PublicDataError('Active listing not found.', 404);
    if (action === 'cancel' && current.seller !== String(actor)) throw new PublicDataError('Only the seller can cancel this listing.', 401);
    if (action === 'buy') {
      const liveAsset = await solanaRpcCall<DasAsset | null>(config.solanaRpcUrl, 'getAsset', [{ id: String(asset) }]);
      if (liveAsset?.ownership?.owner !== String(actor)) throw new PublicDataError('On-chain purchase owner does not match the buyer.', 409);
      await database.fleetMachines.updateOne({ asset: String(asset) }, { $set: { owner: String(actor), updatedAt: now } });
    }
    await database.marketListings.updateOne({ asset: String(asset), status: 'active' }, { $set: { status: 'cancelled', updatedAt: now, transactionSignature: signature } });
    return { listed: false, asset: String(asset) };
  }

  async function refreshMachineOwner(asset: Address, previousOwner: Address) {
    const liveAsset = await solanaRpcCall<DasAsset | null>(config.solanaRpcUrl, 'getAsset', [{ id: String(asset) }]);
    const owner = liveAsset?.ownership?.owner;
    if (!owner || owner === String(previousOwner)) throw new PublicDataError('On-chain sale owner has not updated yet.', 409);
    await database.fleetMachines.updateOne({ asset: String(asset) }, { $set: { owner, updatedAt: new Date() } });
  }

  return { overview, walletFleet, taxi, recordMint, earningHistory, market, recordMarketTransaction, sync, syncMarket };
}

async function verifyMintReceipt(rpcUrl: string, programId: Address, signature: string, asset: string, owner: string) {
  const statuses = await solanaRpcCall<{ value: Array<{ confirmationStatus?: string; err: unknown; slot: number } | null> }>(
    rpcUrl,
    'getSignatureStatuses',
    [[signature], { searchTransactionHistory: true }],
  );
  const status = statuses.value[0];
  if (!status || status.err || status.confirmationStatus !== 'finalized') throw new PublicDataError('Mint transaction is not finalized.', 409);
  const transaction = await solanaRpcCall<{
    blockTime: number | null;
    transaction: { message: { accountKeys: Array<string | { pubkey: string; signer?: boolean }> } };
  } | null>(rpcUrl, 'getTransaction', [signature, { commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
  if (!transaction) throw new PublicDataError('Mint transaction is unavailable.', 409);
  const keys = transaction.transaction.message.accountKeys;
  const keyStrings = keys.map(key => typeof key === 'string' ? key : key.pubkey);
  const ownerSigned = keys.some(key => typeof key !== 'string' && key.pubkey === owner && key.signer);
  if (!ownerSigned || !keyStrings.includes(String(programId)) || !keyStrings.includes(asset)) {
    throw new PublicDataError('Transaction does not match this mint program, owner, and asset.', 409);
  }
  return {
    slot: status.slot,
    blockTime: new Date((transaction.blockTime || Math.floor(Date.now() / 1000)) * 1000),
  };
}

async function loadMintMachine(
  rpcUrl: string,
  programId: Address,
  rawAsset: string,
  owner: string,
  assetLoader: (rpcUrl: string, ids: string[]) => Promise<DasAsset[]>,
): Promise<FleetMachineDocument | null> {
  const asset = address(rawAsset);
  const [[machine], addresses] = await Promise.all([
    getProgramDerivedAddress({
      programAddress: programId,
      seeds: [utf8.encode('machine'), Uint8Array.from(addressEncoder.encode(asset))],
    }),
    protocolAddresses(programId),
  ]);
  const accounts = await solanaRpcCall<{ value: Array<{ data: [string, string] } | null> }>(rpcUrl, 'getMultipleAccounts', [
    [String(machine), String(addresses.pool)],
    { commitment: 'finalized', encoding: 'base64' },
  ]);
  const [machineAccount, poolAccount] = accounts.value;
  if (!machineAccount || !poolAccount) return null;
  const pool = decodeDashboardPool(Uint8Array.from(Buffer.from(poolAccount.data[0], 'base64')));
  const state = decodeDashboardMachine(Uint8Array.from(Buffer.from(machineAccount.data[0], 'base64')), pool);
  if (String(state.asset) !== rawAsset) return null;
  const metadata = (await assetLoader(rpcUrl, [rawAsset])).find(item => item.id === rawAsset);
  if (!metadata || metadata.ownership?.owner !== owner) return null;
  const classIndex = CLASS_INDEX.get(state.weight);
  if (classIndex === undefined) throw new Error(`Unknown taxi weight ${state.weight}`);
  const now = new Date();
  const className = CLASS_NAME_BY_WEIGHT.get(state.weight) || `Weight ${state.weight}`;
  return {
    asset: rawAsset,
    machine: String(machine),
    owner,
    name: metadata.content?.metadata?.name || `${className} Taxi`,
    image: metadata.content?.links?.image || metadata.content?.files?.find(file => file.mime?.startsWith('image/'))?.uri || '',
    className,
    classIndex,
    weight: state.weight,
    activeUntil: state.activeUntil.toString(),
    rewardActive: state.rewardActive,
    closed: state.closed,
    claimable: state.claimable.map(String),
    pending: state.pending.map(String),
    fareBase: state.fareBase.toString(),
    lastSeenAt: now,
    updatedAt: now,
  };
}

function decodeMarketListing(bytes: Uint8Array) {
  if (bytes.length < 81) throw new PublicDataError('On-chain listing data is invalid.', 409);
  return {
    seller: addressDecoder.decode(bytes.subarray(8, 40)),
    asset: addressDecoder.decode(bytes.subarray(40, 72)),
    priceLamports: new DataView(bytes.buffer, bytes.byteOffset + 72, 8).getBigUint64(0, true).toString(),
  };
}

function decodeMarketOffer(offer: string, bytes: Uint8Array) {
  if (bytes.length < MARKET_OFFER_ACCOUNT_SIZE) throw new PublicDataError('On-chain offer data is invalid.', 409);
  const kindValue = bytes[40];
  const target = bytes.subarray(41, 73);
  if (kindValue !== 0 && kindValue !== 1 && kindValue !== 2) throw new PublicDataError('On-chain offer kind is invalid.', 409);
  const weight = kindValue === 1 ? new DataView(target.buffer, target.byteOffset, 2).getUint16(0, true) : undefined;
  if (weight !== undefined && !CLASS_NAME_BY_WEIGHT.has(weight)) throw new PublicDataError('On-chain class offer is invalid.', 409);
  const modelClass = kindValue === 2 ? target[0] : undefined;
  const modelVariant = kindValue === 2 ? target[1] : undefined;
  const modelName = modelClass === undefined || modelVariant === undefined ? undefined : MODEL_NAMES[modelClass]?.[modelVariant];
  if (kindValue === 2 && (!modelName || target.slice(2).some(value => value !== 0))) {
    throw new PublicDataError('On-chain model offer is invalid.', 409);
  }
  return {
    offer,
    buyer: String(addressDecoder.decode(bytes.subarray(8, 40))),
    kind: kindValue === 0 ? 'asset' as const : kindValue === 1 ? 'class' as const : 'model' as const,
    asset: kindValue === 0 ? String(addressDecoder.decode(target)) : undefined,
    weight: kindValue === 2 ? MODEL_CLASS_WEIGHTS[modelClass!] : weight,
    modelName,
    priceLamports: new DataView(bytes.buffer, bytes.byteOffset + 73, 8).getBigUint64(0, true).toString(),
  };
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
  claimedUsdByOwner = new Map<string, number>(),
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
    .map(row => ({
      ...row,
      claimableFareRaw: row.claimableFareRaw.toString(),
      lifetimeClaimedUsd: claimedUsdByOwner.get(row.owner) || 0,
    }));
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

type RewardAsset = { mint: string; decimals: number };

type ParsedRewardClaim = {
  eventIndex: number;
  kind: 'machine' | 'trainee';
  owner: string;
  asset?: string;
  campaignId?: string;
  amounts: string[];
};

export function parseRewardClaimEvents(logMessages: string[]): ParsedRewardClaim[] {
  const events: ParsedRewardClaim[] = [];
  logMessages.forEach((message, eventIndex) => {
    if (!message.startsWith('Program data: ')) return;
    const bytes = Buffer.from(message.slice('Program data: '.length), 'base64');
    const discriminator = bytes.subarray(0, 8);
    if (bytes.length >= 112 && discriminator.equals(REWARDS_CLAIMED_DISCRIMINATOR)) {
      events.push({
        eventIndex,
        kind: 'machine',
        asset: String(addressDecoder.decode(bytes.subarray(8, 40))),
        owner: String(addressDecoder.decode(bytes.subarray(40, 72))),
        amounts: Array.from({ length: 5 }, (_, index) => bytes.readBigUInt64LE(72 + index * 8).toString()),
      });
    } else if (bytes.length >= 56 && discriminator.equals(TRAINEE_REWARDS_CLAIMED_DISCRIMINATOR)) {
      events.push({
        eventIndex,
        kind: 'trainee',
        owner: String(addressDecoder.decode(bytes.subarray(8, 40))),
        campaignId: bytes.readBigUInt64LE(40).toString(),
        amounts: [bytes.readBigUInt64LE(48).toString(), '0', '0', '0', '0'],
      });
    }
  });
  return events;
}

async function syncRewardClaims(
  rpcUrl: string,
  programId: Address,
  database: TaxiDatabase,
  rewardAssets: RewardAsset[],
) {
  const state = await database.protocolIndexState.findOne({ key: 'reward-claims' });
  const signatures: Array<{ signature: string; slot: number; err: unknown; blockTime: number | null }> = [];
  let before: string | undefined;
  do {
    const options: Record<string, unknown> = { limit: 1_000 };
    if (before) options.before = before;
    if (state?.newestSignature) options.until = state.newestSignature;
    const page = await solanaRpcCall<typeof signatures>(rpcUrl, 'getSignaturesForAddress', [String(programId), options]);
    signatures.push(...page);
    before = page.length === 1_000 ? page.at(-1)?.signature : undefined;
  } while (before);
  if (!signatures.length) return;

  const successful = signatures.filter(row => row.err === null);
  const now = new Date();
  for (let offset = 0; offset < successful.length; offset += 10) {
    const rows = successful.slice(offset, offset + 10);
    const transactions = await Promise.all(rows.map(row => solanaRpcCall<{
      slot: number;
      blockTime: number | null;
      meta?: { err?: unknown; logMessages?: string[] | null };
    } | null>(rpcUrl, 'getTransaction', [row.signature, {
      commitment: 'finalized',
      encoding: 'json',
      maxSupportedTransactionVersion: 0,
    }])));
    const writes = transactions.flatMap((transaction, index) => {
      if (!transaction || transaction.meta?.err || !transaction.meta?.logMessages) return [];
      const signature = rows[index].signature;
      return parseRewardClaimEvents(transaction.meta.logMessages).map(event => ({
        updateOne: {
          filter: { signature, eventIndex: event.eventIndex },
          update: { $setOnInsert: {
            ...event,
            signature,
            rewardMints: rewardAssets.map(asset => asset.mint),
            rewardDecimals: rewardAssets.map(asset => asset.decimals),
            slot: transaction.slot,
            blockTime: new Date((transaction.blockTime || rows[index].blockTime || 0) * 1_000),
            createdAt: now,
          } },
          upsert: true,
        },
      }));
    });
    if (writes.length) await database.protocolClaims.bulkWrite(writes);
  }
  await database.protocolIndexState.updateOne(
    { key: 'reward-claims' },
    { $set: { newestSignature: signatures[0].signature, updatedAt: now } },
    { upsert: true },
  );
}

async function loadLifetimeClaimUsd(
  database: TaxiDatabase,
  priceLoader: (mints: string[]) => Promise<Map<string, number>>,
) {
  const claims = await database.protocolClaims.find({}).toArray();
  const mints = [...new Set(claims.flatMap(claim => claim.rewardMints))];
  if (!mints.length) return new Map<string, number>();
  const prices = await priceLoader(mints);
  const totals = new Map<string, number>();
  for (const claim of claims) {
    const usd = claim.amounts.reduce((total, raw, index) => {
      const price = prices.get(claim.rewardMints[index]) || 0;
      return total + Number(raw) / 10 ** Number(claim.rewardDecimals[index] || 0) * price;
    }, 0);
    totals.set(claim.owner, (totals.get(claim.owner) || 0) + usd);
  }
  return totals;
}

async function loadUsdPrices(mints: string[], apiKey?: string) {
  const response = await jupiterRequest(
    `https://api.jup.ag/price/v3?ids=${encodeURIComponent(mints.join(','))}`,
    { headers: apiKey ? { 'x-api-key': apiKey } : undefined },
    { operation: 'reward USD prices', requestTimeoutMs: 8_000 },
  );
  const payload = await response.json() as Record<string, { usdPrice?: number }>;
  return new Map(mints.map(mint => [mint, Number(payload[mint]?.usdPrice || 0)]));
}

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

async function syncMarketListings(rpcUrl: string, programId: Address, database: TaxiDatabase, now: Date) {
  const accounts = await solanaRpcCall<Array<{ pubkey: string; account: { data: [string, string] } }>>(
    rpcUrl,
    'getProgramAccounts',
    [String(programId), {
      commitment: 'finalized',
      encoding: 'base64',
      filters: [
        { dataSize: MARKET_LISTING_ACCOUNT_SIZE },
        { memcmp: { offset: 0, bytes: MARKET_LISTING_DISCRIMINATOR_BASE58 } },
      ],
    }],
  );
  const listings = accounts.map(row => decodeMarketListing(Buffer.from(row.account.data[0], 'base64')));
  if (listings.length) {
    await database.marketListings.bulkWrite(listings.map(listing => ({
      updateOne: {
        filter: { asset: listing.asset },
        update: {
          $set: { seller: listing.seller, priceLamports: listing.priceLamports, status: 'active', updatedAt: now },
          $setOnInsert: { asset: listing.asset, listedAt: now },
        },
        upsert: true,
      },
    })));
  }
  await database.marketListings.updateMany(
    { status: 'active', ...(listings.length ? { asset: { $nin: listings.map(listing => listing.asset) } } : {}) },
    { $set: { status: 'cancelled', updatedAt: now } },
  );
}

async function syncMarketOffers(rpcUrl: string, programId: Address, database: TaxiDatabase, now: Date) {
  const accounts = await solanaRpcCall<Array<{ pubkey: string; account: { data: [string, string] } }>>(
    rpcUrl,
    'getProgramAccounts',
    [String(programId), {
      commitment: 'finalized',
      encoding: 'base64',
      filters: [
        { dataSize: MARKET_OFFER_ACCOUNT_SIZE },
        { memcmp: { offset: 0, bytes: MARKET_OFFER_DISCRIMINATOR_BASE58 } },
      ],
    }],
  );
  const offers = accounts.map(row => decodeMarketOffer(row.pubkey, Buffer.from(row.account.data[0], 'base64')));
  if (offers.length) {
    await database.marketOffers.bulkWrite(offers.map(offer => ({
      updateOne: {
        filter: { offer: offer.offer },
        update: {
          $set: { ...offer, status: 'active', updatedAt: now },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    })));
  }
  await database.marketOffers.updateMany(
    { status: 'active', ...(offers.length ? { offer: { $nin: offers.map(offer => offer.offer) } } : {}) },
    { $set: { status: 'cancelled', updatedAt: now } },
  );
}
