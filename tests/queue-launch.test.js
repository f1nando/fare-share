import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_GAP, STOP_LINE, TRACKS, occupiesTrack, updateTraffic, resetSignal } from '../src/city/world.js';
import { intersectionAccess } from '../src/city/intersections.js';

function setup(track, direction = 1, axis = 0) {
  const vehicle = (distance, taxi = false) => ({ axis, line: 0, direction, position: distance * direction,
    taxi, track, fromTrack: track, offset: TRACKS[track], speed: 0, cruise: taxi ? 16 : 6,
    acceleration: taxi ? 26 : 3, cooldown: 0, merge: 1, changing: false, steer: 0, flashCooldown: Infinity });
  const leader = vehicle(-STOP_LINE), taxi = vehicle(-STOP_LINE - CAR_GAP * 2, true);
  const cars = [leader, vehicle(-STOP_LINE - CAR_GAP), taxi], opposing = [];
  const lanes = new Map([[`${axis}:0:${direction}`, { axis, direction, line: 0, cars }], [`${axis}:0:${-direction}`, { cars: opposing }]]);
  const advance = (green, untilGreen = 4, queueRandom = () => 0, delta = 0.02) => updateTraffic(cars, direction, delta, green,
    { blockSize: 40, weaving: 0, opposing, untilGreen, queueRandom, crossingAccess: intersectionAccess(lanes, 40, green ? axis ? 12 : 1 : 9) });
  return { cars, opposing, lanes, taxi, leader, advance };
}

test('taxi stages alongside a stopped queue, waits for green, then launches and returns ahead on either side', () => {
  for (const track of [0, 1]) for (const direction of [-1, 1]) for (const axis of [0, 1]) {
    const f = setup(track, direction, axis);
    for (let i = 0; i < 200; i++) {
      f.advance(false, 4 - i * 0.02);
      assert.ok(f.taxi.position * direction <= -STOP_LINE + 1e-8, 'must not run red during staging');
    }
    assert.equal(f.taxi.track, track ? 2 : -1);
    assert.equal(f.taxi.overtake.launch.phase, 'ready');
    assert.ok(f.taxi.speed < 0.01);
    const position = f.taxi.position;
    f.advance(false, 1, () => 0, 0);
    assert.equal(f.taxi.position, position);
    for (let i = 0; i < 150 && !f.taxi.launchesCompleted; i++) f.advance(true);
    assert.equal(f.taxi.launchesCompleted, 1);
    assert.equal(f.taxi.track, track);
    assert.ok((f.taxi.position - f.leader.position) * direction > CAR_GAP);
    assert.ok(f.taxi.speed > f.leader.speed);
  }
});

test('chance is rolled once per stop, and a close opposing queue prevents the oncoming launch', () => {
  const f = setup(0);
  let rolls = 0;
  f.advance(false, 4, () => { rolls++; return 0.99; });
  assert.ok(!f.taxi.overtake?.launch);
  assert.equal(rolls, 1);
  const blocked = setup(0);
  blocked.opposing.push({ ...blocked.leader, direction: -1, position: STOP_LINE, track: 0 });
  blocked.advance(false);
  assert.ok(!blocked.taxi.overtake?.launch);
  const moving = setup(1); moving.taxi.speed = 4;
  moving.advance(false);
  assert.ok(!moving.taxi.overtake?.launch);
});

test('recycling cancels staging and restores its original lane', () => {
  for (const track of [0, 1]) {
    const f = setup(track); f.advance(false);
    assert.ok(f.taxi.overtake?.launch);
    resetSignal(f.taxi);
    assert.equal(f.taxi.overtake, null);
    assert.equal(f.taxi.track, track);
    assert.equal(f.taxi.offset, TRACKS[track]);
  }
});

test('late opposing traffic waits while a staged taxi launches and returns with clearance', () => {
  const f = setup(0);
  for (let i = 0; i < 200; i++) f.advance(false, 4 - i * 0.02);
  const opposing = { ...f.leader, direction: -1, position: STOP_LINE, speed: 0 };
  f.opposing.push(opposing);
  for (let i = 0; i < 150; i++) {
    f.advance(true);
    updateTraffic(f.opposing, -1, 0.02, true, { blockSize: 40, opposing: f.cars, crossingAccess: intersectionAccess(f.lanes, 40, 1) });
    if (occupiesTrack(f.taxi, -1)) assert.ok(opposing.position - f.taxi.position >= CAR_GAP - 1e-8);
  }
  assert.equal(f.taxi.launchesCompleted, 1);
  assert.ok(opposing.position < STOP_LINE, 'opposing traffic resumes after the merge');
});
