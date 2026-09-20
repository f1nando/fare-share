import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BODY_PITCH, MAX_BODY_ROLL, bodyPartPose, updateBodyMotion } from '../src/city/vehicleBody.js';
import { addCar } from '../src/city/createCity.js';

test('taxi nose rises under acceleration, leans in steering and settles back on a straight', () => {
  const car = { taxi: true, speed: 0, steer: 0.2 };
  for (let frame = 0; frame < 20; frame++) {
    const previous = car.speed;
    car.speed += 0.7;
    updateBodyMotion(car, 0.02, previous);
  }
  assert.ok(car.pitch < -0.05 && car.roll < -0.04);
  assert.ok(bodyPartPose(0, 0.42, 1.125, car.pitch, car.roll).y > 0.42);
  car.steer = 0;
  for (let frame = 0; frame < 200; frame++) updateBodyMotion(car, 0.02, car.speed);
  assert.ok(Math.abs(car.pitch) < 1e-6 && Math.abs(car.roll) < 1e-6);
});

test('braking tips the nose down; maximum combined lean leaves the body above the ground', () => {
  const car = { taxi: true, speed: 20, steer: 0 };
  for (let frame = 0; frame < 15; frame++) {
    const previous = car.speed;
    car.speed -= 1;
    updateBodyMotion(car, 0.02, previous);
  }
  assert.ok(car.pitch > 0.04);
  for (const pitch of [-MAX_BODY_PITCH, MAX_BODY_PITCH]) for (const roll of [-MAX_BODY_ROLL, MAX_BODY_ROLL]) {
    for (const x of [-0.46, 0.46]) for (const z of [-1.125, 1.125]) assert.ok(bodyPartPose(x, 0.18, z, pitch, roll).y > 0);
  }
});

test('body animation freezes at zero delta and remains bounded at the maximum frame step', () => {
  const car = { taxi: true, speed: 10, steer: 0.2, pitch: -0.02, roll: -0.04 };
  const before = { ...car };
  updateBodyMotion(car, 0, 0);
  assert.deepEqual(car, before);
  for (let i = 0; i < 100; i++) {
    const previous = car.speed;
    car.speed = i % 2 ? 30 : 0;
    car.steer = i % 2 ? 0.2 : -0.2;
    updateBodyMotion(car, 0.06, previous);
    assert.ok(Number.isFinite(car.pitch) && Math.abs(car.pitch) <= MAX_BODY_PITCH);
    assert.ok(Number.isFinite(car.roll) && Math.abs(car.roll) <= MAX_BODY_ROLL);
  }
});

test('actual instanced car parts tilt together while tyres and headlight beams stay flat', () => {
  for (const axis of [0, 1]) for (const direction of [-1, 1]) {
    const parts = [];
    const car = { taxi: true, axis, direction, line: 0, position: 0, offset: 0.82,
      steer: 0.1, pitch: -0.07, roll: 0.08, flashAge: 0 };
    addCar({ add(...args) { parts.push(args); } }, car, 0, 0, { x: 0, z: 0 }, { right: 100, top: 100 }, 40);
    const tyres = parts.filter(part => part[0] === 'box' && part[4] === 1.04);
    assert.equal(tyres.length, 2);
    for (const tyre of tyres) {
      assert.equal(tyre[2], 0.22);
      assert.equal(tyre[9], 0);
      assert.equal(tyre[10], 0);
    }
    for (const body of parts.filter(part => part[0] === 'taxi' || part[0] === 'car')) {
      assert.equal(body[9], car.pitch);
      assert.equal(body[10], car.roll);
    }
    for (const beam of parts.filter(part => part[0] === 'beam')) assert.equal(beam[2], 0.035);
  }
});
