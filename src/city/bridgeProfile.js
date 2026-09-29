import { PAVED_ROAD } from './world.js';
import { streetHalf } from './roadProfile.js';

export const canalColumn = column => column % 12 === 0;
export const canalBridge = line => line % 2 === 0;
export const BRIDGE_SEGMENTS = 8;
export const BRIDGE_START = PAVED_ROAD / 2 + 2.5;
export const BRIDGE_HALF = PAVED_ROAD / 2 + 1.75;
// The deck and wheel support must include the boulevard's third lane.
export const bridgeHalfWidth = line => streetHalf(0, line) + 1.75;

export function bridgeHeight(localX, block) {
  const t = (localX - BRIDGE_START) / (block - 2 * BRIDGE_START);
  if (t <= 0 || t >= 1) return 0;
  const sample = t * BRIDGE_SEGMENTS, i = Math.floor(sample), f = sample - i;
  const peak = Math.min(2.4, block * 0.06);
  const a = Math.sin(Math.PI * i / BRIDGE_SEGMENTS) ** 2;
  const b = Math.sin(Math.PI * (i + 1) / BRIDGE_SEGMENTS) ** 2;
  return peak * (a + (b - a) * f);
}

export function bridgeHeightAt(x, z, block) {
  const column = Math.floor(x / block), line = Math.round(z / block);
  if (!canalColumn(column) || !canalBridge(line) || Math.abs(z - line * block) > bridgeHalfWidth(line)) return 0;
  return bridgeHeight(x - column * block, block);
}

// Apply only to visible poses, after Worker interpolation. This keeps the
// traffic simulation and its suspension fast; both render paths use one profile.
export function liftBridgePose(pose, block) {
  const column = Math.floor(pose.x / block), line = Math.round(pose.z / block);
  if (!canalColumn(column) || !canalBridge(line) || Math.abs(pose.z - line * block) > bridgeHalfWidth(line) + 1) return 0;
  const sin = Math.sin(pose.angle), cos = Math.cos(pose.angle);
  let sum = 0, sides = 0, axles = 0, index = 0;
  for (const axle of [-0.69, 0.69]) for (const side of [-0.43, 0.43]) {
    const height = bridgeHeightAt(pose.x + side * cos + axle * sin, pose.z - side * sin + axle * cos, block);
    pose.wheels[index++] += height;
    sum += height; sides += Math.sign(side) * height; axles += Math.sign(axle) * height;
  }
  const lift = sum / 4;
  pose.lift += lift;
  pose.pitch -= Math.atan2(axles / 2, 1.38);
  pose.roll += Math.atan2(sides / 2, 0.86);
  return lift;
}
