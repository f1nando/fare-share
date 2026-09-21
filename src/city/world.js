import { updateBodyMotion } from './vehicleBody.js';
import { HORN_DURATION } from './hornAnimation.js';
import { LaneIndex } from './laneIndex.js';
import { nextRoadwork, workEntryDistance, workMergeClear, WORK_MARGIN } from './roadworkRules.js';

export const BLOCK = 34;
export const ROAD = 6.6;
export const SHOULDER_WIDTH = 0.55;
export const PAVED_ROAD = ROAD + SHOULDER_WIDTH * 2;
export const TRACKS = [0.82, 2.45];
export const CAR_GAP = 2.9;
export const TRAFFIC_SPACING = 10.5;
export const TAXI_SHARE = 0.11;
export const MERGE_DURATION = 0.34;
export const STOP_LINE = PAVED_ROAD / 2 + 1.5;
export const REAR_AXLE_Z = -0.69;
export const MAX_MERGE_ANGLE = Math.PI / 15;
export const FLASH_PERIOD = 0.36;
export const FLASH_DURATION = FLASH_PERIOD * 3;
export const ONCOMING_TRACK = -1;
export const SHOULDER_TRACK = 2;
export const trackOffset = track => track === ONCOMING_TRACK ? -TRACKS[0] :
  track === SHOULDER_TRACK ? PAVED_ROAD / 2 + 0.21 : TRACKS[track];
export const taxiAggression = weaving => 1 + Math.max(0, Math.min(2, weaving)) * 0.5;
export const FEINT_DURATION = 0.9;
export const FEINT_REACH = 0.58;

export function stoppingSpeed(distance, braking, delta, leaderSpeed = 0) {
  const step = braking * delta;
  return Math.max(0, Math.sqrt(step * step + leaderSpeed * leaderSpeed + 2 * braking * Math.max(0, distance)) - step);
}

export function feintPose(progress) {
  const t = Math.max(0, Math.min(1, progress));
  return {
    offset: TRACKS[0] - FEINT_REACH * Math.sin(Math.PI * t) ** 2,
    steer: -MAX_MERGE_ANGLE * 0.7 * Math.sin(Math.PI * 2 * t),
  };
}

export function headlightsOn(car) {
  return car.taxi && typeof car.flashAge === 'number' && car.flashAge < FLASH_DURATION &&
    car.flashAge % FLASH_PERIOD < 0.17;
}

export function resetSignal(car) {
  car.roundaboutApproach = false;
  car.roadworks = undefined; car.workBypass = null;
  car.rideHeight = car.rideVelocity = car.surfaceSupport = car.roadRoll = car.roadPitch = 0;
  car.wheelHeights = null;
  if (car.turn) car.steer = 0;
  car.turn = null;
  car.turnCooldown = 0;
  car.pitch = car.roll = car.pitchVelocity = car.rollVelocity = 0;
  if (car.race) finishRace(car.race);
  car.raceCooldown = 0;
  car.crossing = undefined;
  car.burst = 0;
  car.seekInner = 0;
  car.flashAge = null;
  car.hornAge = null;
  car.signalMode = null;
  car.flashCooldown = 0;
  car.signalWait = 0;
  car.yieldDelay = 0;
  car.yieldRemaining = 0;
  if (car.feint || car.overtake || occupiesTrack(car, ONCOMING_TRACK) || occupiesTrack(car, SHOULDER_TRACK)) {
    car.track = car.fromTrack = car.overtake?.returnTrack ?? (car.track === SHOULDER_TRACK ? 1 : 0);
    car.offset = trackOffset(car.track);
    car.changing = false;
    car.merge = 1;
    car.steer = 0;
  }
  car.overtake = null;
  car.feint = null;
  car.feintCooldown = 0;
  car.launchAttempt = undefined;
  car.launchChosen = false;
}

