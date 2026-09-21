import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointerCamera } from '../src/city/pointerCamera.js';
import { activeWorldSize } from '../src/city/activeWorld.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';

function setup(t, fine = true, reducedMotion = false) {
  const events = () => ({
    listeners: new Map(),
    addEventListener(name, fn) { this.listeners.set(name, fn); },
    removeEventListener(name) { this.listeners.delete(name); },
    emit(name, value = {}) { this.listeners.get(name)?.(value); },
  });
  const pointer = Object.assign(events(), { matches: fine });
  const reduced = Object.assign(events(), { matches: reducedMotion });
  const host = Object.assign(events(), { matchMedia: query => query.includes('pointer') ? pointer : reduced });
  const original = globalThis.window;
  globalThis.window = host;
  let availabilityChanges = 0;
  const camera = createPointerCamera({ getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600 }) },
    () => availabilityChanges++);
  t.after(() => { camera.dispose(); if (original === undefined) delete globalThis.window; else globalThis.window = original; });
  return { camera, host, pointer, reduced, changes: () => availabilityChanges,
    move: (x, y, pointerType = 'mouse') => host.emit('pointermove', { clientX: x, clientY: y, pointerType }) };
}

test('mouse camera smoothly approaches at most half a block, even at corners', t => {
  const { camera, move } = setup(t);
  move(1000, 600);
  const first = { ...camera.update(1 / 60, 40) };
  assert.ok(Math.hypot(first.x, first.z) > 0 && Math.hypot(first.x, first.z) < 2);
  for (let i = 0; i < 180; i++) camera.update(1 / 60, 40);
  const end = camera.update(0, 40);
  assert.ok(Math.hypot(end.x, end.z) <= 20 && Math.hypot(end.x, end.z) > 19.99);
  assert.ok(Math.abs(Math.hypot(...Object.values(camera.update(0, 24))) - 12) < 0.001);
  const frozen = { ...end };
  move(0, 0);
  assert.deepEqual(camera.update(1, 24, false), frozen);
});

test('leaving the window recenters smoothly, touch does not move the camera', t => {
  const { camera, host, move } = setup(t);
  move(1000, 300, 'touch');
  assert.deepEqual(camera.update(1, 40), { x: 0, z: 0 });
  move(1000, 300); camera.update(1, 40);
  host.emit('pointerout', { relatedTarget: null });
  const midway = { ...camera.update(0.1, 40) };
  assert.ok(Math.hypot(midway.x, midway.z) > 1);
  assert.ok(Math.hypot(...Object.values(camera.update(3, 40))) < 0.001);
});

test('phones have no pointer listeners; reduced motion disables and cleans up input', t => {
  const { camera, host, pointer, reduced, changes } = setup(t, false);
  assert.equal(camera.active, false);
  assert.equal(host.listeners.size, 0);
  pointer.matches = true; pointer.emit('change');
  assert.equal(camera.active, true);
  assert.ok(host.listeners.has('pointermove'));
  reduced.matches = true; reduced.emit('change');
  assert.equal(camera.active, false);
  assert.equal(host.listeners.size, 0);
  assert.equal(changes(), 2);
  camera.dispose();
  assert.equal(pointer.listeners.size + reduced.listeners.size, 0);
});

test('desktop world margin covers pointer displacement without changing phone bounds', () => {
  const phone = activeWorldSize(50, 110, DEFAULT_SETTINGS);
  const desktop = activeWorldSize(50, 110, DEFAULT_SETTINGS, 20);
  for (const axis of ['x', 'z']) {
    assert.equal(desktop.extents[axis], phone.extents[axis] + 20);
    assert.ok(desktop[axis] * 40 >= desktop.extents[axis] + desktop.buffer + 20);
  }
});
