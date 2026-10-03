import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getTransactionEncoder,
  getUtf8Encoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from '@solana/kit';
import { requestQueues } from '../server/requestLimits.js';

const PROGRAM_ID = address(process.env.TAXI_PROGRAM_ID || '8Z9Mru23DFLJGFsDH7tPAfD289JSC4SABt81rqhrYwxD');
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const COMPUTE_BUDGET_PROGRAM = address('ComputeBudget111111111111111111111111111111');
const utf8 = getUtf8Encoder();
const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();
const TEST_SECRET = Uint8Array.from([
  ...Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'),
  ...Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'),
]);

interface Manifest {
  programId: string;
  payerSecret: number[];
  accountFiles: Array<{ address: string; path: string }>;
  config: string;
  pool: string;
  queue: string;
  page: string;
  machines: string[];
  count: number;
  kind: 'mint' | 'repair' | 'expire' | 'stale';
}

async function prepareFixtures(output: string, kind: Manifest['kind'], count: number) {
  await mkdir(output, { recursive: true });
  const signer = await createKeyPairSignerFromBytes(TEST_SECRET);
  const [config, configBump] = await pda(['config']);
  const [pool, poolBump] = await pda(['pool', 'main']);
  const [queue, queueBump] = await pda(['queue', 'main']);
  const [page, pageBump] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [utf8.encode('event-page'), Uint8Array.of(0)],
  });
  const eventTime = BigInt(Math.floor(Date.now() / 1000) - 100);
  const assets = Array.from({ length: count }, (_, index) => fakeAddress(index + 1));
  const machines = await Promise.all(assets.map(asset => getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [utf8.encode('machine'), key(asset)],
  })));
  const events = assets.map((asset, index) => ({
    timestamp: eventTime,
    eventNumber: BigInt(index + 1),
    asset,
    kind: kind === 'expire' || kind === 'stale' ? 1 : 0,
    generation: kind === 'repair' ? 2 : 1,
  }));
  const accountFiles: Manifest['accountFiles'] = [];
  await account(output, accountFiles, 'payer', signer.address, SYSTEM_PROGRAM, new Uint8Array(), 10_000_000_000);
  await account(output, accountFiles, 'config', config, PROGRAM_ID, encodeConfiguration(signer.address, configBump));
  await account(output, accountFiles, 'pool', pool, PROGRAM_ID, encodePool(kind, poolBump, eventTime));
  await account(output, accountFiles, 'queue', queue, PROGRAM_ID, encodeQueue(events, queueBump));
  await account(output, accountFiles, 'page', page, PROGRAM_ID, encodePage(events, pageBump));
  for (let index = 0; index < machines.length; index += 1) {
    await account(
      output,
      accountFiles,
      `machine-${index}`,
      machines[index][0],
      PROGRAM_ID,
      encodeMachine(assets[index], kind, machines[index][1], eventTime),
    );
  }
  const manifest: Manifest = {
    programId: PROGRAM_ID,
    payerSecret: [...TEST_SECRET],
    accountFiles,
    config,
    pool,
    queue,
    page,
    machines: machines.map(([machine]) => machine),
    count,
    kind,
  };
  const manifestPath = join(output, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

async function simulate(manifestPath: string) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(manifest.payerSecret));
  const rpcUrl = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';
  const rpc = createSolanaRpc(rpcUrl);
  const { value: latestBlockhash } = await requestQueues.solanaRpc.schedule(
    () => rpc.getLatestBlockhash({ commitment: 'processed' }).send(),
  );
  const computeInstruction: Instruction = {
    programAddress: COMPUTE_BUDGET_PROGRAM,
    accounts: [],
    data: concat(Uint8Array.of(2), u32(1_400_000)),
  };
  const calculateInstruction: Instruction = manifest.kind === 'stale' ? {
    programAddress: address(manifest.programId),
    accounts: [
      meta(signer.address, AccountRole.READONLY_SIGNER),
      meta(address(manifest.config), AccountRole.READONLY),
      meta(address(manifest.queue), AccountRole.WRITABLE),
      meta(address(manifest.page), AccountRole.WRITABLE),
      ...manifest.machines.map(machine => meta(address(machine), AccountRole.READONLY)),
    ],
    data: concat(
      discriminator('prune_stale_events'),
      Uint8Array.of(0),
      u32(manifest.count),
      ...Array.from({ length: manifest.count }, (_, index) => u64(BigInt(index + 1))),
    ),
  } : {
    programAddress: address(manifest.programId),
    accounts: [
      meta(signer.address, AccountRole.READONLY_SIGNER),
      meta(address(manifest.config), AccountRole.READONLY),
      meta(address(manifest.pool), AccountRole.WRITABLE),
      meta(address(manifest.queue), AccountRole.WRITABLE),
      meta(address(manifest.page), AccountRole.WRITABLE),
      ...manifest.machines.map(machine => meta(address(machine), AccountRole.WRITABLE)),
    ],
    data: concat(discriminator('calculate_rewards'), Uint8Array.of(manifest.count)),
  };
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    transaction => setTransactionMessageFeePayerSigner(signer, transaction),
    transaction => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transaction),
    transaction => appendTransactionMessageInstructions([computeInstruction, calculateInstruction], transaction),
  );
  const compiled = compileTransaction(message);
  const signed = await partiallySignTransaction([signer.keyPair], compiled);
  const wire = getTransactionEncoder().encode(signed);
  const result = await requestQueues.solanaRpc.schedule(() => rpc.simulateTransaction(
    getBase64EncodedWireTransaction(signed),
    { commitment: 'processed', encoding: 'base64', sigVerify: true },
  ).send());
  console.log(JSON.stringify({
    kind: manifest.kind,
    count: manifest.count,
    transactionBytes: wire.length,
    unitsConsumed: result.value.unitsConsumed?.toString(),
    error: result.value.err,
    logs: result.value.logs,
  }, null, 2));
  if (result.value.err) process.exitCode = 1;
}

