import { THIRD_TRACK, junctionStop, streetHalf } from './roadProfile.js';
import { vehicleGap, extraHalfLength } from './vehicleTypes.js';
import { CAR_GAP, STOP_LINE, PAVED_ROAD, TRACKS, mod, vehiclePose, occupiesTrack, taxiAggression, finishRace, greenLight, greenTimeLeft, updateTraffic } from './world.js';
import { intersectionAccess } from './intersections.js';
import { updateBodyMotion } from './vehicleBody.js';
import { updateSurfaceMotion, settleOnFlatRoad, WHEEL_SIDES } from './vehicleSurface.js';
import { roadOpen, straightRoadOpen, boulevardRoad, laneRoadworks, roadworkAt, roundaboutAt, roundaboutStopAt } from './roadLayout.js';
import { buildRoundaboutPath, roundaboutPose, roundaboutMotion, roundaboutGap } from './roundabouts.js';
import { ROUNDABOUT_STOP } from './roundaboutDimensions.js';
import { updateParking } from './parkingTraffic.js';
import { diagonalTarget, buildDiagonalPath, diagonalLandingClear, beginInboundRing, beginOutboundRoad, prepareApproachCrossings, diagonalTravelLimit, advanceDiagonal } from './diagonalTraffic.js';

const laneKey = (axis, line, direction) => `${axis}:${line}:${direction}`;
const point = (axis, along, across) => axis === 0 ? { x: along, z: across } : { x: across, z: along };
export function carCoordinates(car, blockSize) {
  if(car.parking)return car.parking.pose;
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
  if (turn.kind === 'roundabout' || turn.kind === 'diagonal') return roundaboutPose(turn);
  const distance = Math.min(turn.length, turn.distance);
  let index = 1;
  while (index < turn.samples.length - 1 && turn.samples[index] < distance) index++;
  const start = turn.samples[index - 1], end = turn.samples[index];
  const t = (index - 1 + (distance - start) / Math.max(1e-9, end - start)) / (turn.samples.length - 1);
  const pose = curve(turn, t);
  const drift = -turn.side * 0.14 * Math.sin(Math.PI * t) ** 2;
  return { ...pose, angle: pose.angle + drift, drift, sin: Math.sin(pose.angle + drift), cos: Math.cos(pose.angle + drift) };
}

function turnTarget(car, blockSize, side, stopLine = STOP_LINE, center = Math.ceil((car.position * car.direction - stopLine) / blockSize) * blockSize * car.direction) {
  const crossLine = Math.round(center / blockSize);
  const axis = 1 - car.axis;
  const direction = car.direction * side * (car.axis === 0 ? 1 : -1);
  const track = side === 1 ? 1 : 0;
  const position = car.line * blockSize + direction * (stopLine + 1);
  return { axis, line: crossLine, direction, track, position, side, distance: 0,
    junction: car.axis === 0 ? `${crossLine}:${car.line}` : `${car.line}:${crossLine}`,
    centerX: car.axis === 0 ? center : car.line * blockSize,
    centerZ: car.axis === 0 ? car.line * blockSize : center };
}

export function makeTurn(car, blockSize, side = car.track === 0 ? -1 : 1) {
  return buildTurnPath(car, blockSize, turnTarget(car, blockSize, side));
}

function buildTurnPath(car, blockSize, turn) {
  const { axis, direction, track, position } = turn;
  const center = turn.line * blockSize;
  const a = carCoordinates(car, blockSize);
  const d = point(axis, position, center + (axis === 0 ? 1 : -1) * direction * TRACKS[track]);
  const incoming = point(car.axis, car.direction, 0), outgoing = point(axis, direction, 0);
  const corner = car.axis === 0 ? { x: d.x, z: a.z } : { x: a.x, z: d.z };
  const entryLength = Math.hypot(corner.x - a.x, corner.z - a.z);
  const exitLength = Math.hypot(d.x - corner.x, d.z - corner.z);
  turn.points = [a, { x: a.x + incoming.x * entryLength * 0.7, z: a.z + incoming.z * entryLength * 0.7 },
    { x: d.x - outgoing.x * exitLength * 0.7, z: d.z - outgoing.z * exitLength * 0.7 }, d];
  turn.samples = [0];
  let previous = a;
  for (let i = 1; i <= 64; i++) {
    const current = curve(turn, i / 64);
    turn.samples.push(turn.samples.at(-1) + Math.hypot(current.x - previous.x, current.z - previous.z));
    previous = current;
  }
  turn.length = turn.samples.at(-1);
  return turn;
}

