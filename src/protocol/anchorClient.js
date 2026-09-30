import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressDecoder,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  getUtf8Encoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from '@solana-program/token';

export const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
export const MPL_CORE_PROGRAM = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
export const ED25519_PROGRAM = address('Ed25519SigVerify111111111111111111111111111');
export const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111');
export const MAX_CLAIM_MACHINES_PER_TRANSACTION = 10;
export const MAX_REPAIR_MACHINES_PER_TRANSACTION = 8;

export const TAXI_DISCRIMINATORS = Object.freeze({
  mintMachine: Uint8Array.from([163, 170, 168, 54, 183, 79, 113, 45]),
  claim: Uint8Array.from([62, 198, 214, 193, 213, 159, 108, 210]),
  claimMany: Uint8Array.from([239, 76, 176, 190, 112, 53, 176, 100]),
  repair: Uint8Array.from([97, 230, 48, 23, 128, 133, 201, 192]),
  activateTrainee: Uint8Array.from([192, 95, 221, 239, 185, 89, 60, 75]),
  claimTrainee: Uint8Array.from([65, 255, 2, 105, 62, 175, 216, 215]),
});

const utf8 = getUtf8Encoder();
const addressDecoder = getAddressDecoder();

export function concatBytes(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

export function u64Bytes(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

export function i64Bytes(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true);
  return bytes;
}

export function base64Bytes(value) {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(value, 'base64'));
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

class Reader {
  constructor(bytes, offset = 8) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  take(length) {
    const end = this.offset + length;
    if (end > this.bytes.length) throw new Error('Invalid Solana account data.');
    const result = this.bytes.slice(this.offset, end);
    this.offset = end;
    return result;
  }

  u8() { return this.take(1)[0]; }
  bool() { return this.u8() !== 0; }
  u16() { const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u32() { const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  u64() { const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value; }
  i64() { const value = this.view.getBigInt64(this.offset, true); this.offset += 8; return value; }
  u128() {
    const low = this.u64();
    const high = this.u64();
    return low + (high << 64n);
  }
  pubkey() { return addressDecoder.decode(this.take(32)); }
  string() { return new TextDecoder().decode(this.take(this.u32())); }
}

export function decodeConfiguration(bytes) {
  const reader = new Reader(bytes);
  const config = {
    admin: reader.pubkey(),
    pendingAdmin: reader.pubkey(),
    backendSigner: reader.pubkey(),
    teamAccount: reader.pubkey(),
    jupiterProgram: reader.pubkey(),
    deploymentId: reader.take(32),
    fareSwapNonce: reader.u64(),
    stockSwapNonces: Array.from({ length: 4 }, () => reader.u64()),
    collection: reader.pubkey(),
    fareMint: reader.pubkey(),
    stockMints: Array.from({ length: 4 }, () => reader.pubkey()),
    metadataUris: Array.from({ length: 16 }, () => reader.string()),
    traineeMetadataUri: reader.string(),
    mintPrices: Array.from({ length: 4 }, () => reader.u64()),
    mintedByClass: Array.from({ length: 4 }, () => reader.u16()),
    saleStarted: reader.bool(),
    pausedAt: reader.i64(),
    totalPausedSeconds: reader.i64(),
    bump: reader.u8(),
    mintAssignmentRoot: reader.take(12),
  };
  return config;
}

export function decodeRewardPool(bytes) {
  const reader = new Reader(bytes);
  const result = {
    calculatedUntil: reader.i64(),
    totalActiveWeight: reader.u64(),
    accumulators: Array.from({ length: 5 }, () => reader.u128()),
    obligations: Array.from({ length: 5 }, () => reader.u64()),
    nextPool: Array.from({ length: 5 }, () => reader.u64()),
    seriesInitial: Array.from({ length: 5 }, () => reader.u64()),
    seriesRemaining: Array.from({ length: 5 }, () => reader.u64()),
    seriesStart: reader.i64(),
    seriesEnd: reader.i64(),
    seriesCursor: reader.i64(),
    seriesEventCutoff: reader.u64(),
    seriesActive: reader.bool(),
    bump: reader.u8(),
  };
  result.effectiveCalculatedUntil = result.seriesActive ? result.seriesCursor : result.calculatedUntil;
  return result;
}

export function decodeMachine(bytes) {
  const reader = new Reader(bytes);
  return {
    asset: reader.pubkey(),
    weight: reader.u16(),
    activeUntil: reader.i64(),
    scheduledGeneration: reader.u32(),
    rewardGeneration: reader.u32(),
    rewardActive: reader.bool(),
    closed: reader.bool(),
    checkpoints: Array.from({ length: 5 }, () => reader.u128()),
    claimable: Array.from({ length: 5 }, () => reader.u64()),
    fareBase: reader.u64(),
    bump: reader.u8(),
  };
}

export function decodeTrainee(bytes) {
  const reader = new Reader(bytes);
  return {
    owner: reader.pubkey(),
    asset: reader.pubkey(),
    campaignId: reader.u64(),
    nonce: reader.u64(),
    activeFrom: reader.i64(),
    activeUntil: reader.i64(),
    checkpoint: reader.u128(),
    checkpointInitialized: reader.bool(),
    bump: reader.u8(),
  };
}

export function decodeTraineeBucket(bytes) {
  const reader = new Reader(bytes);
  return {
    timestamp: reader.i64(),
    weightDelta: reader.i64(),
    accumulator: reader.u128(),
    processed: reader.bool(),
    bump: reader.u8(),
  };
}

export function decodeEventQueue(bytes, pageCount = 80) {
  const reader = new Reader(bytes);
  const storedPageCount = reader.u32();
  if (storedPageCount !== pageCount) throw new Error('Invalid event queue page count.');
  const pages = Array.from({ length: storedPageCount }, (_, index) => ({
    index,
    count: reader.u16(),
    minTimestamp: reader.i64(),
    minEventNumber: reader.u64(),
  }));
  return { pages, nextEventNumber: reader.u64(), bump: reader.u8() };
}

export async function deriveTaxiAddresses(programAddress, assetAddress) {
  const entries = await Promise.all([
    getProgramDerivedAddress({ programAddress, seeds: [utf8.encode('config')] }),
    getProgramDerivedAddress({ programAddress, seeds: [utf8.encode('pool'), utf8.encode('main')] }),
    getProgramDerivedAddress({ programAddress, seeds: [utf8.encode('queue'), utf8.encode('main')] }),
    getProgramDerivedAddress({ programAddress, seeds: [utf8.encode('fees')] }),
    assetAddress
      ? getProgramDerivedAddress({ programAddress, seeds: [utf8.encode('machine'), addressBytes(assetAddress)] })
      : Promise.resolve([null, 0]),
  ]);
  return {
    config: entries[0][0],
    pool: entries[1][0],
    queue: entries[2][0],
    feeVault: entries[3][0],
    machine: entries[4][0],
  };
}

export async function deriveEventPage(programAddress, pageIndex) {
  return (await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8.encode('event-page'), Uint8Array.of(pageIndex)],
  }))[0];
}

