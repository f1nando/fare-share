import test from 'node:test';
import assert from 'node:assert/strict';
import { roadBumpAt, crossedRoadBump, populateRoadBumps, RoadBumpTracker } from '../src/city/roadBumps.js';
import { roadworkAt, roadOpen } from '../src/city/roadLayout.js';
import { tramRoad } from '../src/city/roadProfile.js';
import { canalColumn } from '../src/city/bridgeProfile.js';

function sample(axis, kind) {
  for (let line = -10; line <= 10; line++) for (let segment = -10; segment <= 10; segment++) {
    const bump = roadBumpAt(axis, line, segment, 40);
    if (bump?.kind === kind) return bump;
  }
  throw Error('Missing road bump fixture');
}
const move = (bump, along, across = 0) => ({
  x: bump.x + (bump.axis === 0 ? along : across),
  z: bump.z + (bump.axis === 0 ? across : along),
});

test('sparse road details are deterministic and avoid closures, water and tram tracks', () => {
  let count = 0;
  const kinds = new Set();
  for (const axis of [0, 1]) for (let line = -20; line <= 20; line++) for (let segment = -20; segment <= 20; segment++) {
    const bump = roadBumpAt(axis, line, segment, 40);
    if (!bump) continue;
    count++; kinds.add(bump.kind);
    assert.deepEqual(bump, roadBumpAt(axis, line, segment, 40));
    assert.ok(roadOpen(axis, line, segment));
    assert.equal(roadworkAt(axis, line, segment, 40), null);
    assert.ok(axis === 0 ? !canalColumn(segment) : !canalColumn(line) && !canalColumn(line - 1));
    assert.ok(!tramRoad(axis, line) || bump.track !== 0);
  }
  assert.ok(count > 100 && count < 500);
  assert.deepEqual(kinds, new Set(['pothole', 'manhole']));
});

test('swept contact catches fast crossings on both axes and ignores neighbouring lanes', () => {
  for (const axis of [0, 1]) for (const kind of ['pothole', 'manhole']) for (const direction of [-1, 1]) {
    const bump = sample(axis, kind);
    assert.equal(crossedRoadBump(move(bump, -3 * direction), move(bump, 3 * direction), 40)?.key, bump.key);
    assert.equal(crossedRoadBump(move(bump, -3 * direction, 1.63), move(bump, 3 * direction, 1.63), 40), null);
    assert.equal(crossedRoadBump(move(bump, -20), move(bump, 20), 40), null, 'recycling is not a road contact');
  }
});

test('a stopped vehicle triggers once per entry, can re-enter, and uses absolute rebased positions', () => {
  const bump = sample(0, 'pothole'), tracker = new RoadBumpTracker();
  let hits = 0;
  const car = { ...move(bump, -2), type: 'taxi', key: 'worker:1' };
  const tick = (originX = 0, originZ = 0) => tracker.update([car], originX, originZ, 40, () => hits++);
  tick();
  Object.assign(car, move(bump, 0)); tick();
  for (let i = 0; i < 60; i++) tick();
  assert.equal(hits, 1);
  car.x -= 40; car.z += 40; tick(40, -40);
  assert.equal(hits, 1, 'camera origin shift cannot trigger a jump');
  Object.assign(car, move(bump, 2)); tick();
  Object.assign(car, move(bump, 0)); tick();
  assert.equal(hits, 2);
  tracker.update([], 0, 0, 40, () => hits++);
  assert.equal(tracker.previous.size, 0, 'offscreen identities are released');
  tick();
  assert.equal(hits, 2, 'appearing on top of a hole is not an entry');
});

test('water and air traffic are ignored; changing block size resets contact history', () => {
  const bump = sample(0, 'manhole'), tracker = new RoadBumpTracker();
  let hits = 0;
  for (const type of ['boat', 'helicopter']) {
    const car = { ...move(bump, -2), type, key: type };
    tracker.update([car], 0, 0, 40, () => hits++);
    Object.assign(car, move(bump, 2));
    tracker.update([car], 0, 0, 40, () => hits++);
  }
  assert.equal(hits, 0);
  assert.equal(tracker.previous.size, 0);
  tracker.update([{ ...move(bump, -2), type: 'car', key: 1 }], 0, 0, 24, () => hits++);
  tracker.update([{ ...move(bump, 2), type: 'car', key: 1 }], 0, 0, 40, () => hits++);
  assert.equal(hits, 0);
});

test('drawn bump centres match collision coordinates after scenery rebasing', () => {
  for (const axis of [0, 1]) for (const kind of ['pothole', 'manhole']) {
    const bump = sample(axis, kind), gx = axis === 0 ? bump.segment : bump.line, gz = axis === 0 ? bump.line : bump.segment;
    const parts = [];
    populateRoadBumps({ add: (...p) => parts.push(p) }, gx, gz, 0, 0, 40);
    assert.ok(parts.some(p => p[0] === 'island' && Math.abs(p[1] + gx * 40 - bump.x) < 1e-8 &&
      Math.abs(p[3] + gz * 40 - bump.z) < 1e-8));
    assert.ok(parts.every(p => p.slice(1, 7).every(Number.isFinite)));
  }
});
