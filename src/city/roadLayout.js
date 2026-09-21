import { canalColumn, canalBridge } from './bridgeProfile.js';

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
  if (axis === 0 && canalColumn(segment) && !canalBridge(line)) return false;
  const x = axis === 0 ? segment : line - 1, z = axis === 0 ? line - 1 : segment;
  const dx = Math.floor(x / 4), dz = Math.floor(z / 4);
  if (dx * 4 + 1 !== x || dz * 4 + 1 !== z) return true;
  const hash = districtCode(dx, dz);
  return hash % 5 === 0 || ((hash >>> 4) & 1) !== 1 - axis;
}

// A small four-arm roundabout per 6x6 district; no river banks or T junctions.
export function roundaboutAt(x, z) {
  if (((x % 6) + 6) % 6 !== 3 || ((z % 6) + 6) % 6 !== 1) return false;
  return !canalColumn(x) && !canalColumn(x - 1) &&
    roadOpen(0, z, x - 1) && roadOpen(0, z, x) && roadOpen(1, x, z - 1) && roadOpen(1, x, z);
}

// One possible site per 4x4 group, always away from water and missing roads.
// Coordinates own the site, so rendering, spawning and Worker agree forever.
export function roadworkAt(axis, line, segment, block) {
  const x = axis === 0 ? segment : line, z = axis === 0 ? line : segment;
  const dx = Math.floor(x / 4), dz = Math.floor(z / 4), code = districtCode(dx + 41, dz - 53);
  if (x !== dx * 4 + 1 + (code & 1) || z !== dz * 4 + 1 + ((code >>> 1) & 1) || axis !== ((code >>> 2) & 1)) return null;
  if (!roadOpen(axis, line, segment) || (axis === 0 ? canalColumn(segment) : canalColumn(line) || canalColumn(line - 1))) return null;
  const length = Math.min(6, block * 0.16), center = (segment + 0.5) * block;
  return { axis, line, segment, direction: (code & 8) ? 1 : -1, start: center - length / 2, end: center + length / 2 };
}

export function laneRoadworks(lane, block) {
  let first = Infinity, last = -Infinity;
  for (const car of lane.cars) { first = Math.min(first, car.position); last = Math.max(last, car.position); }
  first = Math.floor(first / block) - 2; last = Math.floor(last / block) + 2;
  if (lane.workFirst === first && lane.workLast === last && lane.workBlock === block) return lane.roadworks;
  const works = [];
  for (let segment = first; segment <= last; segment++) {
    const work = roadworkAt(lane.axis, lane.line, segment, block);
    if (work?.direction === lane.direction) works.push(work);
  }
  lane.workFirst = first; lane.workLast = last; lane.workBlock = block;
  return lane.roadworks = works;
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
  const cross = Math.round(car.position / blockSize);
  if (roundaboutAt(car.axis === 0 ? cross : car.line, car.axis === 0 ? car.line : cross) &&
      Math.abs(car.position - cross * blockSize) < stopLine + 1.1) return false;
  if (!roadOpen(car.axis, car.line, Math.floor(car.position / blockSize)) ||
    !roadOpen(car.axis, car.line, Math.floor((car.position + car.direction * (stopLine + 1)) / blockSize))) return false;
  if (car.track !== 1) return true;
  const work = roadworkAt(car.axis, car.line, Math.floor(car.position / blockSize), blockSize);
  if (!work || work.direction !== car.direction) return true;
  const entry = car.direction > 0 ? work.start - car.position : car.position - work.end;
  const braking = (car.speed ?? 0) ** 2 / (car.taxi ? 26 : 14) + (car.speed ?? 0) * 0.4 + 2;
  return entry > braking || entry + work.end - work.start < -2;
}

// Recycling happens outside the visible area. Move a recycled car past any
// missing segment before putting it back into the traffic simulation.
export function relocateToRoad(car, blockSize, stopLine) {
  for (let i = 0; i < 3 && !spawnRoadOpen(car, blockSize, stopLine); i++) {
    const cross = Math.round(car.position / blockSize);
    if (roundaboutAt(car.axis === 0 ? cross : car.line, car.axis === 0 ? car.line : cross) &&
        Math.abs(car.position - cross * blockSize) < stopLine + 1.1) {
      car.position = cross * blockSize + car.direction * (stopLine + 1.2);
      continue;
    }
    let segment = Math.floor(car.position / blockSize);
    const work = car.track === 1 && roadworkAt(car.axis, car.line, segment, blockSize);
    if (work && work.direction === car.direction && roadOpen(car.axis, car.line, segment)) {
      car.position = car.direction > 0 ? work.end + 2.1 : work.start - 2.1;
      continue;
    }
    if (roadOpen(car.axis, car.line, segment)) segment = Math.floor((car.position + car.direction * (stopLine + 1)) / blockSize);
    const exit = segment + (car.direction > 0 ? 1 : 0);
    car.position = exit * blockSize + car.direction * (stopLine + 1);
  }
}

export const CAMERA_DRIFT = Object.freeze({ x: 0.92 * 1.5, z: 0.36 * 1.5 });
