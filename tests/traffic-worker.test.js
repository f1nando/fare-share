import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { once } from 'node:events';
import { TrafficSimulation } from '../src/city/trafficSimulation.js';
import { TrafficBuffer } from '../src/city/trafficBuffer.js';
import { TrafficWorkerClient } from '../src/city/TrafficWorkerClient.js';
import { CAR_STRIDE, readPose, readAppearance } from '../src/city/trafficFrames.js';
import { presentation } from '../src/city/vehiclePresentation.js';
import { carCoordinates } from '../src/city/trafficNetwork.js';
import { addCar, addTrafficFrame } from '../src/city/createCity.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';

const config = () => ({ settings: { ...DEFAULT_SETTINGS, density: 20, taxiShare: 30, weaving: 200 },
  area: { x: 2, z: 2, extents: { x: 35, z: 35 } }, focus: { x: 20, z: 20 }, simulationHz: 30 });
const emptyFrame = time => ({ time, lightTime: time, focusX: time, focusZ: time, data: new Float64Array(), simulationMs: 1, packMs: 0.1 });

test('packed traffic preserves drawing, wheel motion, signals and car identity', () => {
  const simulation = new TrafficSimulation(config());
  const first = simulation.lanes.values().next().value.cars[0];
  Object.assign(first, { taxi: true, steer: 0.12, pitch: 0.05, roll: 0.07, roadPitch: 0.1, roadRoll: 0.2,
    hornAge: 0.1, signalIndex: 2, rideHeight: 0.4, wheelHeights: [0.2, 0.1, 0.3, 0], surfaceSupport: 0.2 });
  const frame = simulation.snapshot(), pose = readPose(frame.data, 0);
  assert.deepEqual(pose, presentation(first, carCoordinates(first, 40)));
  const appearance = readAppearance(frame.data, 0);
  assert.equal(appearance.hornAge, 0.1); assert.equal(appearance.signalIndex, 2);
  const buffer = new TrafficBuffer(); buffer.push(frame);
  const original = [], packed = [], camera = { right: 10000, top: 10000 }, focus = { x: 0, z: 0 };
  for (const lane of simulation.lanes.values()) for (const car of lane.cars) addCar({ add: (...args) => original.push(args) }, car, 0, 0, focus, camera, 40);
  addTrafficFrame({ add: (...args) => packed.push(args) }, buffer.advance(0, false), 0, 0, focus, camera, undefined, 40);
  const normalize = items => items.map(args => args.map((value, index) => index === 7 && typeof value === 'string' ? parseInt(value.slice(1), 16) : value));
  assert.deepEqual(normalize(packed), normalize(original));
  simulation.configure({ ...config(), settings: { ...config().settings, trafficSpeed: 150, blockSize: 48, density: 100 } });
  assert.equal(simulation.settings.blockSize, 40); assert.equal(simulation.settings.density, 20);
  assert.equal(simulation.settings.trafficSpeed, 150);
  assert.equal(simulation.snapshot().data[0], frame.data[0]);
});

test('simulation is deterministic through camera rebasing and moving cars', () => {
  const options = config(); options.focus.x = 59.9;
  const a = new TrafficSimulation(options), b = new TrafficSimulation(options);
  const car = [...a.lanes.values()].find(lane => lane.line === 1).cars[0];
  const initial = a.snapshot(); const id = a.identities.ids.get(car);
  let frame;
  for (let i = 0; i < 45; i++) { frame = a.advance(); assert.deepEqual(frame.data, b.advance().data); }
  assert.equal(a.worldX, 2); assert.ok(frame.time > initial.time);
  assert.equal(a.identities.ids.get(car), id);
  assert.equal(frame.data.length, frame.cars * CAR_STRIDE);
  assert.ok([...frame.data].every(Number.isFinite));
});

