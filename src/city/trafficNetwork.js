import { CAR_GAP, STOP_LINE, TRACKS, occupiesTrack, taxiAggression, greenLight, greenTimeLeft, updateTraffic } from './world.js';
import { intersectionAccess } from './intersections.js';
import { updateBodyMotion } from './vehicleBody.js';

const laneKey = (axis, line, direction) => `${axis}:${line}:${direction}`;
const point = (axis, along, across) => axis === 0 ? { x: along, z: across } : { x: across, z: along };
export function carCoordinates(car, blockSize) {
  if (car.turn) return turnPose(car.turn);
  return point(car.axis, car.position, car.line * blockSize + (car.axis === 0 ? 1 : -1) * car.direction * car.offset);
}

function curve(turn, t) {
  const u = 1 - t, [a, b, c, d] = turn.points;
  const at = key => u ** 3 * a[key] + 3 * u * u * t * b[key] + 3 * u * t * t * c[key] + t ** 3 * d[key];
  const tangent = key => 3 * u * u * (b[key] - a[key]) + 6 * u * t * (c[key] - b[key]) + 3 * t * t * (d[key] - c[key]);
  return { x: at('x'), z: at('z'), angle: Math.atan2(tangent('x'), tangent('z')) };
}

// Arc-length sampling keeps speed constant around the curve. A small temporary
// yaw beyond the path tangent gives a drift, with no heading snap at either end.
export function turnPose(turn) {
  const distance = Math.min(turn.length, turn.distance);
  let index = 1;
  while (index < turn.samples.length - 1 && turn.samples[index] < distance) index++;
  const start = turn.samples[index - 1], end = turn.samples[index];
  const t = (index - 1 + (distance - start) / Math.max(1e-9, end - start)) / (turn.samples.length - 1);
  const pose = curve(turn, t);
  const drift = -turn.side * 0.14 * Math.sin(Math.PI * t) ** 2;
  return { ...pose, angle: pose.angle + drift, drift, sin: Math.sin(pose.angle + drift), cos: Math.cos(pose.angle + drift) };
}

export function makeTurn(car, blockSize, side = car.track === 0 ? -1 : 1) {
  const center = Math.ceil((car.position * car.direction - STOP_LINE) / blockSize) * blockSize * car.direction;
  const crossLine = Math.round(center / blockSize);
  const axis = 1 - car.axis;
  const direction = car.direction * side * (car.axis === 0 ? 1 : -1);
  const track = side === 1 ? 1 : 0;
  const position = car.line * blockSize + direction * (STOP_LINE + 1);
  const a = carCoordinates(car, blockSize);
  const d = point(axis, position, center + (axis === 0 ? 1 : -1) * direction * TRACKS[track]);
  const incoming = point(car.axis, car.direction, 0), outgoing = point(axis, direction, 0);
  const corner = car.axis === 0 ? { x: d.x, z: a.z } : { x: a.x, z: d.z };
  const entryLength = Math.hypot(corner.x - a.x, corner.z - a.z);
  const exitLength = Math.hypot(d.x - corner.x, d.z - corner.z);
  const turn = { axis, line: crossLine, direction, track, position, side, distance: 0,
    junction: car.axis === 0 ? `${crossLine}:${car.line}` : `${car.line}:${crossLine}`,
    centerX: car.axis === 0 ? center : car.line * blockSize,
    centerZ: car.axis === 0 ? car.line * blockSize : center,
    points: [a, { x: a.x + incoming.x * entryLength * 0.7, z: a.z + incoming.z * entryLength * 0.7 },
      { x: d.x - outgoing.x * exitLength * 0.7, z: d.z - outgoing.z * exitLength * 0.7 }, d], samples: [0] };
  let previous = a;
  for (let i = 1; i <= 64; i++) {
    const current = curve(turn, i / 64);
    turn.samples.push(turn.samples.at(-1) + Math.hypot(current.x - previous.x, current.z - previous.z));
    previous = current;
  }
  turn.length = turn.samples.at(-1);
  return turn;
}