function updateSignals(cars, direction, delta) {
  for (const car of cars) {
    if (typeof car.hornAge === 'number') {
      car.hornAge += delta;
      if (car.hornAge >= HORN_DURATION) car.hornAge = null;
    }
    if (typeof car.flashAge === 'number') {
      car.flashAge += delta;
      if (car.flashAge >= FLASH_DURATION) car.flashAge = null;
    }
    for (const key of ['flashCooldown', 'signalWait', 'yieldDelay', 'yieldRemaining']) {
      car[key] = Math.max(0, (car[key] ?? 0) - delta);
    }
  }
  if (!delta) return;
  for (const taxi of cars) {
    if (!taxi.taxi || taxi.turn || taxi.overtake?.launch || taxi.changing || taxi.flashCooldown > 0) continue;
    let leader = null, gap = 17;
    for (const other of cars) {
      const distance = (other.position - taxi.position) * direction;
      if (other !== taxi && distance > 0 && distance < gap && occupiesTrack(other, taxi.track)) {
        gap = distance; leader = other;
      }
    }
    if (!leader || leader.taxi || leader.changing || leader.yieldRemaining > 0 || taxi.cruise <= leader.speed + 1) continue;
    const mode = ['flash', 'horn', 'both'][(taxi.signalIndex ?? 0) % 3];
    taxi.signalIndex = (taxi.signalIndex ?? 0) + 1;
    taxi.signalMode = mode;
    taxi.flashAge = mode === 'horn' ? null : 0;
    taxi.hornAge = mode === 'flash' ? null : 0;
    taxi.flashCooldown = 5;
    taxi.signalWait = FLASH_DURATION + 1.2;
    leader.yieldDelay = FLASH_DURATION;
    leader.yieldRemaining = FLASH_DURATION + 4;
  }
}

export function finishRace(race, winner) {
  for (const car of [race.leader, race.follower]) {
    if (car.race !== race) continue;
    car.race = null;
    car.raceCooldown = 8;
    car.raceResult = winner ? car === winner ? 'won' : 'lost' : 'ended';
    if (car === winner) car.burst = Math.max(car.burst ?? 0, 1.5);
  }
}