function encodeConfiguration(signer: Address, bump: number) {
  const writer = new Writer('Configuration', 1_400);
  for (let index = 0; index < 5; index += 1) writer.pubkey(signer);
  writer.bytes(new Uint8Array(32));
  writer.u64(0n);
  for (let index = 0; index < 4; index += 1) writer.u64(0n);
  for (let index = 0; index < 6; index += 1) writer.pubkey(signer);
  for (let index = 0; index < 4; index += 1) writer.string('x');
  for (let index = 0; index < 4; index += 1) writer.u64(1n);
  for (let index = 0; index < 4; index += 1) writer.u16(0);
  writer.u8(1).i64(0n).i64(0n).u8(bump);
  return writer.finish();
}

function encodePool(kind: Manifest['kind'], bump: number, eventTime: bigint) {
  const writer = new Writer('RewardPool', 298);
  writer.i64(eventTime - 100n);
  writer.u64(kind === 'mint' ? 0n : 600n);
  for (let index = 0; index < 5; index += 1) writer.u128(0n);
  for (let index = 0; index < 5; index += 1) writer.u64(0n);
  for (let index = 0; index < 5; index += 1) writer.u64(1_000_000_000n);
  for (let index = 0; index < 10; index += 1) writer.u64(0n);
  writer.i64(0n).i64(0n).i64(0n).u64(0n).u8(0).u8(bump);
  return writer.finish();
}

function encodeQueue(events: Array<{ timestamp: bigint; eventNumber: bigint }>, bump: number) {
  const writer = new Writer('EventQueue', 1_461);
  writer.u32(80);
  writer.u16(events.length).i64(events[0].timestamp).u64(events[0].eventNumber);
  for (let index = 1; index < 80; index += 1) writer.u16(0).i64(0n).u64(0n);
  writer.u64(BigInt(events.length + 1)).u8(bump);
  return writer.finish();
}

function encodePage(
  events: Array<{ timestamp: bigint; eventNumber: bigint; asset: Address; kind: number; generation: number }>,
  bump: number,
) {
  const writer = new Writer('EventPage', 6_798);
  writer.u8(0).u32(events.length);
  for (const event of events) {
    writer.i64(event.timestamp).u64(event.eventNumber).pubkey(event.asset).u8(event.kind).u32(event.generation);
  }
  writer.u8(bump);
  return writer.finish();
}

