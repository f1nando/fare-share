import { DEFAULT_SETTINGS, normalizeSettings } from './settings.js';
import { populateLane } from './trafficPopulation.js';

export const SCENARIOS = Object.freeze({
  main: { name: 'Main', settings: { ...DEFAULT_SETTINGS, density: 65, taxiShare: 6, trafficSpeed: 135, taxiSpeed: 140, weaving: 200, zoom: 70 } },
  defaults: { name: 'Defaults', settings: { ...DEFAULT_SETTINGS } },
  stress: { name: 'High load', settings: { ...DEFAULT_SETTINGS, density: 150, taxiShare: 30, weaving: 200, zoom: 70 } },
});

export function scenarioSettings(name = 'main') {
  if (!SCENARIOS[name]) throw new Error(`Unknown scenario: ${name}`);
  return normalizeSettings({ ...SCENARIOS[name].settings, paused: false });
}

// The default retains fixed-grid regression fixtures. Live/CPU city benchmarks
// opt into the current park layout explicitly.
export function scenarioTraffic(settings, radius = 5, seed = 0, roadLayout = false) {
  const lanes = new Map();
  const x = typeof radius === 'number' ? radius : radius.x, z = typeof radius === 'number' ? radius : radius.z;
  for (const axis of [0, 1]) {
    const across = axis === 0 ? z : x, along = axis === 0 ? x : z;
    for (let line = -across; line <= across; line++) for (const direction of [-1, 1]) {
      lanes.set(`${axis}:${line}:${direction}`, populateLane(axis, line, direction, settings, along, 0, seed, roadLayout));
    }
  }
  return lanes;
}

export function summarize(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const round = value => Math.round(value * 1000) / 1000;
  const percentile = p => round(sorted[Math.ceil(sorted.length * p) - 1]);
  return { mean: round(values.reduce((sum, n) => sum + n, 0) / values.length),
    median: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: round(sorted.at(-1)) };
}

export function assessFrameCadence(rows) {
  let run = 0, longestLimitedRun = 0, limitedMs = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // A long low-work tail can be hidden by thousands of fast frames in the
    // overall mean. Retain the samples, but don't call that a reliable FPS test.
    const limited = row.rafMs >= 500 && row.cpuMs < 50 && (rows[i - 1]?.cpuMs ?? 0) < 50;
    run = limited ? run + 1 : 0;
    longestLimitedRun = Math.max(longestLimitedRun, run);
    if (limited) limitedMs += row.rafMs;
  }
  return { valid: rows.length >= 60 && summarize(rows.map(row => row.rafMs)).mean <= 250 && longestLimitedRun < 3,
    longestLimitedRun, limitedMs };
}

export function trafficSnapshot(lanes) {
  let hash = 2166136261, cars = 0, taxis = 0, turns = 0, launches = 0;
  const mix = value => { const text = String(value); for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619); };
  for (const [key, lane] of lanes) {
    mix(key);
    for (const car of lane.cars) {
      cars++; taxis += Number(car.taxi);
      turns += car.turnsCompleted ?? 0; launches += car.launchesCompleted ?? 0;
      for (const value of [car.position, car.speed, car.track, car.offset, car.steer, car.turn?.distance ?? 0, car.crossing ?? 0]) mix(Math.round(value * 1e6));
      mix(car.taxi); mix(car.turnsCompleted ?? 0);
    }
  }
  return { cars, taxis, turns, launches, checksum: (hash >>> 0).toString(16).padStart(8, '0') };
}