function updateRaces(cars, direction, delta) {
  const active = new Set();
  for (const car of cars) {
    car.raceCooldown = Math.max(0, (car.raceCooldown ?? 0) - delta);
    if (car.race) active.add(car.race);
  }
  for (const race of active) {
    const { leader, follower } = race;
    if (!cars.includes(leader) || !cars.includes(follower) || leader.race !== race || follower.race !== race ||
        Math.abs(leader.position - follower.position) > 55) {
      finishRace(race);
      continue;
    }
    race.age += delta;
    race.phase = race.age < 2.4 ? 'follow' : 'challenge';
    if ((follower.position - leader.position) * direction > CAR_GAP && !follower.changing && !follower.overtake && !leader.overtake) {
      finishRace(race, follower);
    } else if (race.age > 12 && !follower.overtake && !leader.overtake) finishRace(race);
  }
  if (!delta) return;
  for (const follower of cars) {
    if (!follower.taxi || follower.turn || follower.overtake?.launch || follower.race || follower.raceCooldown > 0 || follower.feint) continue;
    const leader = cars.find(other => other !== follower && other.taxi && !other.turn && !other.overtake?.launch && !other.race && !other.feint &&
      (other.raceCooldown ?? 0) === 0 && (other.position - follower.position) * direction > CAR_GAP + 1 &&
      (other.position - follower.position) * direction < 24);
    if (!leader) continue;
    const race = { leader, follower, age: 0, phase: 'follow' };
    leader.race = follower.race = race;
    leader.raceResult = follower.raceResult = null;
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
  return car.track === track || (car.changing && car.fromTrack === track) || (track === ONCOMING_TRACK && !!car.feint);
}

// Test both the current gap and where its neighbours will be during the merge.
export function canMerge(car, cars, targetTrack, direction, opposing = []) {
  if (!workMergeClear(car, targetTrack, direction, MERGE_DURATION)) return false;
  // Keep the return slot and borrowed lane free while an overtake is underway.
  if (cars.some(other => other !== car && other.overtake && targetTrack === (other.overtake.returnTrack ?? 0) &&
      !(car.overtake && (car.position - other.position) * direction > CAR_GAP) &&
      (car.position - other.position) * direction > -CAR_GAP * 2 &&
      (car.position - other.overtake.leader.position) * direction < other.overtake.returnSpace + CAR_GAP)) return false;
  if (targetTrack === 0 && opposing.some(other => {
    const borrowedTime = other.feint ? FEINT_DURATION - other.feint.age :
      other.overtake && (other.overtake.passTrack ?? ONCOMING_TRACK) === ONCOMING_TRACK ? other.overtake.remaining : 0;
    return borrowedTime > 0 && Math.abs(other.position - car.position) < (other.cruise + car.cruise * 1.65) *
      (borrowedTime + MERGE_DURATION) + CAR_GAP * 2;
  })) return false;
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

function maximumTravel(speed, acceleration, cruise, duration) {
  const accelerating = Math.min(duration, Math.max(0, cruise - speed) / acceleration);
  return speed * accelerating + acceleration * accelerating ** 2 / 2 + cruise * (duration - accelerating);
}

function canFeint(car, opposing, direction, blockSize) {
  const intoBlock = mod(car.position * direction, blockSize);
  if (intoBlock < STOP_LINE + 1 || intoBlock > blockSize - STOP_LINE - 1) return false;
  let approaching = false;
  const travel = maximumTravel(car.speed, (car.acceleration ?? 25) * 1.8, car.cruise * 1.25, FEINT_DURATION);
  for (const other of opposing) {
    if (!occupiesTrack(other, 0)) continue;
    const gap = (other.position - car.position) * direction;
    if (gap < -CAR_GAP * 2) continue;
    const closing = maximumTravel(other.speed, (other.acceleration ?? 4) * 2,
      Math.max(other.speed, other.cruise * 1.65), FEINT_DURATION);
    if (gap < travel + closing + CAR_GAP + 2) return false;
    if (gap < 70) approaching = true;
  }
  return approaching;
}

function planOvertake(car, leader, cars, opposing, direction, blockSize, greenRemaining, green, crossingAccess, passTrack = ONCOMING_TRACK) {
  if (car.dividedRoad && passTrack === ONCOMING_TRACK) return null;
  if (!leader || leader.turn || leader.changing) return null;
  const returnTrack = passTrack === SHOULDER_TRACK ? 1 : 0;
  const passSpeed = car.cruise * 1.25;
  const returnSpace = CAR_GAP * 2 + 1 + passSpeed * MERGE_DURATION;
  // Find the end of a compact queue, rather than demanding a landing slot
  // between every pair of stopped cars.
  const queue = cars.filter(other => other !== car && occupiesTrack(other, returnTrack) &&
    (other.position - car.position) * direction > 0).sort((a, b) => (a.position - b.position) * direction);
  let target = 0;
  while (target + 1 < queue.length && (queue[target + 1].position - queue[target].position) * direction < returnSpace) target++;
  if (queue[target]) leader = queue[target];
  const gap = (leader.position - car.position) * direction;
  if (gap > blockSize || leader.turn || leader.changing) return null;
  const leaderSpeed = Math.max(leader.speed, leader.cruise * (leader.yieldRemaining > 0 ? 1.65 : 1));
  if (passSpeed <= leaderSpeed + 2) return null;
  const duration = MERGE_DURATION * 2 + (gap + CAR_GAP + 1) / (passSpeed - leaderSpeed) +
    Math.max(0, passSpeed - car.speed) / ((car.acceleration ?? 25) * 1.8);
  const intoBlock = mod(car.position * direction, blockSize);
  const taxiTravel = maximumTravel(car.speed, (car.acceleration ?? 25) * 1.8, passSpeed, duration);
  if (intoBlock < STOP_LINE || intoBlock > blockSize - STOP_LINE + 0.001) return null;
  // A single manoeuvre can reserve one junction, never an unchecked second one.
  if (crossingAccess && taxiTravel > blockSize * 2 - intoBlock - STOP_LINE) return null;
  if (!crossingAccess && (!green || duration + 0.5 > greenRemaining)) return null;
  // Reserve a slot ahead of the overtaken car, including room to straighten.
  if (cars.some(other => other !== car && other.overtake &&
      !(car.race?.phase === 'follow' && car.race.leader === other && other.overtake.passTrack === passTrack) &&
      Math.abs(other.position - car.position) < passSpeed * (duration + other.overtake.remaining) + CAR_GAP * 2)) return null;
  if (!canMerge(car, cars, passTrack, direction, opposing)) return null;
  if (passTrack === ONCOMING_TRACK && opposing.some(other => {
    const distance = (other.position - car.position) * direction;
    const oncomingTravel = maximumTravel(other.speed, (other.acceleration ?? 4) * 2,
      Math.max(other.speed, other.cruise * 1.65), duration);
    return (occupiesTrack(other, 0) || other.overtake) &&
      distance > -CAR_GAP * 2 && distance < taxiTravel + oncomingTravel + CAR_GAP * 2;
  })) return null;
  // An overtake crossing a junction reserves that crossing before departing.
  // This prevents a taxi from getting trapped waiting on the borrowed lane.
  if (crossingAccess && taxiTravel > blockSize - intoBlock - STOP_LINE &&
      !crossingAccess(car, taxiTravel, green, Infinity, car.speed)) return null;
  return { leader, remaining: duration, returnSpace, returnTrack, passTrack };
}

function planQueueLaunch(car, cars, opposing, direction, blockSize, untilGreen, aggression, queueRandom) {
  if (car.dividedRoad && car.track === 0) return null;
  if (!car.taxi || car.changing || car.feint || car.overtake || car.turn || car.race || car.speed > 1 ||
      car.track < 0 || car.track > 1 || untilGreen < 2) return null;
  const center = Math.ceil((car.position * direction - STOP_LINE) / blockSize) * blockSize;
  const toStop = center - STOP_LINE - car.position * direction;
  if (toStop < CAR_GAP || toStop > blockSize * 0.65) return null;
  const queue = cars.filter(other => other !== car && occupiesTrack(other, car.track) &&
    (other.position - car.position) * direction > 0 && other.position * direction <= center - STOP_LINE + 0.05);
  if (!queue.length || queue.some(other => other.speed > 0.7 || other.changing || other.turn)) return null;
  if (car.launchAttempt !== center) {
    car.launchAttempt = center;
    const roll = queueRandom ? queueRandom() : seededRandom(Math.round(car.position * 100), Math.round(center + (car.line ?? 0) * 97 + (car.axis ?? 0) * 331))();
    car.launchChosen = roll < 0.3 + (aggression - 1) * 0.1;
  }
  if (!car.launchChosen) return null;
  const passTrack = car.track === 1 ? SHOULDER_TRACK : ONCOMING_TRACK;
  if (cars.some(other => other !== car && other.overtake && Math.abs(other.position - car.position) < blockSize)) return null;
  if (!canMerge(car, cars, passTrack, direction, opposing)) return null;
  // Reserve the whole route to the front row, not just the initial lateral gap.
  if (cars.some(other => other !== car && occupiesTrack(other, passTrack) &&
      (other.position - car.position) * direction > -CAR_GAP && other.position * direction < center + STOP_LINE + CAR_GAP)) return null;
  if (passTrack === ONCOMING_TRACK && opposing.some(other => {
    if (!occupiesTrack(other, 0) && !other.overtake) return false;
    const gap = (other.position - car.position) * direction;
    if (gap < -CAR_GAP * 2) return false;
    const duringRed = maximumTravel(other.speed, (other.acceleration ?? 4) * 2,
      Math.max(other.speed, other.cruise * (other.taxi ? 1.25 : 1.65)), untilGreen);
    const redPosition = other.taxi ? other.position - direction * duringRed :
      advanceVehicle(other.position, duringRed, -direction, false, blockSize);
    const redEndSpeed = !other.taxi && Math.abs(redPosition - other.position) < duringRed - 0.001 ? 0 :
      Math.max(other.speed, other.cruise * (other.taxi ? 1.25 : 1.65));
    const afterGreen = maximumTravel(redEndSpeed,
      (other.acceleration ?? 4) * 2, other.cruise * (other.taxi ? 1.25 : 1.65), 2.5);
    return (redPosition - car.position) * direction < toStop + car.cruise * 2 + afterGreen + CAR_GAP * 2;
  })) return null;
  const leader = queue.reduce((front, other) => other.position * direction > front.position * direction ? other : front);
  return { leader, remaining: untilGreen + 4, returnSpace: CAR_GAP * 2 + 1 + car.cruise * 1.25 * MERGE_DURATION,
    returnTrack: car.track, passTrack, launch: { center: center * direction, phase: 'staging' } };
}

export function updateTraffic(cars, direction, delta, green, { blockSize = BLOCK, weaving = 1, opposing, greenRemaining = Infinity, untilGreen = 0, queueRandom, crossingAccess } = {}) {
  const aggression = taxiAggression(weaving);
  cars.sort((a, b) => (b.position - a.position) * direction);
  updateRaces(cars, direction, delta);
  updateSignals(cars, direction, delta);
  const index = new LaneIndex(cars, direction, occupiesTrack);
  for (const car of cars) {
    // Turning cars retain their source-lane slot until the network transfers
    // them. Their curved motion is advanced exactly once after straight traffic.
    if (car.turn) continue;
    const previousLeader = car.overtake?.leader;
    if (green) { car.launchAttempt = undefined; car.launchChosen = false; }
    const previousSpeed = car.speed;
    car.cooldown = Math.max(0, car.cooldown - delta);
    car.burst = Math.max(0, (car.burst ?? 0) - delta);
    car.seekInner = Math.max(0, (car.seekInner ?? 0) - delta);
    car.feintCooldown = Math.max(0, (car.feintCooldown ?? 0) - delta);
    const ahead = track => index.ahead(car, track);
    const { gap, leader } = ahead(car.track);
    const work = nextRoadwork(car, direction);
    const workDistance = work ? workEntryDistance(work, car.position, direction) : Infinity;
    const workApproach = work && car.track === 1 && workDistance < Math.max(18, car.speed * car.speed / (car.taxi ? 26 : 14) + car.speed * 0.6 + 4);
    const queueLaunch = !car.roadEnd && !car.roundaboutApproach && !green && delta > 0 && opposing ? planQueueLaunch(car, cars, opposing, direction, blockSize, untilGreen, aggression, queueRandom) : null;
    const { gap: targetGap, leader: targetLeader } = car.taxi ? ahead(1 - car.track) : { gap: Infinity, leader: null };
    const fasterLane = targetLeader && leader && targetLeader.speed > leader.speed + 1;
    const passing = gap < 24 && (targetGap > gap + 0.4 || fasterLane);
    // Come back towards the centre after passing. Raising activity shortens the
    // cooldown; it must not send taxis into the outer lane half a block early.
    const returning = car.track === 1 && (car.seekInner > 0 || gap > 16 && targetGap > 12);
    // Reserve enough room in both lanes to complete the manoeuvre at entry speed.
    const sourceClear = !leader || gap + (leader.speed - car.speed) * MERGE_DURATION >= CAR_GAP - 1e-6;
    const yielding = !car.taxi && car.yieldRemaining > 0 && car.yieldDelay === 0;
    const following = car.race?.follower === car && car.race.phase === 'follow';
    const challenging = car.race?.follower === car && car.race.phase === 'challenge';
    const chaseTrack = following ? car.race.leader.track : challenging ? 1 - car.race.leader.track : null;
    const chaseMerge = (chaseTrack === 0 || chaseTrack === 1) && chaseTrack !== car.track;
    const taxiPassing = car.taxi && (!green || car.signalWait === 0) && (following ? chaseMerge : passing || returning || challenging && chaseMerge);
    const overtake = !car.roadEnd && !car.roundaboutApproach && !queueLaunch && !car.overtake && opposing && (green || crossingAccess) && car.taxi && (car.track === 0 || car.track === 1) &&
      (!following || car.race.leader.overtake?.returnTrack === car.track) &&
      !car.changing && !car.feint && car.cooldown === 0 && !(car.track === 1 && car.seekInner > 0) && gap < 28 && sourceClear
      ? planOvertake(car, leader, cars, opposing, direction, blockSize, greenRemaining, green, crossingAccess,
        car.track === 1 ? SHOULDER_TRACK : ONCOMING_TRACK) : null;
    const workMerge = workApproach && !car.changing && !car.feint && sourceClear && workDistance >= car.speed * MERGE_DURATION + WORK_MARGIN - 1e-6
      ? canMerge(car, cars, 0, direction, opposing) ? 0 : car.taxi && canMerge(car, cars, SHOULDER_TRACK, direction, opposing) ? SHOULDER_TRACK : null
      : null;
    if (car.feint) {
      car.feint.age = Math.min(FEINT_DURATION, car.feint.age + delta);
    } else if (car.workBypass) {
      const exit = (direction > 0 ? car.workBypass.end : -car.workBypass.start);
      if (!car.changing && car.position * direction > exit + WORK_MARGIN && canMerge(car, cars, 1, direction, opposing)) {
        startMerge(car, 1); car.workBypass = null; car.cooldown = 1;
      }
    } else if (workMerge !== null) {
      car.overtake = null;
      if (car.race) finishRace(car.race);
      if (workMerge === SHOULDER_TRACK) car.workBypass = work;
      startMerge(car, workMerge); car.cooldown = 1;
      car.workAvoidances = (car.workAvoidances ?? 0) + 1;
    } else if (car.overtake) {
      const launch = car.overtake.launch;
      if (launch && launch.phase !== 'go' && green) {
        launch.phase = 'go';
        car.overtake.remaining = 4;
        car.burst = 4;
        car.launchesStarted = (car.launchesStarted ?? 0) + 1;
      }
      const waiting = launch && launch.phase !== 'go';
      if (waiting && Math.abs(car.position - (launch.center - direction * STOP_LINE)) < 0.05) launch.phase = 'ready';
      if (waiting) car.overtake.remaining = untilGreen + 4;
      else car.overtake.remaining = Math.max(0, car.overtake.remaining - delta);
      const passed = (car.position - car.overtake.leader.position) * direction > CAR_GAP + 0.4;
      const urgent = car.overtake.remaining < MERGE_DURATION + 0.4;
      const homeTrack = car.overtake.returnTrack ?? 0;
      if (!waiting && car.track === (car.overtake.passTrack ?? ONCOMING_TRACK) && !car.changing && (passed || urgent) && canMerge(car, cars, homeTrack, direction, opposing)) {
        startMerge(car, homeTrack);
        car.cooldown = 1.5 / aggression;
      }
    } else if (queueLaunch) {
      car.overtake = queueLaunch;
      car.crossing = undefined;
      car.launchesPrepared = (car.launchesPrepared ?? 0) + 1;
      startMerge(car, queueLaunch.passTrack);
    } else if (overtake) {
      car.overtake = overtake;
      car.burst = overtake.remaining + 0.8;
      startMerge(car, overtake.passTrack);
    } else if (!car.roadEnd && !car.roundaboutApproach && !car.dividedRoad && opposing && !following && car.taxi && car.track === 0 && !car.changing && car.cooldown === 0 &&
        car.feintCooldown === 0 && gap < 22 && leader && sourceClear && canFeint(car, opposing, direction, blockSize)) {
      car.feint = { age: 0 };
      car.feintCooldown = 5 / aggression;
      car.cooldown = FEINT_DURATION + 0.25;
    } else if ((yielding || taxiPassing) && !car.changing && car.cooldown === 0 &&
        sourceClear && canMerge(car, cars, 1 - car.track, direction, opposing)) {
      startMerge(car, 1 - car.track);
      if (car.taxi) car.burst = 1.4;
      car.cooldown = yielding ? 5 : 0.35 + 0.45 / aggression;
    }
    const front = ahead(car.track);
    let clearance = front.gap, frontSpeed = front.leader?.speed ?? 0;
    if (car.changing) {
      const source = ahead(car.fromTrack);
      if (source.gap < clearance) { clearance = source.gap; frontSpeed = source.leader?.speed ?? 0; }
    }
    if (following) {
      const raceGap = Math.max(CAR_GAP, (car.race.leader.position - car.position) * direction);
      if (raceGap < clearance) { clearance = raceGap; frontSpeed = car.race.leader.speed; }
    }
    const crossingClearance = clearance;
    if (car.overtake?.launch && occupiesTrack(car, ONCOMING_TRACK)) {
      for (const other of opposing ?? []) {
        const distance = (other.position - car.position) * direction;
        if (occupiesTrack(other, 0) && distance > 0 && distance < clearance) { clearance = distance; frontSpeed = 0; }
      }
    }
    // Headway depends on actual speed, so stopped queues compress to 0.65 units
    // between bumpers and open up again as individual drivers accelerate.
    const reservedGap = index.reservation(car)?.returnSpace ?? CAR_GAP;
    const desiredGap = Math.max(reservedGap, CAR_GAP + car.speed * (car.taxi ? 0.08 : yielding ? 0.3 : 0.7));
    // Race boosts remain inside the 25% passing-speed envelope used by gap
    // predictions. The follower only attacks after copying the leader's move.
    const cruise = car.cruise * (yielding ? 1.65 : car.burst > 0 || challenging ? 1.25 : car.race ? 1.05 : 1);
    const desiredSpeed = Math.min(cruise, Math.max(0, frontSpeed + (clearance - desiredGap) * (car.taxi ? 2 : 1.4)));
    const acceleration = (car.acceleration ?? (car.taxi ? 25 : 4)) * (yielding ? 2 : car.burst > 0 ? 1.8 : 1);
    const braking = car.taxi ? 13 : 7;
    const workClearance = work && occupiesTrack(car, 1) ? workDistance - WORK_MARGIN : Infinity;
    // Lane changing itself never applies the normal following slowdown. Hard
    // clearance and stop-line limits below still handle newly blocked traffic.
    let speed = car.changing && !yielding && (car.mergeSpeed ?? car.speed) > 1
      ? Math.min(cruise, car.mergeSpeed ?? car.speed)
      : Math.max(car.speed - braking * delta, Math.min(desiredSpeed, car.speed + acceleration * delta));
    if (!car.changing && Number.isFinite(clearance)) speed = Math.min(speed, stoppingSpeed(clearance - CAR_GAP, braking, delta, frontSpeed));
    if (Number.isFinite(workClearance)) speed = Math.min(speed, stoppingSpeed(workClearance, braking, delta));
    const oriented = car.position * direction;
    const untilStop = Math.ceil((oriented - STOP_LINE) / blockSize) * blockSize - STOP_LINE - oriented;
    if (speed > 0 && untilStop >= -0.001 && untilStop < car.speed * car.speed / (2 * braking) + car.speed * 0.15 + 1) {
      const mustWait = car.overtake?.launch && !green || (crossingAccess?.preview
        ? !crossingAccess.preview(car, untilStop + 0.01, green, crossingClearance, speed) : !green);
      if (mustWait) speed = Math.min(speed, stoppingSpeed(untilStop, braking, delta));
    }
    // A reserved return slot is a following target, not an invisible bumper.
    // Only actual vehicle clearance can hard-limit this frame's travel.
    const travel = Math.min(speed * delta, Math.max(0, clearance - CAR_GAP), Math.max(0, workClearance));
    // Before the stop line, this step cannot enter the intersection. Keep live
    // claims updated, but avoid scanning cross traffic for the rest of the queue.
    const needsAccess = travel > untilStop || car.crossing !== undefined;
    const permitted = car.overtake?.launch && !green ? false : crossingAccess && needsAccess ? crossingAccess(car, travel, green, crossingClearance, speed) : green;
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
        if (car.overtake && car.track === (car.overtake.returnTrack ?? 0)) {
          if (car.overtake.launch?.phase === 'go' && (car.position - car.overtake.leader.position) * direction > CAR_GAP)
            car.launchesCompleted = (car.launchesCompleted ?? 0) + 1;
          if (car.overtake.passTrack === SHOULDER_TRACK) car.seekInner = 3;
          car.overtake = null;
        }
      }
    }
    car.steer = car.changing ? laneChangeSteer(car.merge, car.fromTrack, car.track) : 0;
    if (car.feint) {
      const pose = feintPose(car.feint.age / FEINT_DURATION);
      car.offset = pose.offset;
      car.steer = pose.steer;
      if (car.feint.age === FEINT_DURATION) {
        car.feint = null;
        car.offset = TRACKS[car.track];
        car.steer = 0;
      }
    }
    updateBodyMotion(car, delta, previousSpeed);
    index.sync(car, previousLeader);
  }
}