function encodeMachine(asset: Address, kind: Manifest['kind'], bump: number, eventTime: bigint) {
  const writer = new Writer('Machine', 189);
  writer.pubkey(asset).u16(30).i64(kind === 'stale' ? eventTime + 5n * 24n * 60n * 60n - 1n : 0n);
  writer.u32(kind === 'repair' || kind === 'stale' ? 2 : 1).u32(kind === 'mint' ? 0 : 1);
  writer.u8(kind === 'mint' ? 0 : 1).u8(0);
  for (let index = 0; index < 5; index += 1) writer.u128(0n);
  for (let index = 0; index < 5; index += 1) writer.u64(0n);
  writer.u64(0n).u8(bump);
  return writer.finish();
}

async function account(
  output: string,
  entries: Manifest['accountFiles'],
  name: string,
  accountAddress: Address,
  owner: Address | string,
  data: Uint8Array,
  lamports = 100_000_000,
) {
  const path = join(output, `${name}.json`);
  await writeFile(path, JSON.stringify({
    pubkey: String(accountAddress),
    account: {
      lamports,
      data: [Buffer.from(data).toString('base64'), 'base64'],
      owner: String(owner),
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  }));
  entries.push({ address: String(accountAddress), path });
}

async function pda(seeds: string[]) {
  return getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds: seeds.map(seed => utf8.encode(seed)) });
}
function fakeAddress(seed: number) {
  const bytes = new Uint8Array(32);
  bytes[31] = seed;
  return address(addressDecoder.decode(bytes));
}
function parseKind(value: string): Manifest['kind'] {
  if (value === 'mint' || value === 'repair' || value === 'expire' || value === 'stale') return value;
  throw new Error('kind must be mint, repair, expire, or stale');
}
function discriminator(name: string) {
  return Uint8Array.from(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
}
function key(value: Address) { return Uint8Array.from(addressEncoder.encode(value)); }
function meta(value: Address, role: AccountRole) { return { address: value, role }; }
function u32(value: number) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}
function u64(value: bigint) {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value, true);
  return result;
}
function concat(...parts: readonly Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

class Writer {
  private readonly data: Uint8Array;
  private readonly view: DataView;
  private offset = 8;
  constructor(accountName: string, size: number) {
    this.data = new Uint8Array(size);
    this.data.set(createHash('sha256').update(`account:${accountName}`).digest().subarray(0, 8));
    this.view = new DataView(this.data.buffer);
  }
  bytes(value: Uint8Array) { this.data.set(value, this.offset); this.offset += value.length; return this; }
  pubkey(value: Address) { return this.bytes(key(value)); }
  string(value: string) { const bytes = Uint8Array.from(Buffer.from(value)); return this.u32(bytes.length).bytes(bytes); }
  u8(value: number) { this.view.setUint8(this.offset, value); this.offset += 1; return this; }
  u16(value: number) { this.view.setUint16(this.offset, value, true); this.offset += 2; return this; }
  u32(value: number) { this.view.setUint32(this.offset, value, true); this.offset += 4; return this; }
  u64(value: bigint) { this.view.setBigUint64(this.offset, value, true); this.offset += 8; return this; }
  i64(value: bigint) { this.view.setBigInt64(this.offset, value, true); this.offset += 8; return this; }
  u128(value: bigint) { this.u64(value & 0xffff_ffff_ffff_ffffn); this.u64(value >> 64n); return this; }
  finish() { return this.data; }
}

const [mode, target, kindArg = 'expire', countArg = '20'] = process.argv.slice(2);
if (mode === 'prepare') {
  if (!target) throw new Error('Usage: prepare <output-directory> <mint|repair|expire|stale> <count>');
  const kind = parseKind(kindArg);
  const count = Number(countArg);
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('count must be 1..20');
  console.log(await prepareFixtures(resolve(target), kind, count));
} else if (mode === 'simulate') {
  if (!target) throw new Error('Usage: simulate <manifest.json>');
  await simulate(resolve(target));
} else {
  throw new Error('Usage: npm run protocol:benchmark -- <prepare|simulate> ...');
}
