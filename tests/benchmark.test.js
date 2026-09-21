import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioSettings, scenarioTraffic, summarize, trafficSnapshot } from '../src/city/benchmarkScenario.js';
import { updateNetwork } from '../src/city/trafficNetwork.js';

test('statistics retain tails and handle unavailable GPU samples', () => {
  assert.equal(summarize([]), null);
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual(summarize(values.reverse()), { mean: 50.5, median: 50, p95: 95, p99: 99, max: 100 });
  assert.equal(summarize([16.667]).p99, 16.667);
});

test('named scenarios are independent copies and match the actual scene population', () => {
  const settings = scenarioSettings(); settings.density = 0;
  assert.equal(scenarioSettings().density, 65);
  assert.equal(trafficSnapshot(scenarioTraffic(scenarioSettings(), 5)).cars, 2376);
  assert.equal(trafficSnapshot(scenarioTraffic(settings)).cars, 0);
  assert.throws(() => scenarioSettings('missing'));
});

test('same seed reproduces initial and evolved traffic; changed seed is detectable', () => {
  const settings = scenarioSettings(), first = scenarioTraffic(settings, 1, 0), second = scenarioTraffic(settings, 1, 0);
  assert.deepEqual(trafficSnapshot(first), trafficSnapshot(second));
  assert.notEqual(trafficSnapshot(first).checksum, trafficSnapshot(scenarioTraffic(settings, 1, 9)).checksum);
  for (let i = 0; i < 90; i++) {
    for (const lanes of [first, second]) updateNetwork(lanes, 1 / 60, i / 60, { blockSize: 40, weaving: 2 });
  }
  assert.deepEqual(trafficSnapshot(first), trafficSnapshot(second));
});
