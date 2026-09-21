import { CAR_GAP, STOP_LINE, resetSignal } from './world.js';

export const CAMERA_OFFSET = Object.freeze({ x: 24, y: 100, z: 45 });

export function groundExtents(width, height, offset = CAMERA_OFFSET) {
  const horizontal = Math.hypot(offset.x, offset.z);
  const verticalScale = Math.hypot(horizontal, offset.y) / offset.y;
  return {
    x: (Math.abs(offset.z) * width + Math.abs(offset.x) * height * verticalScale) / (2 * horizontal),
    z: (Math.abs(offset.x) * width + Math.abs(offset.z) * height * verticalScale) / (2 * horizontal),
  };
}

export function activeWorldSize(width, height, settings) {
  const extents = groundExtents(width, height), block = settings.blockSize;
  const taxiSpeed = 15 * settings.taxiSpeed / 100 * 1.25;
  const trafficSpeed = 7.6 * settings.trafficSpeed / 100 * 1.65;
  const stopping = Math.max(taxiSpeed ** 2 / 26 + taxiSpeed * 0.15,
    trafficSpeed ** 2 / 14 + trafficSpeed * 0.15);
  // The simulation origin stays within half a block of the camera. Include a
  // full crossing, braking distance and a bumper gap outside every screen edge.
  // This also exceeds the projected height/shadow of the tallest buildings.
  const buffer = Math.max(block, stopping + STOP_LINE * 2 + CAR_GAP);
  return { x: Math.max(2, Math.ceil((extents.x + buffer + block / 2) / block)),
    z: Math.max(2, Math.ceil((extents.z + buffer + block / 2) / block)), extents, buffer };
}

export const originShift = (focus, blockSize) => Math.floor(focus / blockSize + 0.5);

// Resize only offscreen population. Keep every car in the visible part of a
// retained street, and fill newly exposed simulation buffers at the same density.
export function resizeLanePopulation(lane, generated, center, half, visibleHalf, allow = () => true) {
  const kept = [], removed = [];
  for (const car of lane.cars) (Math.abs(car.position - center) <= half ? kept : removed).push(car);
  const target = generated.cars.length;
  for (let i = kept.length - 1; i >= 0 && kept.length > target; i--) {
    if (Math.abs(kept[i].position - center) > visibleHalf + 10) removed.push(...kept.splice(i, 1));
  }
  for (const car of generated.cars) {
    if (kept.length >= target) break;
    if (car.position < center - half) { car.position += half * 2; if(car.parking)resetSignal(car); }
    if (car.position > center + half) { car.position -= half * 2; if(car.parking)resetSignal(car); }
    if (!allow(car)) continue;
    if (Math.abs(car.position - center) <= visibleHalf + 10) continue;
    if (kept.some(other => Math.abs(other.position - car.position) < CAR_GAP &&
      (other.track === car.track || other.changing && other.fromTrack === car.track))) continue;
    kept.push(car);
  }
  for (const car of removed) resetSignal(car);
  lane.cars = kept; lane.radius = generated.radius;
}

export function releaseOutsideLanes(previous, next) {
  // A long approach can remain visible after its source street leaves the
  // window. Retain only its travelling cars until they reach a retained exit.
  for(const [key,lane] of previous)if(!next.has(key)){
    const cars=lane.cars.filter(car=>car.turn?.kind==='diagonal'&&next.has(`${car.turn.axis}:${car.turn.line}:${car.turn.direction}`));
    if(cars.length)next.set(key,{...lane,cars});
  }
  const active = new Set();
  for (const lane of next.values()) for (const car of lane.cars) active.add(car);
  for (const [key, lane] of previous) if (!next.has(key)) for (const car of lane.cars) resetSignal(car);
  for (const car of active) {
    if (car.overtake && !active.has(car.overtake.leader) || car.turn && !next.has(`${car.turn.axis}:${car.turn.line}:${car.turn.direction}`)) resetSignal(car);
    if (car.race && (!active.has(car.race.leader) || !active.has(car.race.follower))) resetSignal(car);
  }
}