export async function deriveTraineeAddresses(programAddress, owner, campaignId, activeFrom, activeUntil, pageIndex) {
  const entries = await Promise.all([
    getProgramDerivedAddress({
      programAddress,
      seeds: [utf8.encode('trainee'), addressBytes(owner), u64Bytes(campaignId)],
    }),
    getProgramDerivedAddress({
      programAddress,
      seeds: [utf8.encode('trainee-bucket'), i64Bytes(activeFrom)],
    }),
    getProgramDerivedAddress({
      programAddress,
      seeds: [utf8.encode('trainee-bucket'), i64Bytes(activeUntil)],
    }),
    getProgramDerivedAddress({
      programAddress,
      seeds: [utf8.encode('trainee-event-page'), Uint8Array.of(pageIndex)],
    }),
  ]);
  return {
    trainee: entries[0][0],
    startBucket: entries[1][0],
    endBucket: entries[2][0],
    eventPage: entries[3][0],
  };
}

export function chooseEventPage(queue, requiredSlots = 2) {
  const page = queue.pages.find(item => item.count + requiredSlots <= 128);
  if (!page) throw new Error('The event queue is full. CalculateRewards must run first.');
  return page.index;
}

export async function buildMintMachine({
  programAddress,
  owner,
  configAddress,
  config,
  queue,
  pageIndex,
  fareTokenProgram,
  teamFareAccountExists = false,
  assetSigner,
  quote,
}) {
  if (!assetSigner) throw new Error('The mint asset signer must be created before requesting a quote.');
  const payer = createNoopSigner(address(owner));
  const machine = (await deriveTaxiAddresses(programAddress, assetSigner.address)).machine;
  const eventPage = await deriveEventPage(programAddress, pageIndex);
  const fareMint = address(config.fareMint);
  const tokenProgram = address(fareTokenProgram);
  const [ownerFareAccount] = await findAssociatedTokenPda({ owner, mint: fareMint, tokenProgram });
  const [teamFareAccount] = await findAssociatedTokenPda({ owner: config.teamAccount, mint: fareMint, tokenProgram });
  if (String(quote.owner) !== String(owner)
    || String(quote.asset) !== String(assetSigner.address)
    || String(quote.fareMint) !== String(fareMint)) {
    throw new Error('The backend returned a quote for different mint accounts.');
  }
  const amountFareRaw = BigInt(quote.amountFareRaw);
  const priceUsdCents = BigInt(quote.priceUsdCents);
  const expiresAt = BigInt(quote.expiresAt);
  const proof = quote.assignmentProof?.map(hexBytes) || [];
  if (proof.length !== 11 || proof.some(value => value.length !== 12)) throw new Error('The backend returned an invalid mint assignment proof.');
  const data = concatBytes(
    TAXI_DISCRIMINATORS.mintMachine,
    Uint8Array.of(pageIndex),
    u16Bytes(Number(quote.assignmentIndex)),
    Uint8Array.of(Number(quote.classIndex), Number(quote.variantIndex)),
    u32Bytes(proof.length),
    ...proof,
    u64Bytes(amountFareRaw),
    u64Bytes(priceUsdCents),
    i64Bytes(expiresAt),
  );
  const instruction = {
    programAddress,
    accounts: [
      meta(owner, AccountRole.WRITABLE_SIGNER),
      meta(configAddress, AccountRole.WRITABLE),
      meta(queue, AccountRole.WRITABLE),
      meta(eventPage, AccountRole.WRITABLE),
      meta(assetSigner.address, AccountRole.WRITABLE_SIGNER),
      meta(machine, AccountRole.WRITABLE),
      meta(config.collection, AccountRole.WRITABLE),
      meta(fareMint, AccountRole.READONLY),
      meta(ownerFareAccount, AccountRole.WRITABLE),
      meta(teamFareAccount, AccountRole.WRITABLE),
      meta(tokenProgram, AccountRole.READONLY),
      meta(INSTRUCTIONS_SYSVAR, AccountRole.READONLY),
      meta(MPL_CORE_PROGRAM, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM, AccountRole.READONLY),
    ],
    data,
  };
  const ed25519Instruction = buildInlineEd25519Instruction(quote);
  const instructions = [
    ...(!teamFareAccountExists ? [getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: teamFareAccount,
      owner: config.teamAccount,
      mint: fareMint,
      tokenProgram,
    })] : []),
    ed25519Instruction,
    instruction,
  ];
  return { instruction, instructions, assetSigner, machine, ownerFareAccount, teamFareAccount };
}

