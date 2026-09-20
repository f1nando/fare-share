import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, updateTraffic, headlightsOn, resetSignal } from '../src/city/world.js';
import { hornAnimation, HORN_DURATION } from '../src/city/hornAnimation.js';
import { addCar } from '../src/city/createCity.js';

const car = (position, taxi = false) => ({ axis: 0, line: 0, direction: 1, position, taxi,
  track: 0, fromTrack: 0, offset: TRACKS[0], speed: taxi ? 8 : 3, cruise: taxi ? 8 : 3,
  cooldown: 0, changing: false, merge: 1, steer: 0 });

test('requests cycle through lights, horn and both, and all three make the leader yield', () => {
  const taxi = car(0, true);
  for (const mode of ['flash', 'horn', 'both', 'flash', 'horn', 'both']) {
    resetSignal(taxi);
    Object.assign(taxi, { position: 0, track: 0, fromTrack: 0, changing: false, offset: TRACKS[0], cooldown: 0, speed: 8 });
    const leader = car(10);
    updateTraffic([taxi, leader], 1, 0.02, true);
    assert.equal(taxi.signalMode, mode);
    assert.equal(headlightsOn(taxi), mode !== 'horn');
    assert.equal(taxi.hornAge === 0, mode !== 'flash');
    assert.ok(leader.yieldRemaining > 0);
    const age = taxi.hornAge;
    updateTraffic([taxi, leader], 1, 0, true);
    assert.equal(taxi.hornAge, age);
    for (let frame = 0; frame < 100; frame++) updateTraffic([taxi, leader], 1, 0.02, true);
    assert.equal(leader.track, 1);
    assert.equal(taxi.hornAge, null);
  }
});

test('visual horn has expanding fading waves, different flying words, bounded hops and a clean end', () => {
  const first = hornAnimation(0.12), later = hornAnimation(0.42);
  assert.ok(first.bounce > 0.1 && first.bounce <= 0.14);
  assert.ok(later.waves[0].radius > first.waves[0].radius);
  assert.ok(later.waves[0].opacity < first.waves[0].opacity);
  assert.ok(later.labels[0].y > first.labels[0].y);
  assert.ok(later.labels.some(label => label.x < 0) && later.labels.some(label => label.x > 0));
  assert.deepEqual(new Set(later.labels.map(label => label.word)), new Set(['HONK!', 'BEEP!']));
  for (const age of [null, undefined, -1, HORN_DURATION, 3]) assert.deepEqual(hornAnimation(age), { bounce: 0, waves: [], labels: [] });
});

test('horn lifts the rendered body and all four tyres while ground beams stay flat, and recycling clears it', () => {
  const taxi = { ...car(0, true), hornAge: 0.12, flashAge: 0, rideHeight: 0.21,
    surfaceSupport: 0.21, wheelHeights: [0.42, 0, 0.42, 0] };
  const parts = [], effects = [];
  addCar({ add(...args) { parts.push(args); } }, taxi, 0, 0, { x: 0, z: 0 }, { right: 100, top: 100 }, 40,
    { add(...args) { effects.push(args); } });
  const hop = hornAnimation(taxi.hornAge).bounce;
  assert.ok(Math.abs(parts[0][2] - (0.42 + 0.21 + hop)) < 1e-8);
  const tyres = parts.filter(p => p[0] === 'box' && p[4] === 0.18 && p[5] === 0.32);
  assert.equal(tyres.length, 4);
  tyres.forEach((tyre, i) => assert.ok(Math.abs(tyre[2] - (0.22 + taxi.wheelHeights[i] + hop)) < 1e-8));
  parts.filter(p => p[0] === 'beam').forEach(beam => assert.equal(beam[2], 0.035));
  assert.equal(effects.length, 1);
  resetSignal(taxi);
  assert.equal(taxi.hornAge, null);
});
