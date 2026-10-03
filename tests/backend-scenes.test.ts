import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import { DrivingSceneError, parseSceneInput, sceneSummary } from '../server/drivingScenes.js';

test('driving scene input accepts an image and numeric settings', () => {
  const input = parseSceneInput({
    name: 'Black taxi',
    imageDataUrl: `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
    settings: { markSpeed: 19, leftX: 65.1 },
    vehicleClass: 'Trainee',
    lightsOn: true,
  }, true);
  assert.equal(input.name, 'Black taxi');
  assert.equal(input.image?.mime, 'image/png');
  assert.deepEqual(input.settings, { markSpeed: 19, leftX: 65.1 });
  assert.equal(input.vehicleClass, 'Trainee');
  assert.equal(input.lightsOn, true);
});

test('driving scene input rejects unsupported images and non-numeric settings', () => {
  assert.throws(
    () => parseSceneInput({ name: 'Taxi', imageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=', settings: {} }, true),
    DrivingSceneError,
  );
  assert.throws(
    () => parseSceneInput({ name: 'Taxi', settings: { markSpeed: 'fast' } }, false),
    DrivingSceneError,
  );
  assert.throws(
    () => parseSceneInput({ name: 'Taxi', settings: {}, vehicleClass: 'Premium' }, false),
    DrivingSceneError,
  );
});

test('legacy Legend class is normalized to the Legendary card label', () => {
  const input = parseSceneInput({ name: 'Taxi', settings: {}, vehicleClass: 'Legend' }, false);
  assert.equal(input.vehicleClass, 'Legendary');
});

test('scene summary omits image data and exposes a versioned image URL', () => {
  const id = new ObjectId();
  const date = new Date('2026-09-27T12:00:00.000Z');
  const summary = sceneSummary({
    _id: id,
    name: 'Taxi',
    imageMime: 'image/png',
    settings: { markSpeed: 19 },
    vehicleClass: 'Trainee',
    lightsOn: false,
    createdAt: date,
    updatedAt: date,
  });
  assert.equal(summary.id, id.toHexString());
  assert.equal(summary.vehicleClass, 'Trainee');
  assert.match(summary.imageUrl, new RegExp(`${id.toHexString()}/image\\?v=${date.getTime()}`));
  assert.equal(
    sceneSummary({
      _id: id,
      name: 'Taxi',
      imageMime: 'image/png',
      settings: {},
      vehicleClass: 'Economy',
      lightsOn: false,
      createdAt: date,
      updatedAt: date,
    }, '/api/admin/driving-scenes').imageUrl,
    `/api/admin/driving-scenes/${id.toHexString()}/image?v=${date.getTime()}`,
  );
});
