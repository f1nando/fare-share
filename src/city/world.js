export const BLOCK = 24;
export const ROAD = 5.8;
export const LANE = 1.48;

export function seededRandom(x, z) {
  let seed = (Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ 20260920) >>> 0;
  return () => {
    seed += 0x6d2b79f5;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mod = (value, size) => ((value % size) + size) % size;

// One shared clock lets perpendicular traffic pass in separate phases.
// The last 3 seconds of each phase clear cars from the intersection.
export function greenLight(time, axis) {
  const phase = mod(time, 22);
  return axis === 0 ? phase < 8 : phase >= 11 && phase < 19;
}

export function advanceVehicle(position, distance, direction, green) {
  const oriented = position * direction;
  const untilJunction = BLOCK - mod(oriented, BLOCK);
  const untilStop = untilJunction - 4.4;
  if (!green && untilStop >= -0.001 && untilStop < distance) {
    return position + direction * Math.max(0, untilStop);
  }
  return position + direction * distance;
}
