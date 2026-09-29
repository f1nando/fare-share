import {
  address,
  getAddressDecoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
} from '@solana/kit';
import { solanaRpcCall } from './solanaRpc.js';

const utf8 = getUtf8Encoder();
const addressDecoder = getAddressDecoder();

export interface ProtocolClock {
  deploymentId: Uint8Array;
  backendSigner: Address;
  protocolTime: bigint;
  chainTime: bigint;
  paused: boolean;
}

export interface WorkerConfiguration {
  backendSigner: Address;
  teamAccount: Address;
  jupiterProgram: Address;
  deploymentId: Uint8Array;
  fareSwapNonce: bigint;
  stockSwapNonces: [bigint, bigint, bigint, bigint];
  collection: Address;
  fareMint: Address;
  stockMints: [Address, Address, Address, Address];
  mintPrices: [bigint, bigint, bigint, bigint];
  mintedByClass: [number, number, number, number];
  saleStarted: boolean;
  pausedAt: bigint;
  totalPausedSeconds: bigint;
}

export async function loadProtocolClock(rpcUrl: string, programId: Address): Promise<ProtocolClock> {
  const [configAddress] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8.encode('config')],
  });
  const accountResult = await solanaRpcCall<{ value: { data: [string, string] } | null }>(rpcUrl, 'getAccountInfo', [configAddress, {
    commitment: 'finalized',
    encoding: 'base64',
  }]);
  if (!accountResult.value) throw new Error('Taxi configuration account is not deployed');
  const state = decodeClockFields(Buffer.from(accountResult.value.data[0], 'base64'));
  const slotResult = await solanaRpcCall<number>(rpcUrl, 'getSlot', [{ commitment: 'finalized' }]);
  const blockTime = await solanaRpcCall<number | null>(rpcUrl, 'getBlockTime', [slotResult]);
  if (blockTime === null) throw new Error('Finalized Solana block time is unavailable');
  const chainNow = BigInt(blockTime);
  const frozenNow = state.pausedAt === 0n ? chainNow : state.pausedAt;
  return {
    deploymentId: state.deploymentId,
    backendSigner: state.backendSigner,
    chainTime: chainNow,
    protocolTime: frozenNow - state.totalPausedSeconds,
    paused: state.pausedAt !== 0n,
  };
}

export function decodeClockFields(bytes: Uint8Array) {
  const configuration = decodeWorkerConfiguration(bytes);
  return {
    backendSigner: configuration.backendSigner,
    teamAccount: configuration.teamAccount,
    jupiterProgram: configuration.jupiterProgram,
    deploymentId: configuration.deploymentId,
    pausedAt: configuration.pausedAt,
    totalPausedSeconds: configuration.totalPausedSeconds,
  };
}

export function decodeWorkerConfiguration(bytes: Uint8Array): WorkerConfiguration {
  const reader = new Reader(bytes, 8);
  reader.skip(32 * 2);
  const backendSigner = reader.pubkey();
  const teamAccount = reader.pubkey();
  const jupiterProgram = reader.pubkey();
  const deploymentId = reader.take(32);
  const fareSwapNonce = reader.u64();
  const stockSwapNonces = Array.from({ length: 4 }, () => reader.u64()) as [bigint, bigint, bigint, bigint];
  const collection = reader.pubkey();
  const fareMint = reader.pubkey();
  const stockMints = Array.from({ length: 4 }, () => reader.pubkey()) as [Address, Address, Address, Address];
  for (let index = 0; index < 16; index += 1) reader.string();
  const mintPrices = Array.from({ length: 4 }, () => reader.u64()) as [bigint, bigint, bigint, bigint];
  const mintedByClass = Array.from({ length: 4 }, () => reader.u16()) as [number, number, number, number];
  const saleStarted = reader.u8() !== 0;
  const pausedAt = reader.i64();
  const totalPausedSeconds = reader.i64();
  return {
    backendSigner,
    teamAccount,
    jupiterProgram,
    deploymentId,
    fareSwapNonce,
    stockSwapNonces,
    collection,
    fareMint,
    stockMints,
    mintPrices,
    mintedByClass,
    saleStarted,
    pausedAt,
    totalPausedSeconds,
  };
}

class Reader {
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array, private offset: number) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  take(length: number): Uint8Array {
    const end = this.offset + length;
    if (end > this.bytes.length) throw new Error('Invalid Taxi configuration account');
    const result = this.bytes.slice(this.offset, end);
    this.offset = end;
    return result;
  }
  skip(length: number) { this.take(length); }
  i64(): bigint { const value = this.view.getBigInt64(this.offset, true); this.offset += 8; return value; }
  u64(): bigint { const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value; }
  u16(): number { const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u8(): number { return this.bytes[this.offset++]; }
  pubkey(): Address { return address(addressDecoder.decode(this.take(32))); }
  string() {
    const length = this.view.getUint32(this.offset, true);
    this.offset += 4;
    this.skip(length);
  }
}