function hexBytes(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{24}$/i.test(value)) return new Uint8Array();
  return Uint8Array.from({ length: value.length / 2 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

export async function createMintAssetSigner() {
  return generateKeyPairSigner();
}

function buildInlineEd25519Instruction(signed) {
  const signature = base64Bytes(signed.signature);
  const message = base64Bytes(signed.message);
  const signer = addressBytes(signed.backendSigner);
  if (signature.length !== 64 || signer.length !== 32 || message.length > 65_535) {
    throw new Error('The backend returned an invalid mint quote signature.');
  }
  const publicKeyOffset = 16;
  const signatureOffset = publicKeyOffset + 32;
  const messageOffset = signatureOffset + 64;
  return {
    programAddress: ED25519_PROGRAM,
    accounts: [],
    data: concatBytes(
      Uint8Array.of(1, 0),
      u16Bytes(signatureOffset), u16Bytes(65_535),
      u16Bytes(publicKeyOffset), u16Bytes(65_535),
      u16Bytes(messageOffset), u16Bytes(message.length), u16Bytes(65_535),
      signer,
      signature,
      message,
    ),
  };
}

export async function buildClaimInstructions({
  programAddress,
  owner,
  configAddress,
  pool,
  machine,
  asset,
  mints,
  tokenPrograms,
  amounts,
  destinationAccountsExist = [],
}) {
  if (!Array.isArray(amounts) || amounts.length !== mints.length) {
    throw new Error('Claim requires current balances for every reward asset.');
  }
  const payer = createNoopSigner(address(owner));
  const setup = [];
  const rewardAccounts = [];
  for (let index = 0; index < mints.length; index += 1) {
    const mint = address(mints[index]);
    const tokenProgram = address(tokenPrograms[index]);
    const [vault] = await findAssociatedTokenPda({ owner: configAddress, mint, tokenProgram });
    const [destination] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
    const hasReward = BigInt(amounts[index]) > 0n;
    if (hasReward && !destinationAccountsExist[index]) {
      setup.push(getCreateAssociatedTokenIdempotentInstruction({
        payer,
        ata: destination,
        owner,
        mint,
        tokenProgram,
      }));
    }
    rewardAccounts.push(
      meta(mint, AccountRole.READONLY),
      meta(vault, AccountRole.WRITABLE),
      meta(hasReward ? destination : vault, AccountRole.WRITABLE),
      meta(tokenProgram, AccountRole.READONLY),
    );
  }
  return [
    ...setup,
    {
      programAddress,
      accounts: [
        meta(owner, AccountRole.WRITABLE_SIGNER),
        meta(configAddress, AccountRole.READONLY),
        meta(pool, AccountRole.WRITABLE),
        meta(machine, AccountRole.WRITABLE),
        meta(asset, AccountRole.READONLY),
        ...rewardAccounts,
      ],
      data: TAXI_DISCRIMINATORS.claim,
    },
  ];
}

export async function buildClaimAllInstructions({ machines, destinationAccountsExist = [], ...shared }) {
  if (!Array.isArray(machines) || machines.length === 0) throw new Error('Choose at least one car to claim.');
  if (machines.length > MAX_CLAIM_MACHINES_PER_TRANSACTION) {
    throw new Error(`Claim supports at most ${MAX_CLAIM_MACHINES_PER_TRANSACTION} cars per transaction.`);
  }
  if (new Set(machines.map(machine => String(machine.machineAddress))).size !== machines.length) {
    throw new Error('Each car can appear only once in a claim transaction.');
  }
  const payer = createNoopSigner(address(shared.owner));
  const setup = [];
  const rewardAccounts = [];
  for (let index = 0; index < shared.mints.length; index += 1) {
    const mint = address(shared.mints[index]);
    const tokenProgram = address(shared.tokenPrograms[index]);
    const [vault] = await findAssociatedTokenPda({ owner: shared.configAddress, mint, tokenProgram });
    const [destination] = await findAssociatedTokenPda({ owner: shared.owner, mint, tokenProgram });
    if (!destinationAccountsExist[index]) {
      setup.push(getCreateAssociatedTokenIdempotentInstruction({
        payer,
        ata: destination,
        owner: shared.owner,
        mint,
        tokenProgram,
      }));
    }
    rewardAccounts.push(
      meta(mint, AccountRole.READONLY),
      meta(vault, AccountRole.WRITABLE),
      meta(destination, AccountRole.WRITABLE),
      meta(tokenProgram, AccountRole.READONLY),
    );
  }
  return [
    ...setup,
    {
      programAddress: shared.programAddress,
      accounts: [
        meta(shared.owner, AccountRole.WRITABLE_SIGNER),
        meta(shared.configAddress, AccountRole.READONLY),
        meta(shared.pool, AccountRole.WRITABLE),
        ...machines.flatMap(machine => [
          meta(machine.machineAddress, AccountRole.WRITABLE),
          meta(machine.asset, AccountRole.READONLY),
        ]),
        ...rewardAccounts,
      ],
      data: concatBytes(TAXI_DISCRIMINATORS.claimMany, Uint8Array.of(machines.length)),
    },
  ];
}

export function decodeAddressLookupTable(bytes) {
  if (bytes.length < 56 || (bytes.length - 56) % 32 !== 0) throw new Error('Invalid address lookup table account.');
  const addresses = [];
  for (let offset = 56; offset < bytes.length; offset += 32) {
    addresses.push(addressDecoder.decode(bytes.subarray(offset, offset + 32)));
  }
  return addresses;
}

export async function claimLookupTableAddresses({ programAddress, configAddress, pool, mints, tokenPrograms }) {
  const values = [
    programAddress,
    configAddress,
    pool,
    SYSTEM_PROGRAM,
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  ];
  for (let index = 0; index < mints.length; index += 1) {
    const mint = address(mints[index]);
    const tokenProgram = address(tokenPrograms[index]);
    const [vault] = await findAssociatedTokenPda({ owner: configAddress, mint, tokenProgram });
    values.push(mint, vault, tokenProgram);
  }
  return [...new Set(values.map(String))].map(address);
}

export function buildTransferCoreAssetInstruction({ owner, asset, collection, newOwner }) {
  return {
    programAddress: MPL_CORE_PROGRAM,
    accounts: [
      meta(asset, AccountRole.WRITABLE),
      meta(collection, AccountRole.READONLY),
      meta(owner, AccountRole.WRITABLE_SIGNER),
      meta(MPL_CORE_PROGRAM, AccountRole.READONLY),
      meta(newOwner, AccountRole.READONLY),
      meta(MPL_CORE_PROGRAM, AccountRole.READONLY),
      meta(MPL_CORE_PROGRAM, AccountRole.READONLY),
    ],
    data: Uint8Array.of(14, 0),
  };
}

export async function buildRepairInstructions({
  programAddress,
  owner,
  configAddress,
  config,
  pool,
  queue,
  machine,
  asset,
  fareTokenProgram,
  repairCost,
  pageIndex,
  ownerFareAccountExists = false,
}) {
  const eventPage = await deriveEventPage(programAddress, pageIndex);
  const [ownerFareAccount] = await findAssociatedTokenPda({
    owner,
    mint: config.fareMint,
    tokenProgram: fareTokenProgram,
  });
  const payer = createNoopSigner(address(owner));
  const repair = {
    programAddress,
    accounts: [
      meta(owner, AccountRole.WRITABLE_SIGNER),
      meta(configAddress, AccountRole.READONLY),
      meta(pool, AccountRole.WRITABLE),
      meta(queue, AccountRole.WRITABLE),
      meta(eventPage, AccountRole.WRITABLE),
      meta(machine, AccountRole.WRITABLE),
      meta(asset, AccountRole.READONLY),
      meta(config.fareMint, AccountRole.WRITABLE),
      meta(ownerFareAccount, AccountRole.WRITABLE),
      meta(fareTokenProgram, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM, AccountRole.READONLY),
    ],
    data: concatBytes(TAXI_DISCRIMINATORS.repair, Uint8Array.of(pageIndex)),
  };
  if (BigInt(repairCost) === 0n || ownerFareAccountExists) return [repair];
  return [
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: ownerFareAccount,
      owner,
      mint: config.fareMint,
      tokenProgram: fareTokenProgram,
    }),
    repair,
  ];
}

