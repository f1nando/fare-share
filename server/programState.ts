import { createHash } from 'node:crypto';
import { address, getAddressDecoder, type Address } from '@solana/kit';

const addressDecoder = getAddressDecoder();
const machineDiscriminator = createHash('sha256').update('account:Machine').digest().subarray(0, 8);
export const PAGE_COUNT = 80;
export const MAX_PROGRAM_BATCH = 20;
export const EVENTS_PER_PAGE = 128;
export const MACHINE_ACCOUNT_SIZE = 189;

export interface PageCursor { count: number; minTimestamp: bigint; minEventNumber: bigint }
export interface EventQueueState { pages: PageCursor[]; nextEventNumber: bigint }
export interface RewardPoolState {
  totalActiveWeight: bigint;
  nextPool: bigint[];
  seriesEnd: bigint;
  seriesEventCutoff: bigint;
  seriesActive: boolean;
}
export interface ProgramEvent {
  timestamp: bigint;
  eventNumber: bigint;
  target: Address;
  kind: number;
  generation: number;
}
export interface EventPageState { index: number; events: ProgramEvent[] }
export interface MachineRewardState {
  activeUntil: bigint;
  scheduledGeneration: number;
  rewardGeneration: number;
  rewardActive: boolean;
  closed: boolean;
}
export interface MachineCleanupState { asset: Address; closed: boolean }

export function decodeRewardPoolState(bytes: Uint8Array): RewardPoolState {
  const reader = new Reader(bytes);
  reader.i64();
  const totalActiveWeight = reader.u64();
  reader.skip(16 * 5 + 8 * 5);
  const nextPool = Array.from({ length: 5 }, () => reader.u64());
  reader.skip(8 * 5 + 8 * 5);
  reader.i64();
  const seriesEnd = reader.i64();
  reader.i64();
  const seriesEventCutoff = reader.u64();
  const seriesActive = reader.u8() !== 0;
  return { totalActiveWeight, nextPool, seriesEnd, seriesEventCutoff, seriesActive };
}

export function decodeEventQueueState(bytes: Uint8Array): EventQueueState {
  const reader = new Reader(bytes);
  const pageCount = reader.u32();
  if (pageCount !== PAGE_COUNT) throw new Error('Invalid event queue page count');
  const pages = Array.from({ length: pageCount }, () => ({
    count: reader.u16(),
    minTimestamp: reader.i64(),
    minEventNumber: reader.u64(),
  }));
  return { pages, nextEventNumber: reader.u64() };
}

export function decodeEventPageState(bytes: Uint8Array): EventPageState {
  const reader = new Reader(bytes);
  const index = reader.u8();
  const count = reader.u32();
  const events = Array.from({ length: count }, () => ({
    timestamp: reader.i64(),
    eventNumber: reader.u64(),
    target: reader.pubkey(),
    kind: reader.u8(),
    generation: reader.u32(),
  }));
  return { index, events };
}

export function decodeMachineRewardState(bytes: Uint8Array): MachineRewardState {
  const reader = new Reader(bytes);
  reader.skip(32 + 2);
  const activeUntil = reader.i64();
  const scheduledGeneration = reader.u32();
  const rewardGeneration = reader.u32();
  const rewardActive = reader.u8() !== 0;
  const closed = reader.u8() !== 0;
  return { activeUntil, scheduledGeneration, rewardGeneration, rewardActive, closed };
}

export function decodeMachineCleanupState(bytes: Uint8Array): MachineCleanupState {
  if (bytes.length !== MACHINE_ACCOUNT_SIZE) throw new Error('Invalid Machine account size');
  if (!Buffer.from(bytes.subarray(0, 8)).equals(machineDiscriminator)) {
    throw new Error('Invalid Machine account discriminator');
  }
  const reader = new Reader(bytes);
  const asset = reader.pubkey();
  reader.skip(2 + 8 + 4 + 4 + 1);
  const closed = reader.u8() !== 0;
  return { asset, closed };
}

