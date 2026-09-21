import {
  address,
  getAddressDecoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
} from '@solana/kit';

const utf8 = getUtf8Encoder();
const addressDecoder = getAddressDecoder();

export interface ProtocolClock {
  deploymentId: Uint8Array;
  backendSigner: Address;
  protocolTime: bigint;
  paused: boolean;
}

export async function loadProtocolClock(rpcUrl: string, programId: Address): Promise<ProtocolClock> {
  const [configAddress] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8.encode('config')],
  });
  const accountResult = await rpc(rpcUrl, 'getAccountInfo', [configAddress, {
    commitment: 'finalized',
    encoding: 'base64',
  }]) as { value: { data: [string, string] } | null };
  if (!accountResult.value) throw new Error('Taxi configuration account is not deployed');
  const state = decodeClockFields(Buffer.from(accountResult.value.data[0], 'base64'));
  const slotResult = await rpc(rpcUrl, 'getSlot', [{ commitment: 'finalized' }]) as number;
  const blockTime = await rpc(rpcUrl, 'getBlockTime', [slotResult]) as number | null;
  if (blockTime === null) throw new Error('Finalized Solana block time is unavailable');
  const chainNow = BigInt(blockTime);
  const frozenNow = state.pausedAt === 0n ? chainNow : state.pausedAt;
  return {
    deploymentId: state.deploymentId,
    backendSigner: state.backendSigner,
    protocolTime: frozenNow - state.totalPausedSeconds,
    paused: state.pausedAt !== 0n,
  };
}

export function decodeClockFields(bytes: Uint8Array) {
  const reader = new Reader(bytes, 8);
  reader.skip(32 * 2);
  const backendSigner = reader.pubkey();
  const teamAccount = reader.pubkey();
  const jupiterProgram = reader.pubkey();
  const deploymentId = reader.take(32);
  reader.skip(8 + 8 * 4 + 32 * 6);
  for (let index = 0; index < 4; index += 1) reader.string();
  reader.skip(8 * 4 + 2 * 4 + 1);
  const pausedAt = reader.i64();
  const totalPausedSeconds = reader.i64();
  return { backendSigner, teamAccount, jupiterProgram, deploymentId, pausedAt, totalPausedSeconds };
}

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Solana RPC ${method} failed with HTTP ${response.status}`);
  const payload = await response.json() as { result?: unknown; error?: { message?: string } };
  if (payload.error) throw new Error(`Solana RPC ${method}: ${payload.error.message || 'unknown error'}`);
  return payload.result;
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
  pubkey(): Address { return address(addressDecoder.decode(this.take(32))); }
  string() {
    const length = this.view.getUint32(this.offset, true);
    this.offset += 4;
    this.skip(length);
  }
}
