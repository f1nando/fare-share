import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_GAP, TRACKS, FEINT_DURATION, FEINT_REACH, MAX_MERGE_ANGLE, feintPose, occupiesTrack, updateTraffic, resetSignal } from '../src/city/world.js';

const vehicle = (position, track = 0, taxi = false) => ({
  position, track, fromTrack: track, offset: TRACKS[track], taxi,
  speed: taxi ? 8 : 4, cruise: taxi ? 16 : 4, acceleration: taxi ? 25 : 4,
  cooldown: 0, changing: false, merge: 1, flashCooldown: Infinity,
});

test('feint crosses the centre line with the body then returns with small smooth steering', () => {
  const samples = Array.from({ length: 101 }, (_, i) => feintPose(i / 100));
  assert.equal(samples[0].offset, TRACKS[0]);
  assert.equal(samples[100].offset, TRACKS[0]);
  assert.ok(samples[50].offset < 0.46, 'the edge of the body peeks across the centre line');
  assert.ok(Math.abs(samples[50].offset - (TRACKS[0] - FEINT_REACH)) < 1e-9);
  assert.ok(samples[25].steer < 0 && samples[75].steer > 0);
  for (let i = 0; i < samples.length; i++) {
    assert.ok(Math.abs(samples[i].steer) <= MAX_MERGE_ANGLE);
    if (i > 0) assert.ok(Math.abs(samples[i].offset - samples[i - 1].offset) < 0.025);
  }
});

test('taxi feints when there is room to peek but insufficient time to overtake', () => {
  for (const direction of [-1, 1]) for (const weaving of [0, 2]) {
    const taxi = vehicle(14 * direction, 0, true);
    const cars = [taxi, vehicle(21 * direction), vehicle(14 * direction, 1)];
    const approaching = vehicle(52 * direction); approaching.speed = approaching.cruise = 8;
    const opposing = [approaching];
    let peeked = false, returning = false;
    for (let frame = 0; frame < 52; frame++) {
      updateTraffic(cars, direction, 0.02, true, { blockSize: 40, weaving, opposing });
      updateTraffic(opposing, -direction, 0.02, true, { blockSize: 40, opposing: cars });
      peeked ||= taxi.offset < 0.46;
      returning ||= taxi.steer > 0;
      assert.equal(taxi.track, 0);
      assert.ok(Math.abs(taxi.position - approaching.position) >= CAR_GAP);
    }
    assert.ok(peeked && returning);
    assert.equal(taxi.feint, null);
    assert.equal(taxi.offset, TRACKS[0]);
    assert.equal(taxi.steer, 0);
  }
});

test('taxi does not feint into a nearby oncoming car and recycling clears a peek', () => {
  const taxi = vehicle(14, 0, true), cars = [taxi, vehicle(21), vehicle(14, 1)];
  const approaching = vehicle(30); approaching.speed = approaching.cruise = 8;
  updateTraffic(cars, 1, 0.02, true, { opposing: [approaching], blockSize: 40 });
  assert.ok(!taxi.feint);
  taxi.feint = { age: FEINT_DURATION / 2 };
  taxi.offset = feintPose(0.5).offset;
  resetSignal(taxi);
  assert.equal(taxi.feint, null);
  assert.equal(taxi.offset, TRACKS[0]);
});

test('racing follower copies the lead taxi lane change then challenges and overtakes it', () => {
  for (const direction of [-1, 1]) for (const weaving of [0, 2]) {
    const leader = vehicle(14 * direction, 1, true), follower = vehicle(3 * direction, 0, true);
    leader.fromTrack = 0; leader.offset = TRACKS[0]; leader.changing = true; leader.merge = 0; leader.cooldown = 2;
    leader.speed = follower.speed = 16;
    const cars = [leader, follower];
    let copied = false, challenged = false, won = false;
    for (let frame = 0; frame < 600; frame++) {
      updateTraffic(cars, direction, 0.025, true, { weaving });
      if (follower.race?.phase === 'follow') {
        copied ||= follower.track === 1;
        assert.ok((leader.position - follower.position) * direction >= CAR_GAP - 1e-7);
      }
      challenged ||= follower.race?.phase === 'challenge';
      for (const track of [0, 1]) if (occupiesTrack(leader, track) && occupiesTrack(follower, track)) {
        assert.ok(Math.abs(leader.position - follower.position) >= CAR_GAP - 1e-7);
      }
      if (follower.raceResult === 'won') { won = true; break; }
    }
    assert.ok(copied && challenged && won);
    assert.ok((follower.position - leader.position) * direction > CAR_GAP);
    assert.equal(leader.raceResult, 'lost');
  }
});

test('recycling one racing taxi releases both participants', () => {
  const leader = vehicle(14, 0, true), follower = vehicle(3, 0, true);
  updateTraffic([leader, follower], 1, 0.02, true);
  assert.equal(follower.race?.leader, leader);
  resetSignal(follower);
  assert.equal(leader.race, null);
  assert.equal(follower.race, null);
  assert.ok(leader.raceCooldown > 0);
});