export async function buildRepairAllInstructions({ machines, ...shared }) {
  if (!Array.isArray(machines) || machines.length === 0) throw new Error('Choose at least one car to repair.');
  if (machines.length > MAX_REPAIR_MACHINES_PER_TRANSACTION) {
    throw new Error(`Repair supports at most ${MAX_REPAIR_MACHINES_PER_TRANSACTION} cars per transaction.`);
  }
  const instructions = [];
  let ownerFareAccountExists = false;
  for (const machine of machines) {
    const built = await buildRepairInstructions({
      ...shared,
      machine: machine.machineAddress,
      asset: machine.asset,
      repairCost: machine.repairCost,
      ownerFareAccountExists,
    });
    instructions.push(...built);
    if (BigInt(machine.repairCost) > 0n) ownerFareAccountExists = true;
  }
  return instructions;
}

export async function buildActivateTraineeInstructions({
  programAddress,
  owner,
  configAddress,
  traineeQueue,
  collection,
  voucher,
}) {
  const assetSigner = await generateKeyPairSigner();
  const args = {
    campaignId: BigInt(voucher.args.campaignId),
    nonce: BigInt(voucher.args.nonce),
    durationMinutes: Number(voucher.args.durationMinutes),
    expiresAt: BigInt(voucher.args.expiresAt),
    activeFrom: BigInt(voucher.args.activeFrom),
    activeUntil: BigInt(voucher.args.activeUntil),
    pageIndex: Number(voucher.args.pageIndex),
  };
  const signature = base64Bytes(voucher.signature);
  const message = base64Bytes(voucher.message);
  const signer = addressBytes(voucher.backendSigner);
  if (signature.length !== 64 || signer.length !== 32 || message.length > 65535) {
    throw new Error('The backend returned an invalid voucher.');
  }
  const publicKeyOffset = 16;
  const signatureOffset = publicKeyOffset + 32;
  const messageOffset = signatureOffset + 64;
  const ed25519Data = concatBytes(
    Uint8Array.of(1, 0),
    u16Bytes(signatureOffset), u16Bytes(65535),
    u16Bytes(publicKeyOffset), u16Bytes(65535),
    u16Bytes(messageOffset), u16Bytes(message.length), u16Bytes(65535),
    signer,
    signature,
    message,
  );
  const addresses = await deriveTraineeAddresses(
    programAddress,
    owner,
    args.campaignId,
    args.activeFrom,
    args.activeUntil,
    args.pageIndex,
  );
  const activateData = concatBytes(
    TAXI_DISCRIMINATORS.activateTrainee,
    u64Bytes(args.campaignId),
    u64Bytes(args.nonce),
    u16Bytes(args.durationMinutes),
    i64Bytes(args.expiresAt),
    i64Bytes(args.activeFrom),
    i64Bytes(args.activeUntil),
    Uint8Array.of(args.pageIndex),
  );
  return { assetSigner, instructions: [
    { programAddress: ED25519_PROGRAM, accounts: [], data: ed25519Data },
    {
      programAddress,
      accounts: [
        meta(owner, AccountRole.WRITABLE_SIGNER),
        meta(configAddress, AccountRole.READONLY),
        meta(traineeQueue, AccountRole.WRITABLE),
        meta(addresses.eventPage, AccountRole.WRITABLE),
        meta(addresses.trainee, AccountRole.WRITABLE),
        meta(assetSigner.address, AccountRole.WRITABLE_SIGNER),
        meta(collection, AccountRole.WRITABLE),
        meta(MPL_CORE_PROGRAM, AccountRole.READONLY),
        meta(addresses.startBucket, AccountRole.WRITABLE),
        meta(addresses.endBucket, AccountRole.WRITABLE),
        meta(INSTRUCTIONS_SYSVAR, AccountRole.READONLY),
        meta(SYSTEM_PROGRAM, AccountRole.READONLY),
      ],
      data: activateData,
    },
  ] };
}