function canTurn(car, turn, lanes, blockSize, locks) {
  if (locks.has(turn.junction) || !lanes.has(laneKey(turn.axis, turn.line, turn.direction))) return false;
  // Lock only an empty crossing. This includes same-axis cars and early claims
  // from oncoming/shoulder overtakes, which can span the junction before entry.
  for (const axis of [0, 1]) for (const direction of [-1, 1]) {
    const line = Math.round((axis === 0 ? turn.centerZ : turn.centerX) / blockSize);
    const center = axis === 0 ? turn.centerX : turn.centerZ;
    for (const other of lanes.get(laneKey(axis, line, direction))?.cars ?? []) {
      if (other === car) continue;
      if (other.overtake?.leader === car) return false;
      if (Math.abs(other.position - center) < STOP_LINE - 0.001 ||
          other.crossing === center && (center - other.position) * direction >= -STOP_LINE) return false;
      // Reserve the destination track, including lane changes and cars
      // borrowing this road from the opposite direction.
      const inLandingTrack = direction === turn.direction ? occupiesTrack(other, turn.track) : turn.track === 0 && occupiesTrack(other, -1);
      if (axis === turn.axis && inLandingTrack && Math.abs(other.position - turn.position) < CAR_GAP + 1) return false;
    }
  }
  return true;
}

// One network step is shared by the renderer and traffic smoke test. Transfers
// happen after every straight lane has advanced, so no taxi moves twice/frame.
export function updateNetwork(lanes, delta, time, { blockSize = 40, weaving = 0.1, clockMultiplier = 1 } = {}) {
  if (delta <= 0) return;
  const locks = new Map();
  for (const lane of lanes.values()) for (const car of lane.cars) {
    car.turnCooldown = Math.max(0, (car.turnCooldown ?? 0) - delta);
    if (car.turn && !lanes.has(laneKey(car.turn.axis, car.turn.line, car.turn.direction))) {
      car.turn = null; car.steer = 0; // Destination fell outside the camera window.
    }
    if (car.turn) locks.set(car.turn.junction, car);
  }
  for (const lane of lanes.values()) for (const car of lane.cars) {
    if (!car.taxi || car.turn || car.turnCooldown > 0 || car.changing || car.overtake || car.feint || car.race || car.track < 0 || car.track > 1) continue;
    const center = Math.ceil((car.position * car.direction - STOP_LINE) / blockSize) * blockSize;
    const entryDistance = center - STOP_LINE - car.position * car.direction;
    if (entryDistance < -0.001 || entryDistance > Math.max(1, car.speed * delta + 0.1)) continue;
    const turn = makeTurn(car, blockSize);
    if (!canTurn(car, turn, lanes, blockSize, locks)) continue;
    car.turn = turn;
    car.crossing = undefined;
    car.flashAge = null;
    car.turnsStarted = (car.turnsStarted ?? 0) + 1;
    locks.set(turn.junction, car);
  }
  const crossingAccess = intersectionAccess(lanes, blockSize, time, locks);
  for (const lane of lanes.values()) updateTraffic(lane.cars, lane.direction, delta, greenLight(time, lane.axis), {
    blockSize, weaving, crossingAccess,
    opposing: lanes.get(laneKey(lane.axis, lane.line, -lane.direction))?.cars ?? [],
    greenRemaining: greenTimeLeft(time, lane.axis) / Math.max(0.01, clockMultiplier),
  });
  // Snapshot the active set: adding to a later lane cannot process it again.
  for (const car of locks.values()) {
    const turn = car.turn, previousSpeed = car.speed;
    car.speed = Math.min(car.cruise * 1.1, car.speed + car.acceleration * delta);
    turn.distance = Math.min(turn.length, turn.distance + car.speed * delta);
    car.steer = turn.side * 0.2 * Math.sin(Math.PI * turn.distance / turn.length);
    updateBodyMotion(car, delta, previousSpeed);
    if (turn.distance < turn.length) continue;
    const source = lanes.get(laneKey(car.axis, car.line, car.direction));
    const destination = lanes.get(laneKey(turn.axis, turn.line, turn.direction));
    source.cars.splice(source.cars.indexOf(car), 1);
    destination.cars.push(car);
    Object.assign(car, { axis: turn.axis, line: turn.line, direction: turn.direction, position: turn.position,
      track: turn.track, fromTrack: turn.track, offset: TRACKS[turn.track], steer: 0, changing: false, merge: 1,
      turn: null, turnCooldown: 12 / taxiAggression(weaving), cooldown: 0.5, crossing: undefined, burst: 1.2 });
    car.turnsCompleted = (car.turnsCompleted ?? 0) + 1;
  }
}
