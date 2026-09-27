import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_BOUNCE_DURATION, nearestScreenVehicle, vehicleBounceLift } from '../src/city/vehicleBounce.js';

test('vehicle bounce is a visual up-and-down arc with no lasting offset', () => {
  assert.equal(vehicleBounceLift(0), 0);
  assert.ok(vehicleBounceLift(VEHICLE_BOUNCE_DURATION / 2) > 1);
  assert.ok(vehicleBounceLift(VEHICLE_BOUNCE_DURATION / 4) > 0);
  assert.equal(vehicleBounceLift(VEHICLE_BOUNCE_DURATION), 0);
  assert.equal(vehicleBounceLift(VEHICLE_BOUNCE_DURATION + 100), 0);
});

test('click selection chooses only a nearby rendered vehicle', () => {
  const first = { screenX: 100, screenY: 200, key: 'first' };
  const second = { screenX: 500, screenY: 300, key: 'second' };
  assert.equal(nearestScreenVehicle([first, second], { x: 492, y: 305 }), second);
  assert.equal(nearestScreenVehicle([first, second], { x: 700, y: 500 }), null);
});