export async function buildClaimTraineeInstructions({
  programAddress,
  owner,
  configAddress,
  traineePool,
  trainee,
  fareMint,
  tokenProgram,
  amount,
}) {
  const payer = createNoopSigner(address(owner));
  const addresses = await deriveTraineeAddresses(
    programAddress,
    owner,
    trainee.campaignId,
    trainee.activeFrom,
    trainee.activeUntil,
    0,
  );
  const [vault] = await findAssociatedTokenPda({ owner: configAddress, mint: fareMint, tokenProgram });
  const [destination] = await findAssociatedTokenPda({ owner, mint: fareMint, tokenProgram });
  const hasReward = BigInt(amount) > 0n;
  const claim = {
      programAddress,
      accounts: [
        meta(owner, AccountRole.WRITABLE_SIGNER),
        meta(configAddress, AccountRole.READONLY),
        meta(traineePool, AccountRole.WRITABLE),
        meta(addresses.trainee, AccountRole.WRITABLE),
        meta(trainee.asset, AccountRole.READONLY),
        meta(addresses.startBucket, AccountRole.READONLY),
        meta(addresses.endBucket, AccountRole.READONLY),
        meta(fareMint, AccountRole.READONLY),
        meta(vault, AccountRole.WRITABLE),
        meta(hasReward ? destination : vault, AccountRole.WRITABLE),
        meta(tokenProgram, AccountRole.READONLY),
      ],
      data: TAXI_DISCRIMINATORS.claimTrainee,
  };
  if (!hasReward) return [claim];
  return [
    getCreateAssociatedTokenIdempotentInstruction({ payer, ata: destination, owner, mint: fareMint, tokenProgram }),
    claim,
  ];
}

