import test from 'node:test';
import assert from 'node:assert/strict';
import { boulevardRoad, roadOpen, MEDIAN_WIDTH, MEDIAN_INSET } from '../src/city/roadLayout.js';
import { populateBlock } from '../src/city/createCity.js';
import { updateTraffic, TRACKS, STOP_LINE, MERGE_DURATION, vehiclePose } from '../src/city/world.js';
import { updateNetwork, carCoordinates, makeTurn, turnPose } from '../src/city/trafficNetwork.js';

const vehicle = (position, track, taxi = false) => ({ axis: 0, line: 0, direction: 1,
  position, track, fromTrack: track, offset: TRACKS[track], taxi, dividedRoad: true,
  speed: taxi ? 12 : 4, cruise: taxi ? 16 : 4, acceleration: taxi ? 25 : 4,
  cooldown: 0, changing: false, merge: 1, steer: 0, flashCooldown: Infinity });

test('whole boulevard lines repeat at negative coordinates and medians only occupy open roads', () => {
  for (const axis of [0, 1]) for (let line = -18; line <= 18; line++) {
    assert.equal(boulevardRoad(axis, line), boulevardRoad(axis, line + 6));
    for (let segment = -5; segment <= 5; segment++) {
      const gx = axis === 0 ? segment : line, gz = axis === 0 ? line : segment, parts = [];
      populateBlock({ add: (...p) => parts.push(p) }, gx, gz, 0, 0, 40);
      const strips = parts.filter(p => p[0] === 'box' && p[2] === 0.09 && p[axis === 0 ? 3 : 1] === 0);
      assert.equal(strips.length, Number(boulevardRoad(axis, line) && roadOpen(axis, line, segment)));
    }
  }
});

test('divider prevents oncoming passing and feints, but allows the adjacent lane and shoulder', () => {
  for (const track of [0, 1]) {
    const taxi = vehicle(7, track, true), leader = vehicle(14, track), neighbour = vehicle(8, 1 - track);
    updateTraffic([taxi, leader, neighbour], 1, 0.02, true, { blockSize: 40, opposing: [] });
    assert.equal(taxi.track, track === 0 ? 0 : 2);
    assert.ok(!taxi.feint);
  }
  const taxi = vehicle(7, 0, true);
  updateTraffic([taxi, vehicle(14, 0)], 1, 0.02, true, { blockSize: 40, opposing: [] });
  assert.equal(taxi.track, 1);
});

test('stopped taxis can stage on the shoulder but cannot cross a divider', () => {
  for (const track of [0, 1]) {
    const taxi = vehicle(-STOP_LINE - 5.8, track, true), cars = [taxi, vehicle(-STOP_LINE, track), vehicle(-STOP_LINE - 2.9, track)];
    cars.forEach(car => { car.speed = 0; });
    updateTraffic(cars, 1, 0.02, false, { blockSize: 40, opposing: [], untilGreen: 4, queueRandom: () => 0 });
    assert.equal(Boolean(taxi.overtake?.launch), track === 1);
  }
});

test('network derives the divider rule from each car current street', () => {
  const taxi = vehicle(14, 0, true), lane = { axis: 0, line: 0, direction: 1, cars: [taxi] };
  const lanes = new Map([['0:0:1', lane]]);
  updateNetwork(lanes, 0.02, 1, { roadLayout: true });
  assert.equal(taxi.dividedRoad, true);
  taxi.line = lane.line = 1;
  updateNetwork(lanes, 0.02, 1, { roadLayout: true });
  assert.equal(taxi.dividedRoad, false);
});

function corners(pose) {
  return [-0.46, 0.46].flatMap(side => [-1.125, 1.125].map(along => ({
    x: pose.x + side * pose.cos + along * pose.sin,
    z: pose.z - side * pose.sin + along * pose.cos,
  })));
}

test('the whole body clears the median throughout lane changes in both axes and directions', () => {
  for (const axis of [0, 1]) for (const direction of [-1, 1]) for (const from of [0, 1]) {
    const car = { ...vehicle(15, 1 - from, true), axis, direction, fromTrack: from,
      offset: TRACKS[from], changing: true, merge: 0, cooldown: 10 };
    for (let i = 0; i < 100; i++) {
      updateTraffic([car], direction, MERGE_DURATION / 100, true);
      const p = carCoordinates(car, 40), pose = vehiclePose(p.x, p.z, axis, direction, car.steer);
      for (const corner of corners(pose)) assert.ok(Math.abs(axis === 0 ? corner.z : corner.x) > MEDIAN_WIDTH / 2);
    }
  }
});

test('turning bodies clear both median ends, including small blocks and shoulder approaches', () => {
  for (const block of [24, 40, 48]) for (const axis of [0, 1]) for (const direction of [-1, 1]) for (const track of [0, 1, -1, 2]) {
    const car = { ...vehicle(-direction * STOP_LINE, track, true), axis, direction,
      offset: track === -1 ? -TRACKS[0] : track === 2 ? 4.06 : TRACKS[track] };
    const turn = makeTurn(car, block, track <= 0 ? -1 : 1);
    for (let i = 0; i <= 100; i++) {
      turn.distance = turn.length * i / 100;
      for (const p of corners(turnPose(turn))) {
        assert.ok(!(Math.abs(p.x) < MEDIAN_WIDTH / 2 && Math.abs(p.z) >= MEDIAN_INSET));
        assert.ok(!(Math.abs(p.z) < MEDIAN_WIDTH / 2 && Math.abs(p.x) >= MEDIAN_INSET));
      }
    }
  }
});
