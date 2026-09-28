import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_BOUNCE_DURATION, animationVariation, nearestScreenVehicle, stuntType, vehicleBounceLift, vehicleBrushPadding, vehicleStunt } from '../src/city/vehicleBounce.js';

test('vehicle bounce is a visual up-and-down arc with no lasting offset', () => {
  assert.equal(vehicleBounceLift(0), 0);
  assert.ok(vehicleBounceLift(VEHICLE_BOUNCE_DURATION / 2) > 1);
  assert.ok(vehicleBounceLift(VEHICLE_BOUNCE_DURATION / 4) > 0);
  assert.equal(vehicleBounceLift(VEHICLE_BOUNCE_DURATION), 0);
  assert.equal(vehicleBounceLift(VEHICLE_BOUNCE_DURATION + 100), 0);
});

test('each vehicle type gets only its requested visual stunt', () => {
  assert.equal(stuntType('motorcycle'), 'motorcycle');
  assert.equal(stuntType('car', true), 'taxi');
  assert.equal(stuntType('truck'), 'heavy');
  assert.equal(stuntType('bus'), 'heavy');
  assert.equal(stuntType('boat'), 'boat');
  assert.equal(stuntType('helicopter'), 'helicopter');
  assert.ok(Math.abs(vehicleStunt('motorcycle', 450).pitch - Math.PI) < 1e-9);
  assert.ok(Math.abs(vehicleStunt('motorcycle', 450, -1).pitch + Math.PI) < 1e-9);
  assert.ok(Math.abs(vehicleStunt('taxi', 425).roll - Math.PI) < 1e-9);
  const heavy = vehicleStunt('heavy', 180);
  assert.ok(Math.abs(heavy.roll) > 0.1);
  assert.ok(Math.abs(heavy.pitch) > 0.02);
  assert.ok(heavy.lift > 0.1);
  assert.ok(vehicleStunt('boat', 200).pitch !== 0);
  assert.ok(vehicleStunt('helicopter', 500).yaw > 3);
});

test('animation variations change direction, strength and rhythm within safe bounds', () => {
  const weak = animationVariation(() => 0);
  const strong = animationVariation(() => 0.999);
  assert.deepEqual(weak, { direction: -1, strength: 0.65, cycles: 1.5 });
  assert.equal(strong.direction, 1);
  assert.ok(strong.strength > 1.34 && strong.strength <= 1.35);
  assert.equal(strong.cycles, 2.5);
  const weakHeavy = vehicleStunt('heavy', 180, { direction: 1, strength: 0.65, cycles: 2 });
  const strongHeavy = vehicleStunt('heavy', 180, { direction: 1, strength: 1.35, cycles: 2 });
  assert.ok(Math.abs(strongHeavy.roll) > Math.abs(weakHeavy.roll));
});

test('click selection chooses only a nearby rendered vehicle', () => {
  const first = { screenX: 100, screenY: 200, key: 'first' };
  const second = { screenX: 500, screenY: 300, key: 'second' };
  assert.equal(nearestScreenVehicle([first, second], { x: 492, y: 305 }), second);
  assert.equal(nearestScreenVehicle([first, second], { x: 700, y: 500 }), null);
});

test('brush radius includes the visible body size of each vehicle type', () => {
  assert.ok(vehicleBrushPadding('heavy') > vehicleBrushPadding('car'));
  assert.ok(vehicleBrushPadding('helicopter') > vehicleBrushPadding('heavy'));
  assert.equal(vehicleBrushPadding('car'), 12);
  assert.equal(vehicleBrushPadding('heavy'), 22);
});