export async function sendWalletInstructions({ rpc, wallet, account, chain, instructions, additionalSigners = [], lookupTables = {} }) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'finalized' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    transaction => setTransactionMessageFeePayer(address(account.address), transaction),
    transaction => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transaction),
    transaction => appendTransactionMessageInstructions(instructions, transaction),
    transaction => compressTransactionMessageUsingAddressLookupTables(transaction, lookupTables),
  );
  let transaction = compileTransaction(message);
  const encoded = getTransactionEncoder().encode(transaction);
  if (encoded.length > 1232) {
    throw new Error(`This fleet does not fit into one Solana transaction (${encoded.length}/1232 bytes). No transaction was sent.`);
  }
  const simulation = await rpc.simulateTransaction(getBase64EncodedWireTransaction(transaction), {
    commitment: 'confirmed',
    encoding: 'base64',
    sigVerify: false,
    replaceRecentBlockhash: false,
  }).send();
  if (simulation.value.err) {
    const logs = Array.isArray(simulation.value.logs) ? simulation.value.logs.slice(-4).join(' | ') : '';
    throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}${logs ? ` — ${logs}` : ''}. No transaction was sent.`);
  }

  if (additionalSigners.length) {
    const signFeature = wallet.features['solana:signTransaction'];
    if (!signFeature) throw new Error('Phantom does not support the safe multi-signer transaction flow.');
    const [walletResult] = await signFeature.signTransaction({ transaction: encoded, account, chain });
    transaction = getTransactionDecoder().decode(walletResult.signedTransaction);
    transaction = await partiallySignTransaction(additionalSigners.map(signer => signer.keyPair), transaction);
    const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: 'base64',
      maxRetries: 3n,
      preflightCommitment: 'confirmed',
      skipPreflight: false,
    }).send();
    await waitForFinalizedSignature(rpc, signature);
    return signature;
  }

  const feature = wallet.features['solana:signAndSendTransaction'];
  if (!feature) throw new Error('Phantom does not support transaction signing through Wallet Standard.');
  const [result] = await feature.signAndSendTransaction({ transaction: encoded, account, chain });
  const signature = getBase58Decoder().decode(result.signature);
  await waitForFinalizedSignature(rpc, signature);
  return signature;
}

export async function waitForFinalizedSignature(
  rpc,
  signature,
  { timeoutMs = 45_000, pollMs = 1_000, sleep = delay => new Promise(resolve => setTimeout(resolve, delay)) } = {},
) {
  const deadline = Date.now() + timeoutMs;
  do {
    let result;
    try {
      result = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
    } catch {
      if (Date.now() >= deadline) break;
      await sleep(pollMs);
      continue;
    }
    const status = result.value[0];
    if (status?.err) {
      throw transactionError(`Solana transaction failed: ${JSON.stringify(status.err)}`, signature);
    }
    if (status?.confirmationStatus === 'finalized') return;
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  } while (Date.now() <= deadline);
  throw transactionError('Solana did not confirm the transaction within 45 seconds. Check it in Explorer before retrying.', signature);
}

function transactionError(message, signature) {
  const error = new Error(message);
  error.signature = signature;
  return error;
}

function meta(value, role) {
  return { address: address(value), role };
}

function u16Bytes(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, Number(value), true);
  return bytes;
}

function u32Bytes(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, Number(value), true);
  return bytes;
}

export function addressBytes(value) {
  // PDA seeds use the raw 32-byte public key. The Kit address encoder is deliberately
  // avoided here to keep this module browser-only and small.
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const character of String(value)) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid Solana address.');
    number = number * 58n + BigInt(index);
  }
  const output = new Uint8Array(32);
  for (let index = 31; index >= 0 && number > 0n; index -= 1) {
    output[index] = Number(number & 255n);
    number >>= 8n;
  }
  return output;
}
