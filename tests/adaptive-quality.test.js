import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality, QUALITY_PROFILES, framePercentile, qualityForFrameTime } from '../src/city/adaptiveQuality.js';

test('quality profiles follow real p95 frame time boundaries', () => {
  assert.equal(qualityForFrameTime(18, QUALITY_PROFILES.high), QUALITY_PROFILES.max);
  assert.equal(qualityForFrameTime(22, QUALITY_PROFILES.max), QUALITY_PROFILES.max);
  assert.equal(qualityForFrameTime(22.1, QUALITY_PROFILES.max), QUALITY_PROFILES.high);
  assert.equal(qualityForFrameTime(28.1, QUALITY_PROFILES.high), QUALITY_PROFILES.medium);
  assert.equal(qualityForFrameTime(36.1, QUALITY_PROFILES.medium), QUALITY_PROFILES.low);
  assert.equal(qualityForFrameTime(28, QUALITY_PROFILES.low), QUALITY_PROFILES.medium);
  assert.equal(framePercentile([40, 10, 20, 30], 0.5), 20);
});

test('quality profiles contain graphics settings only', () => {
  for (const profile of Object.values(QUALITY_PROFILES)) {
    assert.equal('densityScale' in profile, false);
    assert.ok(profile.pixelRatio > 0);
  }
});

test('the first 2.5 second window selects quality from measured frames', () => {
  const changes = [];
  const quality = new AdaptiveQuality(profile => changes.push(profile.name));
  for (let time = 0; time <= 2600; time += 40) quality.record(time, 40);
  assert.equal(quality.profile, QUALITY_PROFILES.low);
  assert.deepEqual(changes, ['low']);
});

test('live measurements upgrade cautiously and downgrade immediately', () => {
  const changes = [];
  const quality = new AdaptiveQuality(profile => changes.push(profile.name), {
    sampleDuration: 100, resampleDuration: 100, minSamples: 3,
  });
  for (const [time, frame] of [[0, 17], [50, 17], [100, 17]]) quality.record(time, frame);
  assert.equal(quality.profile, QUALITY_PROFILES.max);
  for (const [time, frame] of [[200, 25], [250, 25], [300, 25]]) quality.record(time, frame);
  assert.equal(quality.profile, QUALITY_PROFILES.high);
  for (const [time, frame] of [[400, 40], [450, 40], [500, 40]]) quality.record(time, frame);
  assert.equal(quality.profile, QUALITY_PROFILES.low);
  for (const [time, frame] of [[600, 25], [650, 25], [700, 25]]) quality.record(time, frame);
  assert.equal(quality.profile, QUALITY_PROFILES.low);
  for (const [time, frame] of [[800, 25], [850, 25], [900, 25]]) quality.record(time, frame);
  assert.equal(quality.profile, QUALITY_PROFILES.medium);
  assert.deepEqual(changes, ['max', 'high', 'low', 'medium']);
});

test('reset discards an incomplete timing window after visibility changes', () => {
  const quality = new AdaptiveQuality(() => {}, { sampleDuration: 100, minSamples: 3 });
  quality.record(0, 40); quality.record(50, 40); quality.reset();
  quality.record(1000, 16); quality.record(1050, 16); quality.record(1100, 16);
  assert.equal(quality.profile, QUALITY_PROFILES.max);
});
