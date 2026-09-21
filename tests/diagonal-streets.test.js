import test from 'node:test';
import assert from 'node:assert/strict';
import { diagonalAt, diagonalFromJunction, diagonalRoadDistance, DIAGONAL_HALF } from '../src/city/diagonalLayout.js';
import { diagonalTarget, buildDiagonalPath } from '../src/city/diagonalTraffic.js';
import { diagonalLotGeometry, populateDiagonal } from '../src/city/diagonalGeometry.js';
import { junctionArms, parkAt, roundaboutAt } from '../src/city/roadLayout.js';
import { parkingAt } from '../src/city/parkingLayout.js';
import { carCoordinates, turnPose, updateNetwork } from '../src/city/trafficNetwork.js';
import { roadHeight } from '../src/city/vehicleSurface.js';
import { TRACKS, STOP_LINE, PAVED_ROAD } from '../src/city/world.js';
import { TrafficSimulation } from '../src/city/trafficSimulation.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';

function roads(block) {
  const result = [];
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
    const road = diagonalAt(x, z, block); if (road) result.push(road);
  }
  return result;
}
function carAt(road, axis, reverse, block, taxi = true) {
  const start = reverse ? road.b : road.a, end = reverse ? road.a : road.b;
  const direction = axis === 0 ? end.x - start.x : end.z - start.z;
  const line = axis === 0 ? start.z : start.x, cross = axis === 0 ? start.x : start.z;
  // Choose a stable identity which takes the diagonal in the network planner.
  let cruise = taxi ? 13 : 6;
  while (Math.abs(Math.round(cruise * 100) + cross * 7 + line * 11) % 5 >= (taxi ? 3 : 2)) cruise += .01;
  return { axis, line, direction, position: cross * block - direction * STOP_LINE, track: 1,
    fromTrack: 1, offset: TRACKS[1], taxi, speed: 3, cruise, baseCruise: cruise, acceleration: taxi ? 24 : 4,
    cooldown: 10, turnCooldown: 0, changing: false, merge: 1, steer: 0, flashCooldown: Infinity };
}
function lanesAt(road) {
  const lanes = new Map();
  for (const axis of [0, 1]) for (let line = (axis ? road.x : road.z) - 2; line <= (axis ? road.x : road.z) + 3; line++)
    for (const direction of [-1, 1]) lanes.set(`${axis}:${line}:${direction}`, { axis, line, direction, cars: [] });
  return lanes;
}
const laneFor = car => `${car.axis}:${car.line}:${car.direction}`;

test('diagonals create isolated fifth arms in both orientations without removing existing roads', () => {
  for (const block of [24, 40, 48]) {
    const sites = roads(block), nodes = new Set();
    assert.ok(sites.length >= 8 && sites.length < 45);
    assert.equal(new Set(sites.map(r => r.flip)).size, 2);
    for (const road of sites) {
      assert.equal(parkAt(road.x, road.z), null);
      assert.equal(parkingAt(road.x, road.z, block), false);
      for (const node of [road.a, road.b]) {
        const key = `${node.x}:${node.z}`;
        assert.ok(!nodes.has(key)); nodes.add(key);
        assert.deepEqual(junctionArms(node.x, node.z), [true, true, true, true]);
        assert.equal(roundaboutAt(node.x, node.z), false);
        assert.equal(diagonalFromJunction(node.x, node.z, block).key, road.key);
      }
    }
  }
});

test('entry, diagonal lane and exit keep car bodies on actual asphalt in every direction', () => {
  for (const block of [24, 40, 48]) for (const flip of [false, true]) {
    const road = roads(block).find(r => r.flip === flip);
    for (const axis of [0, 1]) for (const reverse of [false, true]) for (const track of [0, 1]) {
      const car = carAt(road, axis, reverse, block), start = carCoordinates(car, block);
      const cross = axis === 0 ? (reverse ? road.b.x : road.a.x) : (reverse ? road.b.z : road.a.z);
      const turn = diagonalTarget(car, cross, block); turn.track = track;
      buildDiagonalPath(car, turn, start, block);
      assert.ok(turn.length > block);
      assert.ok(Math.hypot(turnPose(turn).x - start.x, turnPose(turn).z - start.z) < 1e-8);
      for (let i = 0; i <= 120; i++) {
        turn.distance = turn.length * i / 120;
        const pose = turnPose(turn);
        for (const side of [-.55, .55]) for (const front of [-1.2, 1.2]) {
          const x = pose.x + side * pose.cos + front * pose.sin;
          const z = pose.z - side * pose.sin + front * pose.cos;
          assert.ok(roadHeight(x, z, block, PAVED_ROAD / 2) < .03, JSON.stringify({block,flip,axis,reverse,track,i,x,z}));
        }
      }
      const end = turnPose(turn);
      assert.ok(Math.abs((turn.axis === 0 ? end.x : end.z) - turn.position) < 1e-8);
      assert.ok(Math.abs(Math.atan2(Math.sin(end.angle - (axis === 0 ? car.direction * Math.PI/2 : car.direction > 0 ? 0 : Math.PI)),
        Math.cos(end.angle - (axis === 0 ? car.direction * Math.PI/2 : car.direction > 0 ? 0 : Math.PI)))) < 1e-8);
    }
  }
});

