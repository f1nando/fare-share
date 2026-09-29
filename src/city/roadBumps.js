import { laneOffset, streetTracks, tramRoad } from './roadProfile.js';
import { roadOpen, roadworkAt, roundaboutAt } from './roadLayout.js';
import { canalColumn } from './bridgeProfile.js';
import { REVEAL } from './revealStages.js';

const cache = new Map();
const HIT_RADIUS = 0.8;

export function roadBumpAt(axis, line, segment, block) {
  const key = `${axis}:${line}:${segment}:${block}`;
  if (cache.has(key)) return cache.get(key);
  const hash = (Math.imul(line + 71, 73856093) ^ Math.imul(segment - 29, 19349663) ^ Math.imul(axis + 1, 83492791)) >>> 0;
  let bump = null;
  if (hash % 7 < 2 && roadOpen(axis, line, segment) && !roadworkAt(axis, line, segment, block) &&
      !(axis === 0 ? canalColumn(segment) : canalColumn(line) || canalColumn(line - 1)) &&
      ![segment, segment + 1].some(cross => roundaboutAt(axis === 0 ? cross : line, axis === 0 ? line : cross))) {
    const tracks = streetTracks(axis, line).filter(track => !tramRoad(axis, line) || track !== 0);
    const track = tracks[(hash >>> 4) % tracks.length], direction = hash & 8 ? 1 : -1;
    const along = (segment + 0.5) * block;
    const across = line * block + (axis === 0 ? 1 : -1) * direction * laneOffset(axis, line, track);
    bump = { key, axis, line, segment, track, direction, kind: hash & 16 ? 'pothole' : 'manhole',
      x: axis === 0 ? along : across, z: axis === 0 ? across : along };
  }
  if (cache.size >= 2048) cache.clear();
  cache.set(key, bump);
  return bump;
}

export function populateRoadBumps(batch, gx, gz, x, z, block) {
  for (const axis of [0, 1]) {
    const bump = roadBumpAt(axis, axis === 0 ? gz : gx, axis === 0 ? gx : gz, block);
    if (!bump) continue;
    const px = x + bump.x - gx * block, pz = z + bump.z - gz * block;
    const put = (kind, y, width, height, depth, color) =>
      batch.add(kind, px, y, pz, width, height, depth, color, 0, 0, 0, REVEAL.roads);
    if (bump.kind === 'pothole') {
      put('island', 0.035, 1.15, 0.018, 1.35, '#6b6b6b');
      put('island', 0.05, 0.88, 0.018, 1.08, '#333839');
    } else {
      put('island', 0.04, 1.05, 0.025, 1.05, '#939797');
      put('island', 0.065, 0.84, 0.025, 0.84, '#565d5c');
      for (const offset of [-0.2, 0, 0.2])
        batch.add('paint', px + offset, 0.082, pz, 0.04, 0.008, 0.6, '#929796', 0, 0, 0, REVEAL.roads);
    }
  }
}

export function crossedRoadBump(before, current, block) {
  const dx = current.x - before.x, dz = current.z - before.z, distance = dx * dx + dz * dz;
  // Newly visible/recycled vehicles must not jump because of a teleport.
  if (distance < 1e-10 || distance > 144) return null;
  for (const axis of [0, 1]) {
    const line = Math.round((axis === 0 ? current.z : current.x) / block);
    const a = axis === 0 ? before.x : before.z, b = axis === 0 ? current.x : current.z;
    for (let segment = Math.floor((Math.min(a, b) - HIT_RADIUS) / block);
      segment <= Math.floor((Math.max(a, b) + HIT_RADIUS) / block); segment++) {
      const bump = roadBumpAt(axis, line, segment, block);
      if (!bump) continue;
      const bx = bump.x - before.x, bz = bump.z - before.z;
      if (bx * bx + bz * bz <= HIT_RADIUS ** 2) continue;
      const t = Math.max(0, Math.min(1, (bx * dx + bz * dz) / distance));
      if ((before.x + t * dx - bump.x) ** 2 + (before.z + t * dz - bump.z) ** 2 <= HIT_RADIUS ** 2) return bump;
    }
  }
  return null;
}

export class RoadBumpTracker {
  constructor() { this.previous = new Map(); this.frame = 0; this.block = null; }

  update(vehicles, originX, originZ, block, onHit) {
    if (this.block !== block) { this.previous.clear(); this.block = block; }
    const frame = ++this.frame;
    for (const vehicle of vehicles) {
      if (vehicle.type === 'boat' || vehicle.type === 'helicopter') continue;
      const x = vehicle.x + originX, z = vehicle.z + originZ;
      let previous = this.previous.get(vehicle.key);
      if (previous && crossedRoadBump(previous, { x, z }, block)) onHit(vehicle);
      if (!previous) { previous = {}; this.previous.set(vehicle.key, previous); }
      previous.x = x; previous.z = z; previous.frame = frame;
    }
    for (const [key, previous] of this.previous) if (previous.frame !== frame) this.previous.delete(key);
  }
}
