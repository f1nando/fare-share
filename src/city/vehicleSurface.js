import { roundaboutAt } from './roadLayout.js';
import { ROUNDABOUT_CLEARANCE } from './roundaboutDimensions.js';

export const WHEEL_SIDES = [-0.43, 0.43];
export const WHEEL_AXLES = [-0.69, 0.69];
const clamp01 = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const wheelRadius = Math.hypot(WHEEL_SIDES[1], WHEEL_AXLES[1]);

// Only a settled suspension can skip integration. An airborne car must finish
// its arc even after all four wheels have cleared the curb.
export function settleOnFlatRoad(car) {
  if (car.rideHeight || car.rideVelocity || car.surfaceSupport) return false;
  car.rideHeight = car.rideVelocity = car.surfaceSupport = car.roadRoll = 0;
  car.roadPitch = -0;
  if (!car.wheelHeights) car.wheelHeights = [0, 0, 0, 0];
  else car.wheelHeights.fill(0);
  return true;
}

// Match the generated block: a 0.25-high curb at the asphalt edge,
// then a 0.42-high pavement inset by 0.21. Crossroads remain flat asphalt.
export function roadHeight(x, z, blockSize, roadHalf) {
  const distance = value => Math.abs(value - Math.round(value / blockSize) * blockSize);
  let inset = Math.min(distance(x), distance(z)) - roadHalf;
  const gx = Math.round(x / blockSize), gz = Math.round(z / blockSize);
  if (roundaboutAt(gx, gz)) inset = Math.min(inset, Math.max(Math.abs(x - gx * blockSize), Math.abs(z - gz * blockSize)) - ROUNDABOUT_CLEARANCE);
  return 0.25 * smooth(inset / 0.1) + 0.17 * smooth((inset - 0.21) / 0.1);
}

export function updateSurfaceMotion(car, pose, delta, blockSize, roadHalf) {
  if (delta <= 0) return;
  const roadDistance = Math.min(Math.abs(pose.x - Math.round(pose.x / blockSize) * blockSize),
    Math.abs(pose.z - Math.round(pose.z / blockSize) * blockSize));
  if (roadDistance + wheelRadius < roadHalf && settleOnFlatRoad(car)) return;
  const sin = Math.sin(pose.angle), cos = Math.cos(pose.angle);
  const heights = car.wheelHeights ?? [0, 0, 0, 0];
  let sum = 0, index = 0;
  for (const axle of WHEEL_AXLES) for (const side of WHEEL_SIDES) {
    const height = roadHeight(pose.x + side * cos + axle * sin,
      pose.z - side * sin + axle * cos, blockSize, roadHalf);
    heights[index++] = height;
    sum += height;
  }
  const support = sum / 4;
  const previous = car.surfaceSupport ?? support;
  const rise = Math.max(0, support - previous);
  let height = Math.max(car.rideHeight ?? support, support);
  let velocity = (car.rideVelocity ?? 0) + rise * Math.min(14, 4 + car.speed * 0.45);
  velocity = Math.min(velocity, 3);
  // Gravity preserves a small airborne arc when climbing or dropping off the
  // curb; a damped landing gives one short after-bounce instead of constant hops.
  const steps = Math.ceil(delta / 0.01), step = delta / steps;
  for (let i = 0; i < steps; i++) {
    velocity -= 12 * step;
    height += velocity * step;
    if (height < support) {
      height = support;
      velocity = velocity < -0.7 ? -velocity * 0.2 : 0;
    }
  }
  car.rideHeight = height;
  car.rideVelocity = velocity;
  car.surfaceSupport = support;
  car.wheelHeights = heights;
  car.roadRoll = Math.atan2((heights[1] + heights[3] - heights[0] - heights[2]) / 2, 0.86);
  car.roadPitch = -Math.atan2((heights[2] + heights[3] - heights[0] - heights[1]) / 2, 1.38);
}
