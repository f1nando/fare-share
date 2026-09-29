import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnRoadOpen, relocateToRoad } from '../src/city/roadLayout.js';
import { junctionStop } from '../src/city/roadProfile.js';
import { extraHalfLength } from '../src/city/vehicleTypes.js';
import { STOP_LINE } from '../src/city/world.js';
import { TrafficSimulation } from '../src/city/trafficSimulation.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';
import { carCoordinates } from '../src/city/trafficNetwork.js';

test('bridge-to-park spawns leave room for the actual junction stop and vehicle length', () => {
  for (const block of [24, 40, 64]) for (const direction of [-1, 1]) for (const kind of ['car', 'bus', 'truck']) {
    const cross = direction === 1 ? 1 : 2;
    const stop = junctionStop(cross, -6) + extraHalfLength({ kind });
    const car = { axis: 0, line: -6, direction, kind, track: 0,
      position: cross * block - direction * (stop - 0.1) };
    assert.equal(spawnRoadOpen(car, block, STOP_LINE), false, 'cannot appear past the mandatory turning stop');
    relocateToRoad(car, block, STOP_LINE);
    assert.ok(spawnRoadOpen(car, block, STOP_LINE), 'recycling skips the entire closed park segment');
    car.position = cross * block - direction * (stop + 1.1);
    assert.ok(spawnRoadOpen(car, block, STOP_LINE), 'upstream road remains available');
  }
});

test('traffic leaving a wide bridge never drives straight through the park side', () => {
  const simulation = new TrafficSimulation({ settings: { ...DEFAULT_SETTINGS, blockSize: 40,
    density: 80, taxiShare: 35, weaving: 200, cameraSpeed: 0 },
    area: { x: 3, z: 3, extents: { x: 60, z: 60 } }, focus: { x: 20, z: -240 }, seed: 42 });
  for (let step = 0; step < 180; step++) {
    simulation.advance();
    for (const lane of simulation.lanes.values()) for (const car of lane.cars) {
      const { x, z } = carCoordinates(car, 40);
      assert.ok(!(x > 46 && x < 74 && z > -274 && z < -206), 'car entered the park opposite the bridge');
    }
  }
});
