import { seededRandom, TRACKS, CAR_GAP, STOP_LINE, occupiesTrack, updateTraffic, greenLight, greenTimeLeft, resetSignal } from '../src/city/world.js';
import { intersectionAccess } from '../src/city/intersections.js';

const lanes = new Map(), radius = 2, blockSize = 40, half = (radius + 0.5) * blockSize;
const weaving = Number(process.argv[2] ?? 0.1);
for (const axis of [0, 1]) for (let line = -radius; line <= radius; line++) for (const direction of [-1, 1]) {
  const random = seededRandom(line * 7 + axis, direction * 991), cars = [];
  for (const track of [0, 1]) for (let i = 0; i < 13; i++) {
    const taxi = random() < 0.07, cruise = taxi ? 13 + random() * 2 : 3.4 + random() * 4.2;
    const acceleration = taxi ? 24 + random() * 5 : 2.2 + random() * 4;
    const position = -radius * blockSize + i * 15 + track * 7.5 + random() * 1.5;
    random(); // Same palette choice as the renderer.
    cars.push({ axis, line, direction, taxi, position, track, fromTrack: track, offset: TRACKS[track],
      cruise: cruise * (taxi ? 1.2 : 1.3), speed: cruise, acceleration: acceleration * (taxi ? 1.2 : 1.3),
      changing: false, merge: 1, cooldown: random(), steer: 0 });
  }
  lanes.set(`${axis}:${line}:${direction}`, { axis, line, direction, cars });
}
const counts = { redCrossings: 0, oncomingOvertakes: 0, completedOvertakes: 0, abortedOvertakes: 0, oncomingConflicts: 0 };
for (let frame = 0; frame < 1500; frame++) {
  const time = frame * 0.04, crossingAccess = intersectionAccess(lanes, blockSize, time);
  for (const lane of lanes.values()) for (const car of lane.cars) {
    if (car.position < -half) { car.position += half * 2; resetSignal(car); }
    if (car.position > half) { car.position -= half * 2; resetSignal(car); }
  }
  for (const lane of lanes.values()) {
    const before = lane.cars.map(car => [car, car.position, car.overtake]);
    const green = greenLight(time, lane.axis);
    updateTraffic(lane.cars, lane.direction, 0.04, green, { blockSize, weaving, crossingAccess,
      opposing: lanes.get(`${lane.axis}:${lane.line}:${-lane.direction}`).cars,
      greenRemaining: greenTimeLeft(time, lane.axis) });
    for (const [car, position, passing] of before) {
      if (!car.taxi) continue;
      if (car.overtake && !passing) counts.oncomingOvertakes++;
      if (!car.overtake && passing) {
        if ((car.position - passing.leader.position) * lane.direction >= CAR_GAP) counts.completedOvertakes++;
        else counts.abortedOvertakes++;
      }
      if (!green && Math.floor((position * lane.direction + STOP_LINE) / blockSize) !==
          Math.floor((car.position * lane.direction + STOP_LINE) / blockSize)) counts.redCrossings++;
      if (Math.abs(car.position) < 60 && occupiesTrack(car, -1)) {
        for (const other of lanes.get(`${lane.axis}:${lane.line}:${-lane.direction}`).cars) {
          if (occupiesTrack(other, 0) && Math.abs(other.position - car.position) < CAR_GAP) counts.oncomingConflicts++;
        }
      }
    }
  }
}
console.log(JSON.stringify(counts));
if (counts.redCrossings < 20 || counts.completedOvertakes < 3 || counts.oncomingConflicts > 0) process.exitCode = 1;
