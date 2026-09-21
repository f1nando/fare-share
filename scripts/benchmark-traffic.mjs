import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import { seededRandom, TRACKS, TRAFFIC_SPACING, resetSignal } from '../src/city/world.js';
import { updateNetwork } from '../src/city/trafficNetwork.js';

// Deterministic CPU-only workload; no browser, GPU, smoke-test collision scans,
// or simulated mobile throttling. Radius matches createCity's active world.
const radius = Number(process.argv[2] ?? 5), blockSize = 40, density = 65;
const lanes = new Map(), half = (radius + 0.5) * blockSize;
for (const axis of [0, 1]) for (let line = -radius; line <= radius; line++) for (const direction of [-1, 1]) {
  const random = seededRandom(line * 7 + axis, direction * 991), cars = [];
  const spacing = TRAFFIC_SPACING * 100 / density;
  const count = Math.floor((radius * 2 + 1) * blockSize / spacing);
  for (const track of [0, 1]) for (let i = 0; i < count; i++) {
    const taxi = random() < 0.06, cruise = taxi ? 13 + random() * 2 : 3.4 + random() * 4.2;
    const acceleration = taxi ? 24 + random() * 5 : 2.2 + random() * 4;
    const position = -radius * blockSize + i * spacing + track * spacing / 2 + random() * 1.5;
    random();
    cars.push({ axis, line, direction, taxi, position, track, fromTrack: track, offset: TRACKS[track],
      cruise: cruise * (taxi ? 1.4 : 1.35), speed: cruise, acceleration: acceleration * (taxi ? 1.4 : 1.35),
      changing: false, merge: 1, cooldown: random(), steer: 0 });
  }
  lanes.set(`${axis}:${line}:${direction}`, { axis, line, direction, cars });
}
function step(frame) {
  for (const lane of lanes.values()) for (const car of lane.cars) {
    if (car.position < -half) { car.position += half * 2; resetSignal(car); }
    if (car.position > half) { car.position -= half * 2; resetSignal(car); }
  }
  updateNetwork(lanes, 1 / 60, frame / 60, { blockSize, weaving: 2 });
}
for (let i = 0; i < 120; i++) step(i);
const samples = [];
for (let i = 120; i < 1320; i++) {
  const start = performance.now(); step(i); samples.push(performance.now() - start);
}
const sorted = [...samples].sort((a, b) => a - b);
console.log(JSON.stringify({ radius, blocks: (radius * 2 + 1) ** 2,
  cars: [...lanes.values()].reduce((sum, lane) => sum + lane.cars.length, 0), frames: samples.length,
  meanMs: samples.reduce((sum, v) => sum + v, 0) / samples.length,
  p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) }));

// A separate pass avoids mixing profiler overhead into the timings above.
if (process.argv.includes('--profile')) {
  const session = new Session(); session.connect();
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  await post('Profiler.enable'); await post('Profiler.start');
  for (let i = 1320; i < 2520; i++) step(i);
  const { profile } = await post('Profiler.stop'); session.disconnect();
  const nodes = new Map(profile.nodes.map(node => [node.id, node])), totals = new Map();
  profile.samples.forEach((id, index) => {
    const frame = nodes.get(id).callFrame;
    const key = `${frame.functionName || '(anonymous)'} — ${frame.url.split('/').at(-1)}:${frame.lineNumber + 1}`;
    totals.set(key, (totals.get(key) ?? 0) + profile.timeDeltas[index]);
  });
  const total = [...totals.values()].reduce((sum, n) => sum + n, 0);
  console.log(JSON.stringify({ selfTimeProfile: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([name, value]) => ({ name, percent: +(value * 100 / total).toFixed(1) })) }, null, 2));
}
