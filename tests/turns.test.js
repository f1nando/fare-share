import test from 'node:test';
import assert from 'node:assert/strict';
import { STOP_LINE, PAVED_ROAD, TRACKS, resetSignal, vehiclePose } from '../src/city/world.js';
import { makeTurn, turnPose, carCoordinates, updateNetwork } from '../src/city/trafficNetwork.js';
import { addCar } from '../src/city/createCity.js';

function fixture(axis = 0, direction = 1, track = 0, blockSize = 40) {
  const lanes = new Map();
  for (const a of [0, 1]) for (let line = -2; line <= 2; line++) for (const d of [-1, 1])
    lanes.set(`${a}:${line}:${d}`, { axis: a, line, direction: d, cars: [] });
  const car = { axis, direction, line: -1, position: -blockSize - direction * STOP_LINE,
    taxi: true, track, fromTrack: track, offset: TRACKS[track], cruise: 17, speed: 17,
    acceleration: 30, cooldown: 1, changing: false, merge: 1, steer: 0 };
  lanes.get(`${axis}:-1:${direction}`).cars.push(car);
  return { lanes, car, blockSize };
}
const step = (fixture, delta = 0.02, weaving = 0) => updateNetwork(fixture.lanes, delta, 9, { blockSize: fixture.blockSize, weaving });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const angleClose = (a, b) => close(Math.sin(a - b), 0);

test('left/right turn geometry joins both road axes and directions continuously, with a small mid-curve drift', () => {
  for (const blockSize of [24, 40, 48]) for (const axis of [0, 1]) for (const direction of [-1, 1]) for (const track of [0, 1]) {
    const { car } = fixture(axis, direction, track, blockSize);
    const start = carCoordinates(car, blockSize), turn = makeTurn(car, blockSize), pose = turnPose(turn);
    close(pose.x, start.x); close(pose.z, start.z);
    angleClose(pose.angle, vehiclePose(start.x, start.z, axis, direction, 0).angle);
    turn.distance = turn.length / 2;
    assert.ok(Math.abs(turnPose(turn).drift) > 0.1);
    for (let i = 0; i <= 100; i++) {
      turn.distance = turn.length * i / 100;
      const sample = turnPose(turn);
      for (const lateral of [-0.52, 0.52]) for (const longitudinal of [-1.125, 1.125]) {
        const x = sample.x + lateral * sample.cos + longitudinal * sample.sin;
        const z = sample.z - lateral * sample.sin + longitudinal * sample.cos;
        assert.ok(Math.abs(x - turn.centerX) <= PAVED_ROAD / 2 || Math.abs(z - turn.centerZ) <= PAVED_ROAD / 2,
          'drifting body must remain over the asphalt, outside the block curbs');
      }
    }
    turn.distance = turn.length;
    const end = turnPose(turn), target = { ...car, ...turn, offset: TRACKS[turn.track] };
    const expected = carCoordinates(target, blockSize);
    close(end.x, expected.x); close(end.z, expected.z);
    angleClose(end.angle, vehiclePose(expected.x, expected.z, turn.axis, turn.direction, 0).angle);
    close(end.drift, 0);
  }
});

test('network completes left/right turns at 0% and 200%, transfers once and continues on the new street', () => {
  for (const weaving of [0, 2]) for (const axis of [0, 1]) for (const direction of [-1, 1]) for (const track of [0, 1]) {
    const f = fixture(axis, direction, track), target = makeTurn(f.car, f.blockSize);
    const originalLane = f.lanes.get(`${axis}:-1:${direction}`);
    step(f, 0.02, weaving);
    assert.ok(f.car.turn);
    let frames = 0;
    while (f.car.turn && frames++ < 200) step(f, 0.02, weaving);
    assert.equal(f.car.turnsCompleted, 1);
    assert.equal(f.car.axis, target.axis);
    assert.equal(f.car.direction, target.direction);
    close(f.car.position, target.position); // No extra straight update on transfer frame.
    assert.equal(originalLane.cars.length, 0);
    assert.deepEqual([...f.lanes.values()].flatMap(lane => lane.cars), [f.car]);
    const before = f.car.position;
    step(f, 0.02, weaving);
    assert.ok((f.car.position - before) * f.car.direction > 0);
  }
});

test('turn rejects an occupied crossing, a reserved overtake and a blocked destination', () => {
  for (const obstacle of ['inside', 'reserved', 'exit']) {
    const f = fixture(), target = makeTurn(f.car, f.blockSize);
    const other = { ...f.car, taxi: false, axis: target.axis, direction: target.direction,
      line: target.line, position: obstacle === 'inside' ? -40 : obstacle === 'exit' ? target.position + 1 : -40 - target.direction * 10,
      crossing: obstacle === 'reserved' ? -40 : undefined, speed: 0, cruise: 0, track: target.track };
    f.lanes.get(`${other.axis}:${other.line}:${other.direction}`).cars.push(other);
    step(f);
    assert.ok(!f.car.turn, obstacle);
  }
});

test('active turn holds cars at all four approaches, then releases the crossing', () => {
  const f = fixture();
  step(f); assert.ok(f.car.turn);
  const others = [];
  for (const axis of [0, 1]) for (const direction of [-1, 1]) {
    const other = { ...f.car, turn: null, taxi: false, axis, direction, line: -1, track: 1, fromTrack: 1, offset: TRACKS[1],
      position: -40 - direction * STOP_LINE, speed: 5, cruise: 5, crossing: undefined };
    // Other source track can wait alongside the taxi.
    f.lanes.get(`${axis}:-1:${direction}`).cars.push(other); others.push(other);
  }
  while (f.car.turn) {
    step(f);
    for (const car of others) close(car.position, -40 - car.direction * STOP_LINE);
  }
  for (let i = 0; i < 100; i++) updateNetwork(f.lanes, 0.02, 1, { blockSize: 40, weaving: 0 });
  assert.ok(others.some(car => car.axis === 0 && (car.position + 40) * car.direction > -STOP_LINE));
});

test('pause freezes the turn; renderer uses its curved world pose after camera rebasing; recycling clears it', () => {
  const f = fixture(); step(f);
  for (let i = 0; i < 12; i++) step(f);
  const before = JSON.stringify(f.car);
  step(f, 0); assert.equal(JSON.stringify(f.car), before);
  const pose = turnPose(f.car.turn), parts = [];
  addCar({ add(...args) { parts.push(args); } }, f.car, -40, -40, { x: 0, z: 0 }, { right: 100, top: 100 }, 40);
  close(parts[0][1], pose.x + 40); close(parts[0][3], pose.z + 40); close(parts[0][8], pose.angle);
  resetSignal(f.car); assert.ok(!f.car.turn); assert.equal(f.car.steer, 0);
  const other = fixture(); step(other);
  const turn = other.car.turn;
  other.lanes.delete(`${turn.axis}:${turn.line}:${turn.direction}`);
  step(other); assert.ok(!other.car.turn);
});
