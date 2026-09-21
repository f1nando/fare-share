import test from 'node:test';
import assert from 'node:assert/strict';
import { districtPark, parkAt, roadOpen, spawnRoadOpen, relocateToRoad, CAMERA_DRIFT } from '../src/city/roadLayout.js';
import { TrafficSimulation } from '../src/city/trafficSimulation.js';
import { updateNetwork, carCoordinates } from '../src/city/trafficNetwork.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';
import { STOP_LINE, trackOffset } from '../src/city/world.js';
import { populateBlock } from '../src/city/createCity.js';

const parks = [];
for (let x = -16; x <= 16; x += 4) for (let z = -16; z <= 16; z += 4) {
  const park = districtPark(x, z); if (park) parks.push(park);
}

test('isolated merged parks create T junctions in both axes, including negative districts', () => {
  assert.deepEqual(new Set(parks.map(p => p.axis)), new Set([0, 1]));
  assert.equal(new Set(parks.map(p => p.style)).size, 3);
  for (const park of parks) {
    assert.deepEqual(parkAt(park.x, park.z), park);
    assert.deepEqual(parkAt(park.x + (park.axis === 0 ? 1 : 0), park.z + (park.axis === 1 ? 1 : 0)), park);
    const axis = 1 - park.axis, line = (axis === 0 ? park.z : park.x) + 1, segment = axis === 0 ? park.x : park.z;
    assert.equal(roadOpen(axis, line, segment), false);
    for (const end of [segment, segment + 1]) {
      const x = axis === 0 ? end : line, z = axis === 0 ? line : end;
      assert.equal([roadOpen(0, z, x - 1), roadOpen(0, z, x), roadOpen(1, x, z - 1), roadOpen(1, x, z)].filter(Boolean).length, 3);
    }
  }
});

test('both constituent blocks share one park slab and have no internal road markings', () => {
  for (const axis of [0, 1]) for (const block of [24, 40, 48]) {
    const park = parks.find(p => p.axis === axis), parts = [];
    const batch = { add: (...args) => parts.push(args) };
    for (let i = 0; i < 2; i++) populateBlock(batch, park.x + (axis === 0 ? i : 0), park.z + (axis === 1 ? i : 0),
      axis === 0 ? i * block : 0, axis === 1 ? i * block : 0, block);
    const bases = parts.filter(p => p[0] === 'round' && p[2] === 0.1);
    assert.equal(bases.length, 1);
    assert.ok(bases[0][axis === 0 ? 4 : 6] > block);
    assert.equal(parts.filter(p => p[0] === 'paint' && (axis === 0 ? p[1] === block : p[3] === block)).length, 0);
  }
});

test('recycling skips a removed road without jumping two whole blocks towards the camera', () => {
  for (const park of parks) for (const direction of [-1, 1]) {
    const axis = 1 - park.axis, line = (axis === 0 ? park.z : park.x) + 1, segment = axis === 0 ? park.x : park.z;
    for (let offset = -STOP_LINE; offset <= 40 + STOP_LINE; offset += 0.5) {
      const car = { axis, line, direction, position: segment * 40 + offset }, before = car.position;
      relocateToRoad(car, 40, STOP_LINE);
      assert.ok(spawnRoadOpen(car, 40, STOP_LINE));
      assert.ok(Math.abs(car.position - before) < 40 + 2 * (STOP_LINE + 1) + 0.001);
    }
  }
});

test('ordinary cars and taxis turn into open streets at park and canal T approaches', () => {
  const approaches = [0, 1].map(axis => {
    const park = parks.find(p => p.axis === 1 - axis);
    return { axis, line: (axis === 0 ? park.z : park.x) + 1, segment: axis === 0 ? park.x : park.z };
  });
  approaches.push({ axis: 0, line: 1, segment: 0 }, { axis: 0, line: -3, segment: -12 });
  for (const { axis, line, segment } of approaches) for (const direction of [-1, 1]) for (const track of [-1, 0, 1, 2]) for (const taxi of [false, true]) {
    if (!taxi && (track < 0 || track > 1)) continue;
    const center = segment + (direction < 0 ? 1 : 0);
    const cx = axis === 0 ? center : line, cz = axis === 0 ? line : center;
    const lanes = new Map();
    for (const a of [0, 1]) for (let l = (a === 0 ? cz : cx) - 1; l <= (a === 0 ? cz : cx) + 1; l++) for (const d of [-1, 1])
      lanes.set(`${a}:${l}:${d}`, { axis: a, line: l, direction: d, cars: [] });
    const car = { axis, line, direction, position: center * 40 - direction * (STOP_LINE + 0.02),
      track, fromTrack: track, offset: trackOffset(track), taxi, speed: 8, cruise: 8, acceleration: 5, cooldown: 0, steer: 0, merge: 1 };
    lanes.get(`${axis}:${line}:${direction}`).cars.push(car);
    if (!taxi) {
      updateNetwork(lanes, 1 / 30, axis === 0 ? 12 : 1, { blockSize: 40, roadLayout: true });
      assert.ok(!car.turn, 'ordinary car waits for green');
    }
    for (let i = 0; i < 150 && !car.requiredTurnsCompleted; i++) updateNetwork(lanes, 1 / 30, axis === 0 ? 1 : 12, { blockSize: 40, roadLayout: true });
    assert.equal(car.requiredTurnsCompleted, 1, JSON.stringify({ axis, direction, track, taxi }));
    assert.equal(car.axis, 1 - axis);
    assert.ok(roadOpen(car.axis, car.line, Math.floor(car.position / 40)));
    assert.equal([...lanes.values()].flatMap(l => l.cars).length, 1);
  }
});

test('moving world keeps traffic out of park interiors and uses 50% faster camera drift', () => {
  const simulation = new TrafficSimulation({ settings: { ...DEFAULT_SETTINGS, density: 65, taxiShare: 15, weaving: 200 },
    area: { x: 3, z: 3, extents: { x: 60, z: 60 } }, focus: { x: 20, z: 20 }, simulationHz: 30 });
  for (const lane of simulation.lanes.values()) for (const car of lane.cars) assert.ok(spawnRoadOpen(car, 40, STOP_LINE));
  for (let step = 0; step < 900; step++) {
    simulation.advance();
    for (const lane of simulation.lanes.values()) for (const car of lane.cars) {
      const { x, z } = carCoordinates(car, 40);
      const park = parkAt(Math.floor(x / 40), Math.floor(z / 40));
      if (!park) continue;
      // Shoulder taxis may still straddle the perimeter pavement.
      const left = park.x * 40 + 6, right = (park.x + (park.axis === 0 ? 2 : 1)) * 40 - 6;
      const top = park.z * 40 + 6, bottom = (park.z + (park.axis === 1 ? 2 : 1)) * 40 - 6;
      assert.ok(!(x > left && x < right && z > top && z < bottom), `car entered park: ${JSON.stringify({ x, z, park, car: { axis: car.axis, line: car.line, position: car.position, turn: !!car.turn } })}`);
    }
  }
  assert.ok(Math.abs(simulation.focus.x - (20 + 30 * 0.92 * 1.5 * 2)) < 1e-8);
  assert.ok(Math.abs(simulation.focus.z - (20 + 30 * 0.36 * 1.5 * 2)) < 1e-8);
  assert.equal(CAMERA_DRIFT.x / 0.92, 1.5);
});
