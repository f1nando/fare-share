import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_BOUNCE_DURATION, nearestClickableVehicle, vehicleBounceLift } from '../src/city/vehicleBounce.js';

test('vehicle bounce is a visual up-and-down arc with no lasting offset', () => {
  assert.equal(vehicleBounceLift(0), 0);
  assert.ok(vehicleBounceLift(VEHICLE_BOUNCE_DURATION / 2) > 1);
  assert.ok(vehicleBounceLift(VEHICLE_BOUNCE_DURATION / 4) > 0);
  assert.equal(vehicleBounceLift(VEHICLE_BOUNCE_DURATION), 0);
  assert.equal(vehicleBounceLift(VEHICLE_BOUNCE_DURATION + 100), 0);
});

test('click selection chooses only a nearby rendered vehicle', () => {
  const first = { x: 1, z: 2, key: 'first' };
  const second = { x: 5, z: 5, key: 'second' };
  assert.equal(nearestClickableVehicle([first, second], { x: 4.8, y: 1, z: 5.1 }), second);
  assert.equal(nearestClickableVehicle([first, second], { x: 20, y: 0, z: 20 }), null);
});
