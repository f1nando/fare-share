import { seededRandom, TRACKS, CAR_GAP, STOP_LINE, occupiesTrack, vehiclePose, greenLight, resetSignal } from '../src/city/world.js';
import { carCoordinates, updateNetwork } from '../src/city/trafficNetwork.js';

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
const counts = { redCrossings: 0, oncomingOvertakes: 0, shoulderOvertakes: 0, completedOvertakes: 0, completedShoulderOvertakes: 0, abortedOvertakes: 0, oncomingConflicts: 0, shoulderConflicts: 0, feints: 0, returnedFeints: 0, races: 0, raceWins: 0, turns: 0, completedTurns: 0, turnConflicts: 0, driftingFrames: 0 };
for (let frame = 0; frame < 1500; frame++) {
  const time = frame * 0.04;
  for (const lane of lanes.values()) for (const car of lane.cars) {
    if (car.position < -half) { car.position += half * 2; resetSignal(car); }
    if (car.position > half) { car.position -= half * 2; resetSignal(car); }
  }
  const before = [...lanes.values()].flatMap(lane => lane.cars.map(car => [car, car.position, car.overtake, !!car.feint, car.race, car.raceResult, lane.axis, lane.direction, car.turnsStarted ?? 0, car.turnsCompleted ?? 0]));
  updateNetwork(lanes, 0.04, time, { blockSize, weaving });
  const allCars = [...lanes.values()].flatMap(lane => lane.cars);
  if (allCars.length !== before.length || new Set(allCars).size !== before.length) throw new Error('A lane transfer lost or duplicated a vehicle');
  for (const lane of lanes.values()) {
    for (const [car, position, passing, feint, race, result, axis, direction, starts, completions] of before) {
      if (!lane.cars.includes(car)) continue;
      const green = greenLight(time, axis);
      counts.turns += (car.turnsStarted ?? 0) - starts;
      counts.completedTurns += (car.turnsCompleted ?? 0) - completions;
      if (car.turn || (car.turnsCompleted ?? 0) > completions) {
        const coordinates = carCoordinates(car, blockSize);
        const pose = car.turn ? coordinates : vehiclePose(coordinates.x, coordinates.z, car.axis, car.direction, car.steer);
        if (Math.abs(pose.drift) > 0.05) counts.driftingFrames++;
        for (const other of before.map(entry => entry[0])) {
          if (other === car) continue;
          const coordinates = carCoordinates(other, blockSize);
          const otherPose = other.turn ? coordinates : vehiclePose(coordinates.x, coordinates.z, other.axis, other.direction, other.steer);
          if (overlap(pose, otherPose)) counts.turnConflicts++;
        }
      }
      if (!car.taxi) continue;
      if (car.feint && !feint) counts.feints++;
      if (!car.feint && feint) counts.returnedFeints++;
      if (car.race && !race && car.race.follower === car) counts.races++;
      if (car.raceResult === 'won' && result !== 'won') counts.raceWins++;
      if (car.overtake && !passing) counts[car.overtake.passTrack === 2 ? 'shoulderOvertakes' : 'oncomingOvertakes']++;
      if (!car.overtake && passing) {
        if ((car.position - passing.leader.position) * lane.direction >= CAR_GAP) counts[passing.passTrack === 2 ? 'completedShoulderOvertakes' : 'completedOvertakes']++;
        else counts.abortedOvertakes++;
      }
      if (!green && axis === car.axis && direction === car.direction && Math.floor((position * lane.direction + STOP_LINE) / blockSize) !==
          Math.floor((car.position * lane.direction + STOP_LINE) / blockSize)) counts.redCrossings++;
      if (Math.abs(car.position) < 60 && occupiesTrack(car, -1)) {
        for (const other of lanes.get(`${lane.axis}:${lane.line}:${-lane.direction}`).cars) {
          if (occupiesTrack(other, 0) && Math.abs(other.position - car.position) < CAR_GAP) counts.oncomingConflicts++;
        }
      }
      if (Math.abs(car.position) < 60 && occupiesTrack(car, 2)) {
        for (const other of lane.cars) if (other !== car && occupiesTrack(other, 2) && Math.abs(other.position - car.position) < CAR_GAP - 1e-7) counts.shoulderConflicts++;
      }
    }
  }
}
console.log(JSON.stringify(counts));
if (counts.redCrossings < 20 || counts.completedOvertakes < 3 || counts.completedShoulderOvertakes < 3 || counts.oncomingConflicts > 0 || counts.shoulderConflicts > 0 || counts.returnedFeints < 2 || counts.raceWins < 1 || counts.completedTurns < 2 || counts.turnConflicts > 0 || counts.driftingFrames < 10) process.exitCode = 1;

function overlap(a, b) {
  const axes = pose => [{ x: Math.sin(pose.angle), z: Math.cos(pose.angle), radius: 1.125 }, { x: Math.cos(pose.angle), z: -Math.sin(pose.angle), radius: 0.52 }];
  const aa = axes(a), bb = axes(b);
  for (const normal of [...aa, ...bb]) {
    const distance = Math.abs((a.x - b.x) * normal.x + (a.z - b.z) * normal.z);
    const extent = list => list.reduce((sum, axis) => sum + axis.radius * Math.abs(axis.x * normal.x + axis.z * normal.z), 0);
    if (distance >= extent(aa) + extent(bb)) return false;
  }
  return true;
}
