import { tramRoad, laneOffset } from './roadProfile.js';
import { canalColumn, bridgeHeight, BRIDGE_START, BRIDGE_SEGMENTS } from './bridgeProfile.js';
import { REVEAL } from './revealStages.js';

// Embedded rails share the existing road batch: no extra materials or draw calls.
export function populateTramTracks(batch, gx, gz, x, z, block) {
  if (tramRoad(1, gx)) {
    for (const direction of [-1, 1]) for (const side of [-1, 1]) {
      batch.add('paint', x + direction * laneOffset(1, gx, 0) + side * 0.43,
        0.045, z + block / 2, 0.075, 0.025, block, '#6b7373', 0, 0, 0, REVEAL.roads);
    }
  }
  if (!tramRoad(0, gz)) return;
  const bridge = canalColumn(gx);
  const points = bridge ? [0, ...Array.from({ length: BRIDGE_SEGMENTS + 1 }, (_, i) =>
    BRIDGE_START + (block - 2 * BRIDGE_START) * i / BRIDGE_SEGMENTS), block] : [0, block];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const ay = bridge ? bridgeHeight(a, block) : 0, by = bridge ? bridgeHeight(b, block) : 0;
    const slope = Math.atan2(by - ay, b - a);
    for (const direction of [-1, 1]) for (const side of [-1, 1]) {
      batch.add('paint', x + (a + b) / 2, (ay + by) / 2 + 0.045,
        z + direction * laneOffset(0, gz, 0) + side * 0.43,
        Math.hypot(b - a, by - ay), 0.025, 0.075, '#6b7373', 0, 0, slope, REVEAL.roads);
    }
  }
}
