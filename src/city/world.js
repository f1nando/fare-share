export const BLOCK = 34;
export const ROAD = 6.6;
export const TRACKS = [0.82, 2.45];
export const CAR_GAP = 2.9;
export const TRAFFIC_SPACING = 10.5;
export const TAXI_SHARE = 0.11;
export const MERGE_DURATION = 0.34;
export const STOP_LINE = ROAD / 2 + 1.5;
export const REAR_AXLE_Z = -0.69;
export const MAX_MERGE_ANGLE = Math.PI / 15;
export const FLASH_PERIOD = 0.36;
export const FLASH_DURATION = FLASH_PERIOD * 3;
export const ONCOMING_TRACK = -1;
export const trackOffset = track => track === ONCOMING_TRACK ? -TRACKS[0] : TRACKS[track];

export function headlightsOn(car) {
  return car.taxi && typeof car.flashAge === 'number' && car.flashAge < FLASH_DURATION &&
    car.flashAge % FLASH_PERIOD < 0.17;
}

export function resetSignal(car) {
  car.crossing = undefined;
  car.flashAge = null;
  car.flashCooldown = 0;
  car.signalWait = 0;
  car.yieldDelay = 0;
  car.yieldRemaining = 0;
  if (car.overtake || occupiesTrack(car, ONCOMING_TRACK)) {
    car.track = car.fromTrack = 0;
    car.offset = TRACKS[0];
    car.changing = false;
    car.merge = 1;
    car.steer = 0;
  }
  car.overtake = null;
}

function updateSignals(cars, direction, delta, green) {
  for (const car of cars) {
    if (typeof car.flashAge === 'number') {
      car.flashAge += delta;
      if (car.flashAge >= FLASH_DURATION) car.flashAge = null;
    }
    for (const key of ['flashCooldown', 'signalWait', 'yieldDelay', 'yieldRemaining']) {
      car[key] = Math.max(0, (car[key] ?? 0) - delta);
    }
  }
  if (!green || !delta) return;
  for (const taxi of cars) {
    if (!taxi.taxi || taxi.changing || taxi.flashCooldown > 0) continue;
    let leader = null, gap = 17;
    for (const other of cars) {
      const distance = (other.position - taxi.position) * direction;
      if (other !== taxi && distance > 0 && distance < gap && occupiesTrack(other, taxi.track)) {
        gap = distance; leader = other;
      }
    }
    if (!leader || leader.taxi || leader.changing || leader.yieldRemaining > 0 || taxi.cruise <= leader.speed + 1) continue;
    taxi.flashAge = 0;
    taxi.flashCooldown = 5;
    taxi.signalWait = FLASH_DURATION + 1.2;
    leader.yieldDelay = FLASH_DURATION;
    leader.yieldRemaining = FLASH_DURATION + 4;
  }
}

// Ease into a small turn, peak halfway across, then ease back to straight.
// A progress-based angle stays stable even when a taxi slows down in a gap.
export function laneChangeSteer(progress, fromTrack, toTrack) {
  if (progress <= 0 || progress >= 1) return 0;
  return Math.sign(toTrack - fromTrack) * MAX_MERGE_ANGLE * Math.sin(Math.PI * progress) ** 2;
}

export function vehiclePose(x, z, axis, direction, steer) {
  const heading = axis === 0 ? direction * Math.PI / 2 : direction > 0 ? 0 : Math.PI;
  const angle = heading - steer;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  // Keep the rear axle on its original trajectory while the body turns around it.
  return {
    x: x + REAR_AXLE_Z * (Math.sin(heading) - sin),
    z: z + REAR_AXLE_Z * (Math.cos(heading) - cos),
    angle, sin, cos,
  };
}

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

