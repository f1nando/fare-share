import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_BOUNCE_DURATION, nearestScreenVehicle, stuntType, vehicleBounceLift, vehicleStunt } from '../src/city/vehicleBounce.js';

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
  assert.ok(vehicleStunt('heavy', 200).roll !== 0);
  assert.ok(vehicleStunt('boat', 200).pitch !== 0);
  assert.ok(vehicleStunt('helicopter', 500).yaw > 3);
});

test('click selection chooses only a nearby rendered vehicle', () => {
  const first = { screenX: 100, screenY: 200, key: 'first' };
  const second = { screenX: 500, screenY: 300, key: 'second' };
  assert.equal(nearestScreenVehicle([first, second], { x: 492, y: 305 }), second);
  assert.equal(nearestScreenVehicle([first, second], { x: 700, y: 500 }), null);
});
