export const BLOCK = 34;
export const ROAD = 6.6;
export const TRACKS = [0.82, 2.45];
export const CAR_GAP = 2.9;
export const TRAFFIC_SPACING = 10.5;
export const TAXI_SHARE = 0.11;
export const MERGE_DURATION = 0.34;
export const STOP_LINE = ROAD / 2 + 1.5;

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

export function advanceVehicle(position, distance, direction, green, blockSize = BLOCK) {
  const oriented = position * direction;
  const untilJunction = blockSize - mod(oriented, blockSize);
  const untilStop = untilJunction - STOP_LINE;
  if (!green && untilStop >= -0.001 && untilStop < distance) {
    return position + direction * Math.max(0, untilStop);
  }
  return position + direction * distance;
}

export function occupiesTrack(car, track) {
  return car.track === track || (car.changing && car.fromTrack === track);
}

// Test both the current gap and where its neighbours will be during the merge.
export function canMerge(car, cars, targetTrack, direction, mergeSpeed = car.speed) {
  return cars.every(other => {
    if (other === car || !occupiesTrack(other, targetTrack)) return true;
    const gap = (other.position - car.position) * direction;
    const futureGap = gap + (other.speed - mergeSpeed) * MERGE_DURATION;
    return gap > 0
      ? Math.min(gap, futureGap) > CAR_GAP + 0.15
      : Math.max(gap, futureGap) < -CAR_GAP - 0.15;
  });
}

export function updateTraffic(cars, direction, delta, green, { blockSize = BLOCK, weaving = 1 } = {}) {
  cars.sort((a, b) => (b.position - a.position) * direction);
  for (const car of cars) {
    car.cooldown = Math.max(0, car.cooldown - delta);
    // Find the nearest car, independent of the array's farthest-first ordering.
    const ahead = (track) => {
      let gap = Infinity, leader = null;
      for (const other of cars) {
        const distance = (other.position - car.position) * direction;
        if (other !== car && distance > 0 && distance < gap && occupiesTrack(other, track)) {
          gap = distance;
          leader = other;
        }
      }
      return { gap, leader };
    };
    const { gap, leader } = ahead(car.track);
    const { gap: targetGap, leader: targetLeader } = ahead(1 - car.track);
    const fasterLane = targetLeader && leader && targetLeader.speed > leader.speed + 1;
    const passing = gap < 28 * Math.max(0.5, weaving) && (targetGap > gap + 0.4 || fasterLane);
    const returning = car.track === 1 && gap > 26 && targetGap > 20;
    // Match the speed of a narrow slot, then accelerate out of it. This lets a
    // taxi use gaps that would be unsafe to enter at its full cruising speed.
    const mergeSpeed = targetLeader ? Math.min(car.speed, targetLeader.speed) : car.speed;
    if (weaving > 0 && car.taxi && !car.changing && car.cooldown === 0 && (passing || returning) &&
        canMerge(car, cars, 1 - car.track, direction, mergeSpeed)) {
      car.fromTrack = car.track;
      car.track = 1 - car.track;
      car.changing = true;
      car.merge = 0;
      car.cooldown = 0.5 / weaving;
      car.speed = mergeSpeed;
    }
    let clearance = ahead(car.track).gap;
    if (car.changing) clearance = Math.min(clearance, ahead(car.fromTrack).gap);
    // Headway depends on actual speed, so stopped queues compress to 0.65 units
    // between bumpers and open up again as individual drivers accelerate.
    const desiredGap = CAR_GAP + car.speed * (car.taxi ? 0.08 : 0.7);
    const desiredSpeed = Math.min(car.cruise, Math.max(0, (clearance - desiredGap) * (car.taxi ? 4 : 2.4)));
    const acceleration = car.acceleration ?? (car.taxi ? 25 : 4);
    const speed = Math.min(desiredSpeed, car.speed + acceleration * delta);
    const travel = Math.min(speed * delta, Math.max(0, clearance - CAR_GAP));
    const next = advanceVehicle(car.position, travel, direction, green, blockSize);
    car.speed = delta ? Math.abs(next - car.position) / delta : 0;
    car.position = next;
    const previousOffset = car.offset;
    if (car.changing) {
      car.merge = Math.min(1, car.merge + delta / MERGE_DURATION);
      const blend = car.merge * car.merge * (3 - 2 * car.merge);
      car.offset = TRACKS[car.fromTrack] + (TRACKS[car.track] - TRACKS[car.fromTrack]) * blend;
      if (car.merge === 1) {
        car.offset = TRACKS[car.track];
        car.changing = false;
      }
    }
    car.steer = delta && car.speed > 0.5 ? Math.atan2((car.offset - previousOffset) / delta, car.speed) : 0;
  }
}
