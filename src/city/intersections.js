import { extraHalfLength } from './vehicleTypes.js';
import { CAR_GAP, STOP_LINE, occupiesTrack, greenLight } from './world.js';
import { straightRoadOpen, roundaboutAt } from './roadLayout.js';

function arrivalTime(distance, speed, acceleration, cruise) {
  const start = Math.min(speed, cruise);
  const accelerating = Math.max(0, cruise - start) / acceleration;
  const runUp = (start + cruise) * accelerating / 2;
  return distance < runUp
    ? (Math.sqrt(start ** 2 + 2 * acceleration * distance) - start) / acceleration
    : accelerating + (distance - runUp) / Math.max(0.1, cruise);
}

// Cars hold the crossing until their rear has cleared it. Both road axes use
// the same live car objects, so permission granted earlier in a frame is visible
// to the perpendicular stream immediately.
export function intersectionAccess(lanes, blockSize, time, turnLocks = new Map(), roadLayout = false) {
  const access = (car, travel, green, clearance, speed, commit = true) => {
    if (roadLayout && !straightRoadOpen(car, blockSize, STOP_LINE)) return false;
    const oriented = car.position * car.direction;
    const nextCenter = Math.ceil((oriented - STOP_LINE) / blockSize) * blockSize * car.direction;
    // A roundabout is entered exclusively through its curved path planner.
    if (roadLayout && roundaboutAt(car.axis === 0 ? Math.round(nextCenter / blockSize) : car.line,
      car.axis === 0 ? car.line : Math.round(nextCenter / blockSize))) return false;
    const junctionKey = car.axis === 0 ? `${Math.round(nextCenter / blockSize)}:${car.line}` : `${car.line}:${Math.round(nextCenter / blockSize)}`;
    if (turnLocks.has(junctionKey)) return false;
    // A taxi waiting for a green launch may be delayed by cross traffic. Keep
    // the opposing inner lane at its stop line until it has merged back.
    if (occupiesTrack(car, 0) && lanes.get(`${car.axis}:${car.line}:${-car.direction}`)?.cars.some(other =>
      other.overtake?.passTrack === -1 && other.overtake.launch?.center === nextCenter)) return false;
    if (car.crossing !== undefined) {
      if (oriented <= car.crossing * car.direction + STOP_LINE + extraHalfLength(car)) return true;
      if (commit) car.crossing = undefined;
    }
    const center = Math.ceil((oriented - STOP_LINE) / blockSize) * blockSize;
    const untilEntry = center - STOP_LINE - oriented;
    // Also register cars created inside a crossing when the camera reveals it.
    if (untilEntry < -0.001) {
      if (commit) car.crossing = center * car.direction;
      return true;
    }
    if (travel <= untilEntry) return green;
    if (!green && (!car.taxi || car.changing)) return false;
    if (clearance < untilEntry + STOP_LINE * 2 + CAR_GAP) return false;

    const crossingPosition = center * car.direction;
    const crossLine = Math.round(crossingPosition / blockSize);
    const crossCenter = car.line * blockSize;
    const distance = STOP_LINE * 2 + 0.3 + extraHalfLength(car);
    const acceleration = car.acceleration ?? 25;
    const clearTime = arrivalTime(distance, speed, acceleration, car.cruise);

    for (const direction of [-1, 1]) {
      const crossLane = lanes.get(`${1 - car.axis}:${crossLine}:${direction}`);
      for (const other of crossLane?.cars ?? []) {
        const toCenter = (crossCenter - other.position) * direction;
        const inside = Math.abs(toCenter) < STOP_LINE + extraHalfLength(other) - 0.001;
        const reserved = other.crossing === crossCenter && toCenter >= -STOP_LINE - extraHalfLength(other);
        if (inside || reserved) return false;
        if (!green && toCenter >= STOP_LINE && (other.taxi || greenLight(time, 1 - car.axis))) {
          // A stopped queue does not instantly travel at maximum speed. Account
          // for its run-up when deciding whether the taxi fits into this gap.
          const earliestArrival = arrivalTime(toCenter - STOP_LINE, other.speed,
            (other.acceleration ?? 4) * (other.taxi ? 1.8 : 2),
            Math.max(other.speed, other.cruise * (other.taxi ? 1.25 : other.yieldRemaining > 0 ? 1.65 : 1)));
          if (earliestArrival < clearTime + 0.15) return false;
        }
      }
    }
    if (commit) {
      car.crossing = crossingPosition;
      if (car.taxi && !green && speed < car.cruise * 0.5) car.burst = Math.max(car.burst ?? 0, 1.2);
    }
    return true;
  };
  // Looking ahead must never reserve a junction or change another driver's
  // permissions. Only the actual crossing/overtake request commits the claim.
  access.preview = (car, travel, green, clearance, speed) => access(car, travel, green, clearance, speed, false);
  return access;
}
