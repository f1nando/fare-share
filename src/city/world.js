export const BLOCK = 24;
export const ROAD = 5.8;
export const TRACKS = [0.7, 2.08];
export const CAR_GAP = 3.05;

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

export function occupiesTrack(car, track) {
  return car.track === track || (car.changing && car.fromTrack === track);
}

// Test both the current gap and where its neighbours will be during the merge.
export function canMerge(car, cars, targetTrack, direction) {
  return cars.every(other => {
    if (other === car || !occupiesTrack(other, targetTrack)) return true;
    const gap = (other.position - car.position) * direction;
    const futureGap = gap + (other.speed - car.speed) * 0.65;
    return gap > 0
      ? Math.min(gap, futureGap) > CAR_GAP + 0.65
      : Math.max(gap, futureGap) < -CAR_GAP - 0.65;
  });
}

export function updateTraffic(cars, direction, delta, green) {
  cars.sort((a, b) => (b.position - a.position) * direction);
  for (const car of cars) {
    car.cooldown = Math.max(0, car.cooldown - delta);
    // Find the nearest car, independent of the array's farthest-first ordering.
    const gapAhead = (track) => {
      let gap = Infinity;
      for (const other of cars) {
        const distance = (other.position - car.position) * direction;
        if (other !== car && distance > 0 && occupiesTrack(other, track)) gap = Math.min(gap, distance);
      }
      return gap;
    };
    const gap = gapAhead(car.track);
    if (car.taxi && !car.changing && car.cooldown === 0 && gap < 12 &&
        gapAhead(1 - car.track) > gap + 2 && canMerge(car, cars, 1 - car.track, direction)) {
      car.fromTrack = car.track;
      car.track = 1 - car.track;
      car.changing = true;
      car.merge = 0;
      car.cooldown = 1.15;
    }
    let clearance = gapAhead(car.track);
    if (car.changing) clearance = Math.min(clearance, gapAhead(car.fromTrack));
    const travel = Math.min(car.cruise * delta, Math.max(0, clearance - CAR_GAP));
    const next = advanceVehicle(car.position, travel, direction, green);
    car.speed = delta ? Math.abs(next - car.position) / delta : 0;
    car.position = next;
    const previousOffset = car.offset;
    if (car.changing) {
      car.merge = Math.min(1, car.merge + delta / 0.65);
      const blend = car.merge * car.merge * (3 - 2 * car.merge);
      car.offset = TRACKS[car.fromTrack] + (TRACKS[car.track] - TRACKS[car.fromTrack]) * blend;
      if (car.merge === 1) car.changing = false;
    }
    car.steer = delta && car.speed > 0.5 ? Math.atan2((car.offset - previousOffset) / delta, car.speed) : 0;
  }
}
