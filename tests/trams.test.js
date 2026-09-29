import test from 'node:test';
import assert from 'node:assert/strict';
import { tramRoad, laneOffset, streetTracks, junctionStop } from '../src/city/roadProfile.js';
import { roadOpen, roundaboutAt } from '../src/city/roadLayout.js';
import { populateLane } from '../src/city/trafficPopulation.js';
import { populateTramTracks } from '../src/city/tramTracks.js';
import { bridgeHeightAt, liftBridgePose } from '../src/city/bridgeProfile.js';
import { updateNetwork } from '../src/city/trafficNetwork.js';
import { canMerge } from '../src/city/world.js';
import { vehicleGap, vehicleType, extraHalfLength } from '../src/city/vehicleTypes.js';
import { recycleVehicle } from '../src/city/activeWorld.js';

const settings = { density: 100, taxiShare: 20, blockSize: 40 };
function tram(direction = 1, position = -20) {
  const car = populateLane(0, 0, direction, settings, 3, 0, 0, true).cars.find(car => car.kind === 'tram');
  return { ...car, position: position * direction, speed: 6, cruise: 6, acceleration: 3, cooldown: 0 };
}
const network = cars => new Map([...new Set(cars.map(c => `${c.axis}:${c.line}:${c.direction}`))].map(key => {
  const [axis, line, direction] = key.split(':').map(Number);
  return [key, { axis, line, direction, cars: cars.filter(c => `${c.axis}:${c.line}:${c.direction}` === key) }];
}));

test('tram avenues have three lanes per direction and a continuous straight route', () => {
  for (const line of [-24, -12, 0, 12, 24]) {
    assert.ok(tramRoad(0, line));
    assert.equal(streetTracks(0, line).length, 3);
    for (let cross = -50; cross <= 50; cross++) {
      assert.ok(roadOpen(0, line, cross));
      assert.equal(roundaboutAt(cross, line), false);
    }
  }
  assert.equal(tramRoad(0, 6), false);
  assert.equal(tramRoad(1, 3), false);
});

test('trams replace a small part of inner-lane traffic, with safe initial gaps at maximum density', () => {
  for (const direction of [-1, 1]) for (const density of [20, 100, 200]) {
    const lane = populateLane(0, 0, direction, { ...settings, density }, 4, 0, 0, true);
    assert.deepEqual(lane, populateLane(0, 0, direction, { ...settings, density }, 4, 0, 0, true));
    const trams = lane.cars.filter(c => c.kind === 'tram');
    assert.ok(trams.length > 0);
    assert.ok(trams.length <= Math.ceil(lane.cars.length / 6));
    assert.ok(trams.every(c => c.track === 0 && !c.taxi && c.offset === laneOffset(0, 0, 0)));
    const inner = lane.cars.filter(c => c.track === 0).sort((a, b) => a.position - b.position);
    for (let i = 1; i < inner.length; i++)
      assert.ok(inner[i].position - inner[i - 1].position >= vehicleGap(inner[i], inner[i - 1]));
  }
  assert.equal(populateLane(0, 0, 1, { ...settings, density: 0 }, 4, 0, 0, true).cars.length, 0);
  assert.ok(populateLane(0, 6, 1, settings, 4, 0, 0, true).cars.every(c => c.kind !== 'tram'));
});

test('trams stop on red, resume on green, follow cars and never turn or merge', () => {
  for (const direction of [-1, 1]) {
    const car = tram(direction), lanes = network([car]);
    assert.equal(canMerge(car, [car], 1, direction), false);
    for (let i = 0; i < 240; i++) updateNetwork(lanes, 1 / 30, 12, { blockSize: 40, roadLayout: true });
    const stop = -(junctionStop(0, 0) + extraHalfLength(car));
    assert.ok(car.position * direction <= stop + 1e-6);
    assert.ok(car.speed < 0.01);
    const stopped = car.position;
    for (let i = 0; i < 600; i++) {
      updateNetwork(lanes, 1 / 30, 0, { blockSize: 40, roadLayout: true });
      assert.ok(!car.turn && !car.changing && !car.parking);
      assert.equal(car.track, 0); assert.equal(car.steer, 0);
      assert.equal(car.offset, laneOffset(0, 0, 0));
    }
    assert.ok((car.position - stopped) * direction > 60);
    const front = { ...tram(direction, 10), kind: 'car', speed: 0, cruise: 0 };
    const rear = tram(direction, -10), queue = network([rear, front]);
    for (let i = 0; i < 300; i++) {
      updateNetwork(queue, 1 / 30, 0, { blockSize: 40, roadLayout: true });
      assert.ok((front.position - rear.position) * direction >= vehicleGap(front, rear) - 1e-6);
    }
    rear.position = 300;
    assert.ok(recycleVehicle(queue.get(`0:0:${direction}`), rear, 0, 120, 50, 40));
    assert.equal(rear.track, 0); assert.equal(rear.kind, 'tram');
  }
});

test('embedded rails match wheel centres and follow the bridge profile through rebasing', () => {
  for (const block of [24, 40, 64]) for (const gx of [-12, -1, 0, 1, 12]) {
    const parts = [];
    populateTramTracks({ add: (...p) => parts.push(p) }, gx, 0, 0, 0, block);
    assert.ok(parts.length >= 4 && parts.length <= 40);
    for (const p of parts) {
      assert.ok(p.slice(1, 7).every(Number.isFinite));
      assert.ok(Math.abs(p[2] - 0.045 - bridgeHeightAt(gx * block + p[1], p[3], block)) < 1e-8);
      assert.ok(Math.abs(Math.abs(p[3]) - laneOffset(0, 0, 0) - 0.43) < 1e-8 ||
        Math.abs(Math.abs(p[3]) - laneOffset(0, 0, 0) + 0.43) < 1e-8);
    }
    const axle = vehicleType({ kind: 'tram' }).length * 0.31;
    const pose = { x: gx * block + block / 2 - 2, z: laneOffset(0, 0, 0),
      angle: Math.PI / 2, lift: 0, roll: 0, pitch: 0, wheels: [0, 0, 0, 0] };
    liftBridgePose(pose, block, axle);
    assert.ok(Math.abs(pose.roll) < 1e-8);
    assert.equal(pose.wheels[0], bridgeHeightAt(pose.x - axle, pose.z + 0.43, block));
    assert.equal(pose.wheels[2], bridgeHeightAt(pose.x + axle, pose.z + 0.43, block));
  }
});

test('cross traffic waits for the rear of a long tram when the light changes', () => {
  const train = tram(1, -11);
  const cross = { ...tram(1, -20), kind: 'car', axis: 1, offset: laneOffset(1, 0, 0) };
  const lanes = network([train, cross]);
  let waited = false;
  for (let i = 0; i < 900; i++) {
    updateNetwork(lanes, 1 / 30, 7.5 + i / 30, { blockSize: 40, roadLayout: true });
    const overlapX = Math.abs(train.position + cross.offset) < (vehicleType(train).length + vehicleType(cross).width) / 2;
    const overlapZ = Math.abs(train.offset - cross.position) < (vehicleType(train).width + vehicleType(cross).length) / 2;
    assert.ok(!(overlapX && overlapZ), 'tram rear must clear before perpendicular traffic enters');
    waited ||= cross.speed < 0.01;
  }
  assert.ok(waited);
  assert.ok(train.position > 12 && cross.position > 12, 'both streams make progress');
});