test('buffer preloads, stays bounded, pauses exactly, and recovers without extrapolation', () => {
  const buffer = new TrafficBuffer();
  for (let i = 0; i <= 2; i++) buffer.push(emptyFrame(i / 30));
  assert.equal(buffer.advance(1 / 60, true).focusX, 0);
  for (let i = 3; i < buffer.capacity; i++) buffer.push(emptyFrame(i / 30));
  assert.equal(buffer.push(emptyFrame(7 / 30)), false);
  buffer.advance(1 / 60, true);
  const paused = buffer.time;
  for (let i = 0; i < 20; i++) buffer.advance(1 / 60, false);
  assert.equal(buffer.time, paused);
  for (let i = 0; i < 90; i++) {
    const result = buffer.advance(1 / 60, true);
    assert.ok(result.focusX <= result.upper.time + 1e-10);
    assert.ok(buffer.frames.length <= buffer.capacity);
  }
  assert.equal(buffer.underruns, 1);
  const stalled = buffer.time;
  for (let i = 7; i <= 11; i++) buffer.push(emptyFrame(i / 30));
  for (let i = 0; i < 10; i++) buffer.advance(1 / 60, true);
  assert.ok(buffer.time > stalled); assert.ok(buffer.rate <= 1.08);
  assert.equal(buffer.push(emptyFrame(1 / 30)), false);
});

test('client ignores old epochs, requests a bounded batch and terminates on failure', () => {
  const messages = [], fake = { postMessage: message => messages.push(message), terminate() { this.terminated = true; } };
  let failure;
  const client = new TrafficWorkerClient(config(), message => { failure = message; }, () => fake);
  const receive = message => fake.onmessage({ data: { epoch: client.epoch, ...message } });
  receive({ type: 'frame', frame: emptyFrame(0) }); receive({ type: 'done' });
  assert.equal(messages.at(-1).count, 6);
  for (let i = 1; i <= 6; i++) receive({ type: 'frame', frame: emptyFrame(i / 30) });
  receive({ type: 'done' });
  assert.equal(messages.filter(m => m.type === 'produce').length, 1);
  client.restart(config());
  receive({ epoch: client.epoch - 1, type: 'frame', frame: emptyFrame(1) });
  assert.equal(client.buffer.frames.length, 0);
  receive({ type: 'error', message: 'test failure' });
  assert.equal(failure, 'test failure'); assert.equal(fake.terminated, true);
  receive({ type: 'frame', frame: emptyFrame(0) }); assert.equal(client.buffer.frames.length, 0);
});

test('a long visible frame creates bounded recovery debt; pause never adds debt', () => {
  const buffer = new TrafficBuffer();
  for (let i = 0; i < buffer.capacity; i++) buffer.push(emptyFrame(i / 30));
  buffer.advance(0.4, true);
  assert.equal(buffer.desiredTime, 0.4);
  assert.ok(buffer.time <= 0.06 * 1.08);
  const time = buffer.time, debt = buffer.desiredTime;
  buffer.advance(60, false);
  assert.equal(buffer.time, time); assert.equal(buffer.desiredTime, debt);
  buffer.advance(20, true);
  assert.ok(buffer.desiredTime <= time + 0.5 + 1e-10);
});

test('actual worker protocol transfers identical states and resets pending production', { timeout: 10000 }, async () => {
  const moduleUrl = new URL('../src/city/traffic.worker.js', import.meta.url).href;
  const worker = new NodeWorker(`const { parentPort } = require('node:worker_threads');
    global.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
    import(${JSON.stringify(moduleUrl)}).then(() => { parentPort.on('message', data => self.onmessage({ data })); parentPort.postMessage({ type: 'ready' }); });`, { eval: true });
  try {
    await once(worker, 'message');
    const collect = action => new Promise((resolve, reject) => {
      const frames = [];
      const listener = message => {
        if (message.type === 'frame') frames.push(message.frame);
        if (message.type === 'error' || message.type === 'done') {
          worker.off('message', listener);
          message.type === 'error' ? reject(new Error(message.message)) : resolve(frames);
        }
      };
      worker.on('message', listener); action();
    });
    const simulation = new TrafficSimulation(config());
    const initial = await collect(() => worker.postMessage({ type: 'init', epoch: 1, config: config() }));
    assert.deepEqual(initial[0].data, simulation.snapshot().data);
    const frames = await collect(() => worker.postMessage({ type: 'produce', epoch: 1, count: 4 }));
    assert.equal(frames.length, 4);
    for (const frame of frames) assert.deepEqual(frame.data, simulation.advance().data);
    const reset = await collect(() => worker.postMessage({ type: 'init', epoch: 2, config: config() }));
    assert.equal(reset[0].time, 0); assert.deepEqual(reset[0].data, initial[0].data);
  } finally { await worker.terminate(); }
});