test('triangular curbs and buildings leave the diagonal corridor open', () => {
  const geometry = diagonalLotGeometry(), p = geometry.getAttribute('position');
  assert.equal(p.count / 3, 8);
  for (const block of [24, 40, 48]) for (const road of roads(block).slice(0, 8)) {
    const pieces = [];
    populateDiagonal({add:(...args) => pieces.push(args)}, road, road.x * block, road.z * block, block);
    for (const [kind, x, y, z, w, h, d, color, angle = 0] of pieces) {
      if (kind !== 'diagonalLot' && kind !== 'building') continue;
      const vertices = kind === 'diagonalLot' ? [[0,0],[1,0],[0,1]] : [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
      for (const [u, v] of vertices) {
        const px = x + u*w*Math.cos(angle) + v*d*Math.sin(angle), pz = z - u*w*Math.sin(angle) + v*d*Math.cos(angle);
        assert.ok(diagonalRoadDistance(px,pz,block) >= DIAGONAL_HALF - 1e-7);
      }
    }
  }
  geometry.dispose();
});

test('cars and taxis traverse a real diagonal and transfer to the destination street', () => {
  const block = 40;
  for (const flip of [false,true]) for (const axis of [0,1]) for (const reverse of [false,true]) for (const taxi of [false,true]) {
    const road = roads(block).find(r => r.flip === flip), lanes = lanesAt(road), car = carAt(road,axis,reverse,block,taxi);
    const originalLine = car.line;
    lanes.get(laneFor(car)).cars.push(car);
    const time = axis === 0 ? 2 : 13;
    for(let i=0;i<600 && !car.diagonalsCompleted;i++) updateNetwork(lanes,1/30,time,{blockSize:block,roadLayout:true});
    assert.equal(car.diagonalsCompleted,1,JSON.stringify({flip,axis,reverse,taxi,car}));
    assert.notEqual(car.line,originalLine);
    assert.equal([...lanes.values()].flatMap(l=>l.cars).filter(c=>c===car).length,1);
    assert.equal(car.turn,null);
  }
});

test('opposing arrivals reserve the chord and both intersections; blocked exits reject entry', () => {
  const block=40, road=roads(block).find(r=>!r.flip), lanes=lanesAt(road);
  const a=carAt(road,0,false,block),b=carAt(road,0,true,block);
  lanes.get(laneFor(a)).cars.push(a);lanes.get(laneFor(b)).cars.push(b);
  updateNetwork(lanes,1/30,2,{blockSize:block,roadLayout:true});
  assert.equal([a,b].filter(c=>c.turn?.kind==='diagonal').length,1);
  const blocked=lanesAt(road),c=carAt(road,0,false,block);
  const target=diagonalTarget(c,road.a.x,block);
  const obstacle={...c,axis:target.axis,line:target.line,direction:target.direction,position:target.position,
    taxi:false,cruise:0,speed:0,turnCooldown:100};
  blocked.get(laneFor(c)).cars.push(c);blocked.get(laneFor(obstacle)).cars.push(obstacle);
  updateNetwork(blocked,1/30,2,{blockSize:block,roadLayout:true});
  assert.notEqual(c.turn?.kind,'diagonal');
});

test('normal Worker simulation chooses diagonals while the camera advances', () => {
  const simulation=new TrafficSimulation({settings:{...DEFAULT_SETTINGS,density:65,taxiShare:20},
    area:{x:3,z:3,extents:{x:70,z:60}},focus:{x:40,z:0},simulationHz:30});
  let seen=false,finished=false;
  for(let i=0;i<900;i++) {
    simulation.advance();
    for(const lane of simulation.lanes.values()) for(const car of lane.cars) {
      seen ||= car.turn?.kind==='diagonal'; finished ||= car.diagonalsCompleted>0;
      assert.ok(Number.isFinite(car.position));
    }
    if(seen&&finished)break;
  }
  assert.ok(seen);assert.ok(finished);
});
