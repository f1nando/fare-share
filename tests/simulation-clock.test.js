import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationClock } from '../src/city/simulationClock.js';
import { interpolatePresentation, presentation } from '../src/city/vehiclePresentation.js';
import { makeTurn, carCoordinates, updateNetwork } from '../src/city/trafficNetwork.js';
import { TRACKS } from '../src/city/world.js';
import { trafficSnapshot } from '../src/city/benchmarkScenario.js';

test('30/60 Hz simulation keeps equal time on 60/120/144 Hz screens', () => {
  for (const rate of [30, 60]) for (const hz of [60, 120, 144]) {
    const clock = new SimulationClock(1 / rate); let time = 0, calls = 0;
    for (let i = 0; i < hz * 10; i++) {
      const { alpha } = clock.advance(1 / hz, dt => { time += dt; calls++; });
      assert.ok(alpha >= 0 && alpha < 1);
    }
    assert.equal(calls, rate * 10); assert.ok(Math.abs(time - 10) < 1e-9);
  }
  const clock = new SimulationClock(); let calls = 0;
  for (let i = 0; i < 200; i++) clock.advance(i % 2 ? 0.007 : 0.043, () => calls++);
  assert.equal(calls, 300);
});

test('long frames have bounded recovery; paused and hidden time cannot build backlog', () => {
  const clock = new SimulationClock(); let calls = 0;
  clock.advance(0.008, () => calls++);
  assert.equal(clock.advance(10, () => calls++).steps, 4);
  const remainder = clock.remainder;
  assert.equal(clock.advance(0, () => calls++).steps, 0);
  assert.equal(clock.remainder, remainder);
  clock.reset(); assert.equal(clock.advance(0, () => calls++).alpha, 0);
  assert.equal(calls, 4);
});

test('presentation follows the short angular arc, interpolates suspension and rejects recycling', () => {
  const previous = { x: 10, z: -2, angle: Math.PI - 0.1, pitch: 0, roll: -0.1, lift: 0.2, wheels: [0, 0.2, 0, 0.2] };
  const next = () => ({ x: 11, z: -1, angle: -Math.PI + 0.1, pitch: 0.1, roll: 0.1, lift: 0.4, wheels: [0.2, 0.4, 0.2, 0.4] });
  const middle = interpolatePresentation(next(), previous, 0.5);
  assert.equal(middle.x, 10.5); assert.equal(middle.z, -1.5);
  assert.ok(Math.abs(middle.angle - Math.PI) < 1e-10);
  assert.ok(Math.abs(middle.lift - 0.3) < 1e-10);
  assert.equal(middle.roll, 0);
  assert.deepEqual(interpolatePresentation({ ...next(), x: 200 }, previous, 0.5), { ...next(), x: 200 });
});

test('the same traffic simulation reaches the same state at different render frequencies', () => {
  const states = [];
  for (const hz of [60, 120, 144]) {
    const cars = Array.from({ length: 8 }, (_, i) => ({ axis: 0, line: 0, direction: 1,
      position: -60 + i * 6, taxi: i % 3 === 0, speed: 6, cruise: i % 3 === 0 ? 14 : 6,
      acceleration: 6, track: i % 2, fromTrack: i % 2, offset: TRACKS[i % 2],
      steer: 0, changing: false, cooldown: 0.2, merge: 1 }));
    const lanes = new Map([['0:0:1', { axis: 0, line: 0, direction: 1, cars }]]);
    const clock = new SimulationClock(1 / 30); let time = 0;
    for (let frame = 0; frame < hz * 3; frame++) clock.advance(1 / hz, dt => {
      time += dt; updateNetwork(lanes, dt, time, { blockSize: 40, weaving: 2 });
    });
    states.push(trafficSnapshot(lanes));
  }
  assert.deepEqual(states[0], states[1]); assert.deepEqual(states[1], states[2]);
});

test('interpolation remains continuous when a turn transfers to a new street', () => {
  for (const axis of [0, 1]) for (const direction of [-1, 1]) for (const side of [-1, 1]) {
    const car = { axis, line: -1, direction, position: -6 * direction, track: side < 0 ? 0 : 1,
      offset: TRACKS[side < 0 ? 0 : 1], steer: 0, speed: 15, taxi: true };
    car.turn = makeTurn(car, 40, side); car.turn.distance = car.turn.length - 0.1;
    const before = presentation(car, carCoordinates(car, 40));
    const turn = car.turn;
    Object.assign(car, { axis: turn.axis, line: turn.line, direction: turn.direction,
      position: turn.position, offset: TRACKS[turn.track], turn: null });
    const after = presentation(car, carCoordinates(car, 40));
    const distance = Math.hypot(after.x - before.x, after.z - before.z);
    assert.ok(distance < 0.12);
    const halfway = interpolatePresentation(after, before, 0.5);
    assert.ok(Math.abs(Math.hypot(halfway.x - before.x, halfway.z - before.z) - distance / 2) < 1e-8);
  }
});
