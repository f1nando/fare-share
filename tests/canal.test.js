import test from 'node:test';
import assert from 'node:assert/strict';
import { canalColumn, canalDimensions, CANAL_BRIDGE_HALF, populateCanal } from '../src/city/canal.js';
import { parkAt, roadOpen } from '../src/city/roadLayout.js';
import { PAVED_ROAD, TRACKS, trackOffset, vehiclePose, MAX_MERGE_ANGLE } from '../src/city/world.js';
import { carCoordinates } from '../src/city/trafficNetwork.js';
import { populateBlock } from '../src/city/createCity.js';

test('canal columns have uninterrupted bank roads and bridges, never overlapping a merged park', () => {
  for (let x = -36; x <= 36; x++) {
    assert.equal(canalColumn(x), canalColumn(x + 12));
    if (!canalColumn(x)) continue;
    for (let z = -30; z <= 30; z++) {
      assert.equal(parkAt(x, z), null);
      assert.ok(roadOpen(0, z, x));
      assert.ok(roadOpen(1, x, z));
      assert.ok(roadOpen(1, x + 1, z));
    }
  }
});

test('water meets tile boundaries, decks cover it at crossings, and banks fit every block size', () => {
  for (let block = 24; block <= 48; block += 2) {
    const parts = []; populateCanal({ add: (...p) => parts.push(p) }, 0, 0, block);
    const water = parts.find(p => p[2] === 0.001), deck = parts.find(p => p[2] === 0.004);
    const { left, right } = canalDimensions(block);
    assert.equal(water[3] - water[6] / 2, 0);
    assert.equal(water[3] + water[6] / 2, block);
    assert.ok(deck[1] - deck[4] / 2 < left && deck[1] + deck[4] / 2 > right);
    assert.equal(deck[6], CANAL_BRIDGE_HALF * 2);
    assert.ok(deck[2] + deck[5] / 2 < 0.007, 'deck stays below crossing road markings');
    for (const p of parts) assert.ok(p[4] > 0 && p[5] > 0 && p[6] > 0);
    const blocks = []; populateBlock({ add: (...p) => blocks.push(p) }, 0, 0, 0, 0, block);
    assert.ok(!blocks.some(p => p[0] === 'building'));
  }
});

test('bridge parapets, bank walls and trunks leave normal and borrowed tracks clear', () => {
  for (const block of [24, 40, 48]) {
    const parts = []; populateCanal({ add: (...p) => parts.push(p) }, 0, 0, block);
    const obstacles = parts.filter(p => p[0] === 'box' && p[2] > 0.3);
    for (const axis of [0, 1]) for (const direction of [-1, 1]) for (const track of [-1, 0, 1, 2]) {
      for (let along = 8; along <= block - 8; along += 0.5) {
        const car = { axis, line: 0, direction, position: along, offset: trackOffset(track) };
        const coordinates = carCoordinates(car, block);
        for (const steer of [-MAX_MERGE_ANGLE, 0, MAX_MERGE_ANGLE]) {
          const pose = vehiclePose(coordinates.x, coordinates.z, axis, direction, steer);
          for (const side of [-0.46, 0.46]) for (const end of [-1.125, 1.125]) {
            const x = pose.x + side * pose.cos + end * pose.sin, z = pose.z - side * pose.sin + end * pose.cos;
            for (const p of obstacles) assert.ok(!(Math.abs(x - p[1]) <= p[4] / 2 && Math.abs(z - p[3]) <= p[6] / 2));
          }
        }
      }
    }
    assert.ok(TRACKS[1] < PAVED_ROAD / 2);
  }
});
