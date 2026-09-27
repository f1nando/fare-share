import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality, QUALITY_PROFILES, framePercentile, qualityForFrameTime, scaledDensity } from '../src/city/adaptiveQuality.js';

test('quality profiles follow real p95 frame time boundaries', () => {
  assert.equal(qualityForFrameTime(20), QUALITY_PROFILES.high);
  assert.equal(qualityForFrameTime(20.1), QUALITY_PROFILES.medium);
  assert.equal(qualityForFrameTime(32), QUALITY_PROFILES.medium);
  assert.equal(qualityForFrameTime(32.1), QUALITY_PROFILES.low);
  assert.equal(framePercentile([40, 10, 20, 30], 0.5), 20);
});

test('density profiles preserve zero and use supported five-percent steps', () => {
  assert.equal(scaledDensity(70, QUALITY_PROFILES.high), 70);
  assert.equal(scaledDensity(70, QUALITY_PROFILES.medium), 55);
  assert.equal(scaledDensity(70, QUALITY_PROFILES.low), 35);
  assert.equal(scaledDensity(0, QUALITY_PROFILES.low), 0);
  assert.equal(scaledDensity(200, QUALITY_PROFILES.high), 200);
});

test('the first 2.5 second window selects quality from measured frames', () => {
  const changes = [];
  const quality = new AdaptiveQuality(profile => changes.push(profile.name));
  for (let time = 0; time <= 2600; time += 40) quality.record(time, 40);
  assert.equal(quality.profile, QUALITY_PROFILES.low);
  assert.deepEqual(changes, ['low']);
});

test('later windows can downgrade but do not oscillate back upward', () => {
  const changes = [];
  const quality = new AdaptiveQuality(profile => changes.push(profile.name), {
    sampleDuration: 100, resampleDuration: 100, minSamples: 3,
  });
  for (const [time, frame] of [[0, 25], [50, 25], [100, 25]]) quality.record(time, frame);
  assert.equal(quality.profile, QUALITY_PROFILES.medium);
  for (const [time, frame] of [[200, 16], [250, 16], [300, 16]]) quality.record(time, frame);
  assert.equal(quality.profile, QUALITY_PROFILES.medium);
  for (const [time, frame] of [[400, 40], [450, 40], [500, 40]]) quality.record(time, frame);
  assert.equal(quality.profile, QUALITY_PROFILES.low);
  assert.deepEqual(changes, ['medium', 'low']);
});

test('reset discards an incomplete timing window after visibility changes', () => {
  const quality = new AdaptiveQuality(() => {}, { sampleDuration: 100, minSamples: 3 });
  quality.record(0, 40); quality.record(50, 40); quality.reset();
  quality.record(1000, 16); quality.record(1050, 16); quality.record(1100, 16);
  assert.equal(quality.profile, QUALITY_PROFILES.high);
});