function canTurn(car, turn, lanes, blockSize, locks, roundabout = false) {
  if ((!roundabout && locks.has(turn.junction)) || !lanes.has(laneKey(turn.axis, turn.line, turn.direction))) return false;
  let reservedExits = 0;
  // Keep enough physical queue space beyond the exit for all cars already
  // committed to it. A stopped downstream queue must not invalidate a platoon.
  let exitSpace = blockSize - STOP_LINE - Math.abs(turn.position-(turn.axis===0?turn.centerX:turn.centerZ));
  // Lock only an empty crossing. This includes same-axis cars and early claims
  // from oncoming/shoulder overtakes, which can span the junction before entry.
  for (const axis of [0, 1]) for (const direction of [-1, 1]) {
    const line = Math.round((axis === 0 ? turn.centerZ : turn.centerX) / blockSize);
    const center = axis === 0 ? turn.centerX : turn.centerZ;
    for (const other of lanes.get(laneKey(axis, line, direction))?.cars ?? []) {
      if (other === car || other.turn?.kind === 'diagonal' && other.turn.sourceCleared) continue;
      if (roundabout && other.turn?.kind === 'roundabout') {
        // Sharing an exit is allowed with a time gap; the trajectory planner
        // checks the moving cars instead of locking an exit for the whole lap.
        if(other.turn.junction===turn.junction && other.turn.axis===turn.axis && other.turn.direction===turn.direction &&
          other.turn.track===turn.track) reservedExits++;
        continue;
      }
      if (other.overtake?.leader === car) return false;
      if (Math.abs(other.position - center) < (roundabout ? ROUNDABOUT_STOP : junctionStop(Math.round(turn.centerX/blockSize),Math.round(turn.centerZ/blockSize))) + extraHalfLength(other) - 0.001 ||
          other.crossing === center && (center - other.position) * direction >= -STOP_LINE) return false;
      // Reserve the destination track, including lane changes and cars
      // borrowing this road from the opposite direction.
      const inLandingTrack = direction === turn.direction ? occupiesTrack(other, turn.track) : turn.track === 0 && occupiesTrack(other, -1);
      if (axis === turn.axis && inLandingTrack && Math.abs(other.position - turn.position) < vehicleGap(car, other) + 1) return false;
      if(roundabout && axis===turn.axis && inLandingTrack) {
        const ahead=(other.position-turn.position)*turn.direction;
        if(ahead>=0) exitSpace=Math.min(exitSpace,ahead);
      }
    }
  }
  return !roundabout || exitSpace >= (reservedExits+1)*CAR_GAP+1;
}