export function greenTimeLeft(time, axis) {
  return greenLight(time, axis) ? (axis === 0 ? 8 : 19) - mod(time, 22) : 0;
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
export function canMerge(car, cars, targetTrack, direction, opposing = []) {
  // Keep the return slot and borrowed lane free while an overtake is underway.
  if (targetTrack === 0 && cars.some(other => other !== car && other.overtake &&
      (car.position - other.position) * direction > -CAR_GAP * 2 &&
      (car.position - other.overtake.leader.position) * direction < CAR_GAP * 3)) return false;
  if (targetTrack === 0 && opposing.some(other => other.overtake &&
      Math.abs(other.position - car.position) < (other.cruise + car.cruise * 1.65) *
        (other.overtake.remaining + MERGE_DURATION) + CAR_GAP * 2)) return false;
  return cars.every(other => {
    if (other === car || !occupiesTrack(other, targetTrack)) return true;
    const gap = (other.position - car.position) * direction;
    const futureGap = gap + (other.speed - car.speed) * MERGE_DURATION;
    return gap > 0
      ? Math.min(gap, futureGap) > CAR_GAP + 0.15
      : Math.max(gap, futureGap) < -CAR_GAP - 0.15;
  });
}

function startMerge(car, track) {
  car.fromTrack = car.track;
  car.track = track;
  car.changing = true;
  car.merge = 0;
  car.mergeSpeed = car.speed;
}

function planOvertake(car, leader, cars, opposing, direction, blockSize, greenRemaining) {
  if (!leader || leader.changing || car.cruise <= leader.cruise * (leader.yieldRemaining > 0 ? 1.65 : 1) + 2) return null;
  const gap = (leader.position - car.position) * direction;
  const leaderSpeed = Math.max(leader.speed, leader.cruise * (leader.yieldRemaining > 0 ? 1.65 : 1));
  const duration = MERGE_DURATION * 2 + (gap + CAR_GAP + 1) / (car.cruise - leaderSpeed) +
    Math.max(0, car.cruise - car.speed) / (car.acceleration ?? 25);
  const intoBlock = mod(car.position * direction, blockSize);
  if (intoBlock < STOP_LINE || intoBlock > blockSize - STOP_LINE || duration + 0.5 > greenRemaining) return null;
  const returnSpace = CAR_GAP * 2 + 1 + car.cruise * MERGE_DURATION;
  // Reserve a slot ahead of the overtaken car, including room to straighten.
  if (cars.some(other => other !== car && other !== leader &&
      (other.overtake || (occupiesTrack(other, 0) &&
        (other.position - car.position) * direction > 0 &&
        (other.position - leader.position) * direction < returnSpace)))) return null;
  if (opposing.some(other => {
    const distance = (other.position - car.position) * direction;
    const closing = car.cruise + Math.max(other.speed, other.cruise * 1.65);
    return (occupiesTrack(other, 0) || other.overtake) &&
      distance > -CAR_GAP * 2 && distance < closing * duration + CAR_GAP * 2;
  })) return null;
  return { leader, remaining: duration, returnSpace };
}

export function updateTraffic(cars, direction, delta, green, { blockSize = BLOCK, weaving = 1, opposing, greenRemaining = Infinity, crossingAccess } = {}) {
  cars.sort((a, b) => (b.position - a.position) * direction);
  updateSignals(cars, direction, delta, green);
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
    // Reserve enough room in both lanes to complete the manoeuvre at entry speed.
    const sourceClear = !leader || gap + (leader.speed - car.speed) * MERGE_DURATION > CAR_GAP + 0.15;
    const yielding = !car.taxi && car.yieldRemaining > 0 && car.yieldDelay === 0;
    const taxiPassing = weaving > 0 && car.taxi && car.signalWait === 0 && (passing || returning);
    const overtake = !car.overtake && opposing && green && weaving > 0 && car.taxi && car.track === 0 &&
      !car.changing && car.cooldown === 0 && car.signalWait <= 1.2 && gap < 18 && sourceClear
      ? planOvertake(car, leader, cars, opposing, direction, blockSize, greenRemaining) : null;
    if (car.overtake) {
      car.overtake.remaining = Math.max(0, car.overtake.remaining - delta);
      const passed = (car.position - car.overtake.leader.position) * direction > CAR_GAP + 0.4;
      const urgent = !green || car.overtake.remaining < MERGE_DURATION + 0.4;
      if (car.track === ONCOMING_TRACK && !car.changing && (passed || urgent) && canMerge(car, cars, 0, direction, opposing)) {
        startMerge(car, 0);
        car.cooldown = 3;
      }
    } else if (overtake) {
      car.overtake = overtake;
      startMerge(car, ONCOMING_TRACK);
    } else if (green && (yielding || taxiPassing) && !car.changing && car.cooldown === 0 &&
        sourceClear && canMerge(car, cars, 1 - car.track, direction, opposing)) {
      startMerge(car, 1 - car.track);
      car.cooldown = yielding ? 5 : 0.5 / weaving;
    }
    let clearance = ahead(car.track).gap;
    if (car.changing) clearance = Math.min(clearance, ahead(car.fromTrack).gap);
    // Headway depends on actual speed, so stopped queues compress to 0.65 units
    // between bumpers and open up again as individual drivers accelerate.
    const reservedGap = cars.find(other => other.overtake?.leader === car)?.overtake.returnSpace ?? CAR_GAP;
    const desiredGap = Math.max(reservedGap, CAR_GAP + car.speed * (car.taxi ? 0.08 : yielding ? 0.3 : 0.7));
    const cruise = car.cruise * (yielding ? 1.65 : 1);
    const desiredSpeed = Math.min(cruise, Math.max(0, (clearance - desiredGap) * (car.taxi ? 4 : 2.4)));
    const acceleration = (car.acceleration ?? (car.taxi ? 25 : 4)) * (yielding ? 2 : 1);
    // Lane changing itself never applies the normal following slowdown. Hard
    // clearance and stop-line limits below still handle newly blocked traffic.
    const speed = car.changing && !yielding
      ? Math.min(cruise, car.mergeSpeed ?? car.speed)
      : Math.min(desiredSpeed, car.speed + acceleration * delta);
    const travel = Math.min(speed * delta, Math.max(0, clearance - reservedGap));
    const permitted = crossingAccess ? crossingAccess(car, travel, green, clearance, speed) : green;
    const next = advanceVehicle(car.position, travel, direction, permitted, blockSize);
    car.speed = delta ? Math.abs(next - car.position) / delta : car.speed;
    car.position = next;
    if (car.changing) {
      car.merge = Math.min(1, car.merge + delta / MERGE_DURATION);
      const blend = car.merge * car.merge * (3 - 2 * car.merge);
      car.offset = trackOffset(car.fromTrack) + (trackOffset(car.track) - trackOffset(car.fromTrack)) * blend;
      if (car.merge === 1) {
        car.offset = trackOffset(car.track);
        car.changing = false;
        if (car.track !== ONCOMING_TRACK) car.overtake = null;
      }
    }
    car.steer = car.changing ? laneChangeSteer(car.merge, car.fromTrack, car.track) : 0;
  }
}
