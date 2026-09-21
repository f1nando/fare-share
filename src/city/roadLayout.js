// One isolated two-block park per district. No global cache grows as the camera
// travels; negative coordinates follow the same deterministic layout.
function districtCode(dx, dz) {
  let hash = Math.imul(dx + 137, 73856093) ^ Math.imul(dz - 71, 19349663);
  return Math.imul(hash ^ (hash >>> 16), 2246822519) >>> 0;
}
export function districtPark(x, z) {
  const dx = Math.floor(x / 4), dz = Math.floor(z / 4), hash = districtCode(dx, dz);
  if (hash % 5 === 0) return null;
  return { x: dx * 4 + 1, z: dz * 4 + 1, axis: (hash >>> 4) & 1, style: (hash >>> 6) % 3 };
}

export function parkAt(x, z) {
  const park = districtPark(x, z);
  return park && x >= park.x && x <= park.x + (park.axis === 0 ? 1 : 0) &&
    z >= park.z && z <= park.z + (park.axis === 1 ? 1 : 0) ? park : null;
}

export function roadOpen(axis, line, segment) {
  const x = axis === 0 ? segment : line - 1, z = axis === 0 ? line - 1 : segment;
  const dx = Math.floor(x / 4), dz = Math.floor(z / 4);
  if (dx * 4 + 1 !== x || dz * 4 + 1 !== z) return true;
  const hash = districtCode(dx, dz);
  return hash % 5 === 0 || ((hash >>> 4) & 1) !== 1 - axis;
}

// Whole street lines stay divided: a taxi never meets a new median halfway
// through an oncoming overtake. Crossings and missing park roads remain open.
export function boulevardRoad(axis, line) {
  return ((line - axis * 3) % 6 + 6) % 6 === 0;
}

export const MEDIAN_WIDTH = 0.34;
export const MEDIAN_INSET = 7.5;

export function straightRoadOpen(car, blockSize, stopLine) {
  const center = Math.ceil((car.position * car.direction - stopLine) / blockSize) * car.direction;
  return roadOpen(car.axis, car.line, center - (car.direction < 0 ? 1 : 0));
}

export function spawnRoadOpen(car, blockSize, stopLine) {
  return roadOpen(car.axis, car.line, Math.floor(car.position / blockSize)) &&
    roadOpen(car.axis, car.line, Math.floor((car.position + car.direction * (stopLine + 1)) / blockSize));
}

// Recycling happens outside the visible area. Move a recycled car past any
// missing segment before putting it back into the traffic simulation.
export function relocateToRoad(car, blockSize, stopLine) {
  for (let i = 0; i < 3 && !spawnRoadOpen(car, blockSize, stopLine); i++) {
    let segment = Math.floor(car.position / blockSize);
    if (roadOpen(car.axis, car.line, segment)) segment = Math.floor((car.position + car.direction * (stopLine + 1)) / blockSize);
    const exit = segment + (car.direction > 0 ? 1 : 0);
    car.position = exit * blockSize + car.direction * (stopLine + 1);
  }
}

export const CAMERA_DRIFT = Object.freeze({ x: 0.92 * 1.5, z: 0.36 * 1.5 });