// One network step is shared by the renderer and traffic smoke test. Transfers
// happen after every straight lane has advanced, so no taxi moves twice/frame.
export function updateNetwork(lanes, delta, time, { blockSize = 40, weaving = 0.1, clockMultiplier = 1, roadLayout = false } = {}) {
  if (delta <= 0) return;
  if(roadLayout)updateParking(lanes,delta,blockSize);
  const locks = new Map();
  const activeTurns = [], circulating = [];

  for (const lane of lanes.values()) {
    const works = roadLayout ? laneRoadworks(lane, blockSize) : undefined;
    for (const car of lane.cars) car.roadworks = works;
  }
  for (const lane of lanes.values()) for (const car of lane.cars) {
    car.turnCooldown = Math.max(0, (car.turnCooldown ?? 0) - delta);
    if (car.turn && !lanes.has(laneKey(car.turn.axis, car.turn.line, car.turn.direction))) {
      car.turn = null; car.steer = 0; // Destination fell outside the camera window.
    }
    if (car.turn) {
      if (car.turn.kind !== 'diagonal' || !car.turn.sourceCleared) locks.set(car.turn.junction, car);
      activeTurns.push(car);
      if (car.turn.kind === 'diagonal') {
        if(car.turn.phase==='roadOut'&&car.turn.exitGranted)locks.set(car.turn.exitJunction,car);
        if(car.turn.ringActive)circulating.push(car.turn);
      }
      if (car.turn.kind === 'roundabout') circulating.push(car.turn);
    }
  }
  for (const lane of lanes.values()) for (const car of lane.cars) {
    if(car.parking)continue;
    car.roadEnd = roadLayout && !straightRoadOpen(car, blockSize, STOP_LINE);
    car.dividedRoad = roadLayout && boulevardRoad(car.axis, car.line);
    const center = Math.ceil((car.position * car.direction - STOP_LINE) / blockSize) * blockSize;
    const cross = Math.round(center * car.direction / blockSize);
    car.junctionStop=roadLayout?junctionStop(car.axis===0?cross:car.line,car.axis===0?car.line:cross):STOP_LINE;
    car.roundaboutApproach = roadLayout && roundaboutAt(car.axis === 0 ? cross : car.line, car.axis === 0 ? car.line : cross);
    car.roundaboutStop=car.roundaboutApproach?Math.min(roundaboutStopAt(car.axis===0?cross:car.line,car.axis===0?car.line:cross,blockSize),Math.max(ROUNDABOUT_STOP,center-car.position*car.direction-extraHalfLength(car))):undefined;
    // Let a pair finish its initial chase, then allow either taxi to break away
    // into a side street instead of blocking turns for the whole race.
    const required = car.roadEnd;
    if (car.turn || car.changing || car.feint) continue;
    const ordinaryDiagonal = roadLayout && !car.taxi && car.track === (car.dividedRoad?THIRD_TRACK:1) && car.turnCooldown === 0 && greenLight(time, car.axis);
    if (car.roundaboutApproach) {
      // Both normal traffic and taxis use the circle, regardless of the lights.
    } else if (required) {
      if (!car.taxi && !greenLight(time, car.axis)) continue;
    } else if (!ordinaryDiagonal && (!car.taxi || car.turnCooldown > 0 || car.overtake || car.race?.age < 4 || car.track < 0 || car.track === 2)) continue;
    // Large vehicles must wait outside the same body envelope canTurn checks.
    // Otherwise a bus at the yield line blocks every approach to an empty ring.
    const stopLine = (car.roundaboutApproach ? car.roundaboutStop : car.junctionStop) + extraHalfLength(car);
    const entryDistance = center - stopLine - car.position * car.direction;
    const entryLookahead = car.roundaboutApproach ? Math.min(Math.max(1, car.speed * 0.6 + 1),
      blockSize - ROUNDABOUT_STOP - STOP_LINE - 1.2) : Math.max(1, car.speed * delta + 0.1);
    if (entryDistance < -(car.roundaboutApproach?car.roundaboutStop-ROUNDABOUT_STOP:0)-0.001 || entryDistance > entryLookahead) continue;
    if (car.roundaboutApproach && lane.cars.some(other => {
      if(other===car||other.turn)return false;
      const ahead=(other.position-car.position)*car.direction;
      // The inner entry crosses the outer approach: let its adjacent car go
      // first, then use the trajectory reservation once that car is on the ring.
      return occupiesTrack(other,car.track)&&ahead>0&&ahead<center-car.position*car.direction+CAR_GAP ||
        other.offset>car.offset+.5&&Math.abs(ahead)<entryDistance+CAR_GAP+2;
    })) continue;
    const chooseDiagonal = Math.abs(Math.round((car.baseCruise ?? car.cruise) * 100) + cross * 7 + car.line * 11) % 5 < 4;
    let diagonal = roadLayout && !required && chooseDiagonal && !car.overtake
      ? diagonalTarget(car, cross, blockSize) : null;
    if(diagonal&&!lanes.has(laneKey(diagonal.axis,diagonal.line,diagonal.direction)))diagonal=null;
    if (ordinaryDiagonal && !diagonal && !required && !car.roundaboutApproach) continue;
    let turn = diagonal ?? turnTarget(car, blockSize, car.track <= 0 ? -1 : 1, stopLine);
    if (car.roundaboutApproach && !diagonal) {
      // Stable choice across retries: most cars continue straight, taxis turn more.
      const choice = Math.abs(Math.round((car.baseCruise ?? car.cruise) * 1000) + cross * 7 + car.line * 11) % 10;
      const preferred = choice < (car.taxi ? 3 : 1) ? -1 : choice < (car.taxi ? 6 : 2) ? 1 : 0;
      const target = side => {
        const exitLine=ROUNDABOUT_STOP+extraHalfLength(car);
        const result = turnTarget(car,blockSize,side || 1,exitLine,center*car.direction);
        if (!side) Object.assign(result, { axis:car.axis,line:car.line,direction:car.direction,
          track:car.track===0?0:1,position:center*car.direction+car.direction*(exitLine+1),side:0 });
        return result;
      };
      turn = [preferred,0,-1,1].map(target).find(candidate => roadOpen(candidate.axis,candidate.line,Math.floor(candidate.position/blockSize)) &&
        lanes.has(laneKey(candidate.axis,candidate.line,candidate.direction)));
      if (!turn) continue;
    }
    // Enter the open lane directly instead of landing in front of a work site.
    const work = roadLayout && roadworkAt(turn.axis, turn.line, Math.floor(turn.position / blockSize), blockSize);
    if (work && work.direction === turn.direction) turn.track = 0;
    if (roadLayout && !roadOpen(turn.axis, turn.line, Math.floor(turn.position / blockSize))) continue;
    if (!diagonal && !canTurn(car, turn, lanes, blockSize, locks, car.roundaboutApproach)) continue;
    if (diagonal && (!lanes.has(laneKey(turn.axis,turn.line,turn.direction)) ||
      !diagonal.sourceCleared && !car.roundaboutApproach && !canTurn(car,turn,lanes,blockSize,locks))) continue;
    // A blocked car can retry for hundreds of steps. Sample the curve only
    // after its destination and crossing are clear, immediately before entry.
    if (diagonal) {
      turn.block=blockSize;
      buildDiagonalPath(car,turn,carCoordinates(car,blockSize),blockSize);
      // A ring exit needs space only on the beginning of the approach.
      const occupied=activeTurns.some(other=>other.turn.kind==='diagonal'&&other.turn.roadId===turn.roadId&&
        Math.hypot(turn.path[0].x-turnPose(other.turn).x,turn.path[0].z-turnPose(other.turn).z)<vehicleGap(car,other)+2);
      const exitBlocked=turn.ringActive&&activeTurns.some(other=>other.turn.kind==='diagonal'&&
        other.turn.roadId===turn.roadId&&other.turn.flow===-1&&(()=>{
          const p=turnPose(other.turn),r=turn.road;
          return (p.x-r.a.x*blockSize)*r.dx+(p.z-r.a.z*blockSize)*r.dz>r.length-ROUNDABOUT_STOP-vehicleGap(car,other)-4;
        })());
      if(occupied||exitBlocked)continue;
      if(turn.ringActive){if(!roundaboutGap(turn,circulating))continue;circulating.push(turn);}
    } else if (car.roundaboutApproach) {
      const end = point(turn.axis, turn.position, turn.line * blockSize + (turn.axis === 0 ? 1 : -1) * turn.direction * TRACKS[turn.track]);
      buildRoundaboutPath(car, turn, carCoordinates(car, blockSize), end);
      if (!roundaboutGap(turn, circulating)) continue;
      circulating.push(turn);
    } else buildTurnPath(car, blockSize, turn);
    if (car.race) finishRace(car.race);
    car.turn = turn;
    turn.required = required;
    car.overtake = null;
    car.workBypass = null;
    car.crossing = undefined;
    car.flashAge = null;
    car.turnsStarted = (car.turnsStarted ?? 0) + 1;
    locks.set(turn.junction, car);
    activeTurns.push(car);
  }
  // Admit the next short stage only at its boundary. Long approaches do not
  // hold the circle or the far junction while cars travel along three blocks.
  for(const car of activeTurns){
    const turn=car.turn;
    if(turn.kind!=='diagonal')continue;
    if(turn.phase==='roadIn'&&turn.length-turn.distance<.01){
      const ring=beginInboundRing(car,turn,blockSize);
      if(canTurn(car,ring,lanes,blockSize,locks,true)&&roundaboutGap(ring,circulating)){
        car.turn=ring;circulating.push(ring);
      }
    }else if(turn.phase==='roadOut'&&!turn.exitGranted&&turn.exitStart-turn.distance<1){
      const target={...turn,junction:turn.exitJunction,centerX:turn.exitX,centerZ:turn.exitZ};
      if(greenLight(time,turn.axis)&&diagonalLandingClear(car,turn,lanes)&&canTurn(car,target,lanes,blockSize,locks)){
        turn.exitGranted=true;locks.set(turn.exitJunction,car);
      }
    }
  }
  if(roadLayout)prepareApproachCrossings(lanes,activeTurns,time,blockSize);
  const crossingAccess = intersectionAccess(lanes, blockSize, time, locks, roadLayout);
  // A turning car is still stored on its old street. Advertise its landing
  // position to the opposite stream before it transfers, so a taxi cannot
  // start a feint/overtake into the car that is about to appear there.
  const landings = new Map();
  for (const car of activeTurns) {
    const turn = car.turn;
    if(turn.kind==='diagonal'&&!turn.ringActive&&!turn.exitGranted)continue;
    const key = laneKey(turn.axis, turn.line, turn.direction);
    if (!landings.has(key)) landings.set(key, []);
    landings.get(key).push({ axis: turn.axis, line: turn.line, direction: turn.direction, position: turn.position,
      track: turn.track, taxi: car.taxi, kind: car.kind, speed: car.cruise * 1.25, cruise: car.cruise, acceleration: car.acceleration });
  }
  for (const lane of lanes.values()) updateTraffic(lane.cars, lane.direction, delta, greenLight(time, lane.axis), {
    blockSize, weaving, crossingAccess,
    opposing: [...(lanes.get(laneKey(lane.axis, lane.line, -lane.direction))?.cars ?? []),
      ...(landings.get(laneKey(lane.axis, lane.line, -lane.direction)) ?? [])],
    greenRemaining: greenTimeLeft(time, lane.axis) / Math.max(0.01, clockMultiplier),
    untilGreen: mod((lane.axis === 0 ? 22 : 11) - mod(time, 22), 22) / Math.max(0.01, clockMultiplier),
  });
  // Snapshot the active set: adding to a later lane cannot process it again.
  for (const car of activeTurns) {
    const turn = car.turn, previousSpeed = car.speed;
    if (turn.kind === 'roundabout' || turn.ringActive) {
      turn.elapsed += delta;
      const motion = roundaboutMotion(turn, turn.elapsed);
      car.speed = motion.speed; turn.distance = Math.min(turn.length, motion.distance);
      car.steer = -0.18 * Math.sin(Math.PI * turn.distance / turn.length);
    } else if(turn.kind==='diagonal') {
      advanceDiagonal(car,diagonalTravelLimit(car,activeTurns,lanes,time,blockSize),delta);
    } else {
      car.speed = Math.min(car.cruise * 1.1, car.speed + car.acceleration * delta);
      turn.distance = Math.min(turn.length, turn.distance + car.speed * delta);
      car.steer = turn.side * 0.2 * Math.sin(Math.PI * turn.distance / turn.length);
    }
    updateBodyMotion(car, delta, previousSpeed);
    if (turn.distance < turn.length) continue;
    if(turn.kind==='diagonal'&&turn.phase==='roadIn')continue;
    if(turn.kind==='diagonal'&&turn.phase==='ringOut'){beginOutboundRoad(turn,blockSize);continue;}
    const source = lanes.get(laneKey(car.axis, car.line, car.direction));
    const destination = lanes.get(laneKey(turn.axis, turn.line, turn.direction));
    source.cars.splice(source.cars.indexOf(car), 1);
    destination.cars.push(car);
    Object.assign(car, { axis: turn.axis, line: turn.line, direction: turn.direction, position: turn.position,
      track: turn.track, fromTrack: turn.track, offset: TRACKS[turn.track], steer: 0, changing: false, merge: 1,
      turn: null, turnCooldown: 4 / taxiAggression(weaving), cooldown: 0.5, crossing: undefined, burst: 1.2 });
    car.turnsCompleted = (car.turnsCompleted ?? 0) + 1;
    if (turn.kind === 'roundabout') car.roundaboutsCompleted = (car.roundaboutsCompleted ?? 0) + 1;
    if (turn.kind === 'diagonal') car.diagonalsCompleted = (car.diagonalsCompleted ?? 0) + 1;
    if (turn.required) car.requiredTurnsCompleted = (car.requiredTurnsCompleted ?? 0) + 1;
  }
  for (const lane of lanes.values()) for (const car of lane.cars) {
    // Straight, settled cars fit wholly inside a continuous asphalt strip.
    // Avoid allocating coordinates and computing wheel poses for this case.
    if(car.parking){settleOnFlatRoad(car);continue;}
    if (!car.turn && !car.steer && Math.abs(car.offset) + WHEEL_SIDES[1] < streetHalf(car.axis,car.line) && settleOnFlatRoad(car)) continue;
    const position = carCoordinates(car, blockSize);
    const pose = car.turn ? position : vehiclePose(position.x, position.z, car.axis, car.direction, car.steer);
    updateSurfaceMotion(car, pose, delta, blockSize, PAVED_ROAD / 2);
  }
}
