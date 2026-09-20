import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/city/settings.js';

test('missing or invalid saved settings retain working defaults', () => {
  for (const input of [null, undefined, 'bad', [], { density: 'many', zoom: NaN, paused: 'yes' }]) {
    assert.deepEqual(normalizeSettings(input), DEFAULT_SETTINGS);
  }
});

test('saved controls clamp to supported ranges and ignore unknown fields', () => {
  const settings = normalizeSettings({ density: 999, taxiShare: -10, blockSize: 35, zoom: Infinity, cameraSpeed: 0, paused: true, injected: 123 });
  assert.equal(settings.density, 150);
  assert.equal(settings.taxiShare, 0);
  assert.equal(settings.blockSize, 36);
  assert.equal(settings.zoom, 80);
  assert.equal(settings.cameraSpeed, 0);
  assert.equal(settings.paused, true);
  assert.equal(settings.injected, undefined);
  assert.equal(DEFAULT_SETTINGS.density, 70);
});
