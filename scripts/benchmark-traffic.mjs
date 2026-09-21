import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { cpus, platform } from 'node:os';
import { resetSignal, STOP_LINE } from '../src/city/world.js';
import { relocateToRoad } from '../src/city/roadLayout.js';
import { updateNetwork } from '../src/city/trafficNetwork.js';
import { scenarioSettings, scenarioTraffic, summarize, trafficSnapshot } from '../src/city/benchmarkScenario.js';
import { codeVersion } from './benchmark-version.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const radius = Number(args[0]?.startsWith('--') ? 5 : args[0] ?? 5);
const radiusZ = Number(option('--radius-z', radius));
const scenario = option('--scenario', 'main'), runs = Number(option('--runs', 1));
const frames = Number(option('--frames', 1200)), warmup = Number(option('--warmup', 120)), seed = Number(option('--seed', 0));
if (![radius, radiusZ, runs, frames, warmup, seed].every(Number.isInteger) || radius < 1 || radius > 12 || radiusZ < 1 || radiusZ > 12 || runs < 1 || runs > 10 || frames < 1 || frames > 18000 || warmup < 0) throw new Error('Invalid benchmark arguments');
const settings = scenarioSettings(scenario), blockSize = settings.blockSize;
const report = { runId: randomUUID(), date: new Date().toISOString(), version: codeVersion(),
  runtime: process.version, os: platform(), cpu: cpus()[0]?.model, build: 'node CPU simulation',
  scenario, settings, seed, radius, radiusZ, warmup, frames, delta: 1 / 60, camera: 'stationary; no rendering', runs: [] };

if (runs > 1) {
  for (let run = 0; run < runs; run++) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), String(radius), '--scenario', scenario,
      '--radius-z', String(radiusZ), '--frames', String(frames), '--warmup', String(warmup), '--seed', String(seed)], { encoding: 'utf8' });
    if (child.status !== 0) throw new Error(child.stderr || 'CPU run failed');
    report.runs.push(JSON.parse(child.stdout).runs[0]);
    console.error(`Run ${run + 1}/${runs}: ${report.runs.at(-1).timing.mean} ms`);
  }
} else {
  const lanes = scenarioTraffic(settings, { x: radius, z: radiusZ }, seed, true), initial = trafficSnapshot(lanes);
  function step(frame) {
    for (const lane of lanes.values()) for (const car of lane.cars) {
      const half = ((lane.axis === 0 ? radius : radiusZ) + 0.5) * blockSize;
      const multiplier = (car.taxi ? settings.taxiSpeed : settings.trafficSpeed) / 100;
      car.cruise = car.baseCruise * multiplier; car.acceleration = car.baseAcceleration * multiplier;
      if (car.position < blockSize / 2 - half) { car.position += half * 2; resetSignal(car); relocateToRoad(car, blockSize, STOP_LINE); }
      if (car.position > blockSize / 2 + half) { car.position -= half * 2; resetSignal(car); relocateToRoad(car, blockSize, STOP_LINE); }
    }
    const clockMultiplier = Math.min(1, settings.trafficSpeed / 100, settings.taxiSpeed / 100);
    updateNetwork(lanes, 1 / 60, frame / 60 * clockMultiplier, { blockSize, weaving: settings.weaving / 100, clockMultiplier, roadLayout: true });
  }
  for (let i = 0; i < warmup; i++) step(i);
  const samples = [];
  for (let i = warmup; i < warmup + frames; i++) {
    const start = performance.now(); step(i); samples.push(performance.now() - start);
  }
  report.runs.push({ timing: summarize(samples), initial, final: trafficSnapshot(lanes), samples });
  if (args.includes('--profile')) {
    const session = new Session(); session.connect();
    const post = method => new Promise((resolve, reject) => session.post(method, (error, result) => error ? reject(error) : resolve(result)));
    await post('Profiler.enable'); await post('Profiler.start');
    for (let i = warmup + frames; i < warmup + frames * 2; i++) step(i);
    const { profile } = await post('Profiler.stop'); session.disconnect();
    const nodes = new Map(profile.nodes.map(node => [node.id, node])), totals = new Map();
    profile.samples.forEach((id, index) => {
      const frame = nodes.get(id).callFrame, key = `${frame.functionName || '(anonymous)'} — ${frame.url.split('/').at(-1)}:${frame.lineNumber + 1}`;
      totals.set(key, (totals.get(key) ?? 0) + profile.timeDeltas[index]);
    });
    const total = [...totals.values()].reduce((sum, n) => sum + n, 0);
    report.selfTimeProfile = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, value]) => ({ name, percent: +(value * 100 / total).toFixed(1) }));
  }
}
report.meanAcrossRuns = summarize(report.runs.map(run => run.timing.mean));
report.repeatable = new Set(report.runs.map(run => JSON.stringify([run.initial, run.final]))).size === 1;
if (!report.repeatable) throw new Error('Deterministic scenario changed between runs');
const out = option('--out');
if (out) {
  const target = resolve(out); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: target, version: report.version, scenario, radius, cars: report.runs[0].initial.cars,
    timings: report.runs.map(run => run.timing), checksum: report.runs[0].final.checksum, repeatable: report.repeatable }));
} else console.log(JSON.stringify(report));
