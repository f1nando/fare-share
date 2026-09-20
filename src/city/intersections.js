import { CAR_GAP, STOP_LINE, greenLight } from './world.js';

// Cars hold the crossing until their rear has cleared it. Both road axes use
// the same live car objects, so permission granted earlier in a frame is visible
// to the perpendicular stream immediately.
export function intersectionAccess(lanes, blockSize, time) {
  return (car, travel, green, clearance, speed) => {
    const oriented = car.position * car.direction;
    if (car.crossing !== undefined) {
      if (oriented <= car.crossing * car.direction + STOP_LINE) return true;
      car.crossing = undefined;
    }
    const center = Math.ceil((oriented - STOP_LINE) / blockSize) * blockSize;
    const untilEntry = center - STOP_LINE - oriented;
    // Also register cars created inside a crossing when the camera reveals it.
    if (untilEntry < -0.001) {
      car.crossing = center * car.direction;
      return true;
    }
    if (travel <= untilEntry) return green;
    if (!green && (!car.taxi || car.changing)) return false;
    if (clearance < untilEntry + STOP_LINE * 2 + CAR_GAP) return false;

    const crossingPosition = center * car.direction;
    const crossLine = Math.round(crossingPosition / blockSize);
    const crossCenter = car.line * blockSize;
    const distance = STOP_LINE * 2 + 0.3;
    const acceleration = car.acceleration ?? 25;
    const entrySpeed = Math.min(speed, car.cruise);
    const accelerateTime = Math.max(0, car.cruise - entrySpeed) / acceleration;
    const accelerateDistance = (entrySpeed + car.cruise) * accelerateTime / 2;
    const clearTime = distance < accelerateDistance
      ? (Math.sqrt(entrySpeed ** 2 + 2 * acceleration * distance) - entrySpeed) / acceleration
      : accelerateTime + (distance - accelerateDistance) / Math.max(0.1, car.cruise);

    for (const direction of [-1, 1]) {
      const crossLane = lanes.get(`${1 - car.axis}:${crossLine}:${direction}`);
      for (const other of crossLane?.cars ?? []) {
        const toCenter = (crossCenter - other.position) * direction;
        const inside = Math.abs(toCenter) < STOP_LINE - 0.001;
        const reserved = other.crossing === crossCenter && toCenter >= -STOP_LINE;
        if (inside || reserved) return false;
        if (!green && toCenter >= STOP_LINE && (other.taxi || greenLight(time, 1 - car.axis))) {
          const earliestArrival = (toCenter - STOP_LINE) / Math.max(0.1, other.speed, other.cruise * 1.65);
          if (earliestArrival < clearTime + 0.25) return false;
        }
      }
    }
    car.crossing = crossingPosition;
    return true;
  };
}
