import { parkAt, junctionArms, roundaboutAt } from './roadLayout.js';
import { canalColumn } from './bridgeProfile.js';
import { parkingAt } from './parkingLayout.js';

export const DIAGONAL_HALF = 3.1;
export const DIAGONAL_LANE = 1.45;
const mod = (n, d) => ((n % d) + d) % d;

// Isolated chords across ordinary blocks. No two candidates share a corner.
// The same deterministic layout is used by rendering and the traffic Worker.
export function diagonalAt(x, z, block = 40) {
  if (mod(x + 2 * z, 7) !== 6 || canalColumn(x) || parkAt(x, z) || parkingAt(x, z, block)) return null;
  for (const dx of [0, 1]) for (const dz of [0, 1]) if (roundaboutAt(x + dx, z + dz)) return null;
  const flip = mod(x + z, 2) === 0;
  const a = { x, z: z + (flip ? 1 : 0) }, b = { x: x + 1, z: z + (flip ? 0 : 1) };
  if (![a, b].every(p => junctionArms(p.x, p.z).every(Boolean))) return null;
  return { x, z, flip, a, b, key: `${x}:${z}` };
}

export function diagonalFromJunction(x, z, block) {
  for (const dx of [-1, 0]) for (const dz of [-1, 0]) {
    const road = diagonalAt(x + dx, z + dz, block);
    if (!road) continue;
    if (road.a.x === x && road.a.z === z) return { ...road, start: road.a, end: road.b };
    if (road.b.x === x && road.b.z === z) return { ...road, start: road.b, end: road.a };
  }
  return null;
}

export function diagonalRoadDistance(x, z, block) {
  const gx = Math.floor(x / block), gz = Math.floor(z / block);
  const road = diagonalAt(gx, gz, block);
  if (!road) return Infinity;
  const px = x - gx * block, pz = z - gz * block;
  return Math.abs(road.flip ? px + pz - block : pz - px) / Math.SQRT2;
}
