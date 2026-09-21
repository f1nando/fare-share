import test from 'node:test';
import assert from 'node:assert/strict';
import { populateBlock } from '../src/city/createCity.js';
import { canalColumn } from '../src/city/canal.js';
import { populateRoadworks } from '../src/city/roadworkGeometry.js';
import { CAR_GAP, PAVED_ROAD, STOP_LINE, TRACKS, SHOULDER_TRACK, trackOffset, occupiesTrack, updateTraffic, canMerge, resetSignal } from '../src/city/world.js';
import { intersectionAccess } from '../src/city/intersections.js';

const car = (position, track, taxi = false, direction = 1) => ({
  position: position * direction, track, fromTrack: track, offset: trackOffset(track), taxi,
  axis: 0, line: 0, direction, speed: 0, cruise: taxi ? 16 : 6,
  acceleration: taxi ? 25 : 4, cooldown: 0, merge: 1, changing: false, flashCooldown: Infinity,
});

test('taxi overtakes three stopped cars on the shoulder, crosses on red, and returns at every aggression setting', () => {
  for (const direction of [-1, 1]) for (const weaving of [0, 0.1, 2]) {
    const taxi = car(-STOP_LINE - CAR_GAP * 3, 1, true, direction);
    const cars = [taxi, ...[0, 1, 2].map(i => car(-STOP_LINE - CAR_GAP * i, 1, false, direction))];
    const lanes = new Map([[`0:0:${direction}`, { cars }]]);
    let usedShoulder = false, returned = false;
    for (let frame = 0; frame < 250; frame++) {
      updateTraffic(cars, direction, 0.02, false, { weaving, opposing: [], blockSize: 40,
        crossingAccess: intersectionAccess(lanes, 40, 12) });
      usedShoulder ||= taxi.offset > TRACKS[1] + 0.8;
      returned ||= usedShoulder && taxi.track === 1 && !taxi.changing && taxi.position * direction > STOP_LINE;
      for (const other of cars) if (other !== taxi && occupiesTrack(taxi, 1) && occupiesTrack(other, 1)) {
        assert.ok(Math.abs(taxi.position - other.position) >= CAR_GAP - 1e-7);
      }
      assert.ok(Number.isFinite(taxi.offset) && taxi.offset <= trackOffset(SHOULDER_TRACK));
    }
    assert.ok(usedShoulder && returned);
  }
});

test('occupied shoulder is rejected and recycling restores the outer home lane', () => {
  const taxi = car(-20, 1, true), blocker = car(-20, SHOULDER_TRACK, true);
  assert.equal(canMerge(taxi, [taxi, blocker], SHOULDER_TRACK, 1), false);
  taxi.track = SHOULDER_TRACK;
  taxi.overtake = { returnTrack: 1 };
  resetSignal(taxi);
  assert.equal(taxi.track, 1);
  assert.equal(taxi.offset, TRACKS[1]);
  assert.equal(taxi.overtake, null);
});

test('buildings, trunks and landscaping leave the sidewalk riding strip clear at every block size', () => {
  for (const size of [24, 40, 48]) for (let seed = 0; seed < 30; seed++) {
    if (canalColumn(seed)) continue; // Bridge/bank clearances are covered in canal.test.js.
    const workParts = new Set();
    populateRoadworks({ add: (...p) => workParts.add(JSON.stringify(p.slice(0,7))) }, seed, -seed, 0, 0, size);
    populateBlock({ add(kind, x, y, z, w, h, d) {
      if (workParts.has(JSON.stringify([kind,x,y,z,w,h,d]))) return; // Roadwork clearances have their own test.
      if (['paint', 'crown', 'island', 'roundaboutCurb', 'roundaboutWalk'].includes(kind)) return;
      assert.ok(w > 0 && d > 0);
      // Centre islands are also clear of the shoulder; they need not lie in a lot.
      if ((Math.abs(z) + d / 2 < 0.2 && x - w / 2 > 7) ||
          (Math.abs(x) + w / 2 < 0.2 && z - d / 2 > 7)) return;
      const left = Math.min(x - w / 2, z - d / 2);
      const right = Math.max(x + w / 2, z + d / 2);
      const boundary = y >= 0.4 ? trackOffset(SHOULDER_TRACK) + 0.52 : PAVED_ROAD / 2;
      assert.ok(left >= boundary - 1e-6 && right <= size - boundary + 1e-6,
        `${kind} intrudes into the shoulder at block size ${size}`);
    } }, seed, -seed, 0, 0, size);
  }
});