export function selectWritableQueuePage(queue: EventQueueState) {
  const index = queue.pages.findIndex(page => page.count < EVENTS_PER_PAGE);
  if (index < 0) throw new Error('Main event queue has no free page');
  return index;
}

export function expiryIsPrunable(event: ProgramEvent, machine: MachineRewardState) {
  if (event.kind !== 1) return false;
  if (event.generation < machine.rewardGeneration || (machine.closed && !machine.rewardActive)) {
    return true;
  }
  const currentPeriodStarted = machine.activeUntil - 5n * 24n * 60n * 60n;
  return event.generation < machine.scheduledGeneration && event.timestamp > currentPeriodStarted;
}

export function selectEventBatch(
  queue: EventQueueState,
  pool: RewardPoolState,
  protocolNow: bigint,
  pages: Map<number, EventPageState>,
  maxRemainingAccounts = 28,
) {
  const seriesEnd = pool.seriesActive ? pool.seriesEnd : protocolNow;
  const cutoff = pool.seriesActive ? pool.seriesEventCutoff : queue.nextEventNumber - 1n;
  const heaps = new Map([...pages].map(([index, page]) => [index, [...page.events]]));
  const selected: Array<{ pageIndex: number; event: ProgramEvent }> = [];
  const pageIndexes = new Set<number>();
  const targets = new Set<string>();

  while (selected.length < MAX_PROGRAM_BATCH) {
    let next: { pageIndex: number; event: ProgramEvent } | undefined;
    for (const [pageIndex, heap] of heaps) {
      const event = heap[0];
      if (!event || event.eventNumber > cutoff || event.timestamp > seriesEnd) continue;
      if (!next || before(event, next.event)) next = { pageIndex, event };
    }
    if (!next) break;
    const nextPageCount = pageIndexes.has(next.pageIndex) ? pageIndexes.size : pageIndexes.size + 1;
    const targetKey = String(next.event.target);
    const nextTargetCount = targets.has(targetKey) ? targets.size : targets.size + 1;
    if (nextPageCount + nextTargetCount > maxRemainingAccounts) break;
    selected.push(next);
    pageIndexes.add(next.pageIndex);
    targets.add(targetKey);
    heapPop(heaps.get(next.pageIndex)!);
  }
  return { selected, pageIndexes: [...pageIndexes], targets: [...targets], seriesEnd, cutoff };
}

export function queueHasReadyEvent(queue: EventQueueState, pool: RewardPoolState, protocolNow: bigint) {
  const end = pool.seriesActive ? pool.seriesEnd : protocolNow;
  const cutoff = pool.seriesActive ? pool.seriesEventCutoff : queue.nextEventNumber - 1n;
  return queue.pages.some(page => page.count > 0 && page.minTimestamp <= end && page.minEventNumber <= cutoff);
}

function heapPop(heap: ProgramEvent[]) {
  const last = heap.pop();
  if (!last || heap.length === 0) return;
  heap[0] = last;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= heap.length) return;
    let next = left;
    if (right < heap.length && before(heap[right], heap[left])) next = right;
    if (!before(heap[next], heap[index])) return;
    [heap[index], heap[next]] = [heap[next], heap[index]];
    index = next;
  }
}

function before(a: ProgramEvent, b: ProgramEvent) {
  return a.timestamp < b.timestamp || (a.timestamp === b.timestamp && a.eventNumber < b.eventNumber);
}

class Reader {
  private readonly view: DataView;
  private offset = 8;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  skip(length: number) { this.take(length); }
  take(length: number) {
    const end = this.offset + length;
    if (end > this.bytes.length) throw new Error('Invalid Taxi program account');
    const result = this.bytes.slice(this.offset, end);
    this.offset = end;
    return result;
  }
  u8() { return this.take(1)[0]; }
  u16() { const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u32() { const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  u64() { const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value; }
  i64() { const value = this.view.getBigInt64(this.offset, true); this.offset += 8; return value; }
  pubkey() { return address(addressDecoder.decode(this.take(32))); }
}
