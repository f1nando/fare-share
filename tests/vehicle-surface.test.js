import test from 'node:test';
import assert from 'node:assert/strict';
import { PAVED_ROAD, TRACKS, STOP_LINE, CAR_GAP, trackOffset, vehiclePose, resetSignal } from '../src/city/world.js';
import { roadHeight, updateSurfaceMotion } from '../src/city/vehicleSurface.js';
import { updateNetwork, carCoordinates } from '../src/city/trafficNetwork.js';
import { addCar } from '../src/city/createCity.js';

test('narrow shoulder route straddles the sidewalk in either direction on either road axis', () => {
  for (const axis of [0, 1]) for (const direction of [-1, 1]) for (const blockSize of [24, 40, 48]) {
    const car = { axis, direction, line: -1, position: -blockSize / 2, offset: trackOffset(2), steer: 0, speed: 16 };
    const p = carCoordinates(car, blockSize), pose = vehiclePose(p.x, p.z, axis, direction, 0);
    updateSurfaceMotion(car, pose, 0.02, blockSize, PAVED_ROAD / 2);
    for (const [i, height] of car.wheelHeights.entries()) assert.ok(Math.abs(height - (i % 2 ? 0 : 0.42)) < 1e-8);
    assert.ok(car.roadRoll < -0.4);
    assert.ok(Math.abs(car.surfaceSupport - 0.21) < 1e-8);
    assert.ok(Math.abs(roadHeight(0, 0, blockSize, PAVED_ROAD / 2)) < 1e-8);
  }
});

test('curb entry causes a finite hop, settles on the pavement, and drops back onto the road', () => {
  const car = { speed: 16 };
  const update = (offset, delta = 0.02) => updateSurfaceMotion(car, { x: 20, z: offset, angle: Math.PI / 2 }, delta, 40, PAVED_ROAD / 2);
  update(TRACKS[1]);
  let maxAir = 0;
  for (let i = 0; i < 30; i++) {
    update(TRACKS[1] + (trackOffset(2) - TRACKS[1]) * Math.min(i / 17, 1));
    maxAir = Math.max(maxAir, car.rideHeight - car.surfaceSupport);
  }
  assert.ok(maxAir > 0.08 && maxAir < 0.6, `hop height ${maxAir}`);
  const before = JSON.stringify(car); update(trackOffset(2), 0); assert.equal(JSON.stringify(car), before);
  for (let i = 0; i < 150; i++) update(trackOffset(2));
  assert.ok(Math.abs(car.rideHeight - 0.21) < 1e-8);
  update(TRACKS[1]);
  assert.ok(car.rideHeight > 0.1, 'dropping off the curb follows an airborne arc');
  for (let i = 0; i < 150; i++) update(TRACKS[1]);
  assert.equal(car.rideHeight, 0);
  assert.equal(car.roadRoll, 0);
});

test('actual shoulder overtakes hop in the network; tyres rise independently and recycling clears the pose', () => {
  for (const axis of [0, 1]) for (const direction of [-1, 1]) {
    const make = (position, taxi) => ({ axis, line: 0, direction, position: position * direction,
      taxi, track: 1, fromTrack: 1, offset: TRACKS[1], cruise: taxi ? 16 : 6,
      speed: 0, acceleration: taxi ? 25 : 4, cooldown: 0, merge: 1, changing: false, steer: 0 });
    const car = make(-STOP_LINE - CAR_GAP * 3, true);
    const cars = [car, ...[0, 1, 2].map(i => make(-STOP_LINE - CAR_GAP * i, false))];
    const lanes = new Map([[`${axis}:0:${direction}`, { axis, line: 0, direction, cars }]]);
    let hopped = false, climbed = false;
    for (let i = 0; i < 250; i++) {
      updateNetwork(lanes, 0.02, 9, { blockSize: 40, weaving: 0 });
      hopped ||= car.rideHeight - car.surfaceSupport > 0.06;
      if (Math.max(...car.wheelHeights) > 0.4 && Math.min(...car.wheelHeights) === 0) {
        climbed = true;
        const parts = [];
        addCar({ add(...args) { parts.push(args); } }, car, 0, 0, { x: 0, z: 0 }, { right: 100, top: 100 }, 40);
        const tyres = parts.filter(p => p[0] === 'box' && p[4] === 0.18 && p[5] === 0.32);
        assert.equal(tyres.length, 4);
        assert.ok(Math.max(...tyres.map(p => p[2])) - Math.min(...tyres.map(p => p[2])) > 0.4);
      }
    }
    assert.ok(hopped && climbed);
    resetSignal(car);
    assert.equal(car.rideHeight, 0);
    assert.equal(car.roadRoll, 0);
    assert.equal(car.wheelHeights, null);
  }
});
