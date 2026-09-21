import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HornEffects } from '../src/city/hornEffects.js';

test('horn textures and pooled materials are prepared before the first signal, then reused', () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ strokeText() {}, fillText() {} }) }) };
  try {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), effects = new HornEffects(scene);
    const textures = [];
    effects.prepare({ initTexture: t => textures.push(t), compile(s) {
      assert.equal(s, scene);
      assert.ok(effects.labels.every(label => label.visible && label.material.map));
    } }, camera);
    assert.equal(textures.length, 2);
    assert.ok(scene.children.every(item => !item.visible));
    const objects = [...scene.children];
    effects.add({ hornAge: 0.3, signalIndex: 1 }, 0, 0, camera);
    assert.ok(scene.children.some(item => item.visible));
    assert.deepEqual(scene.children, objects);
    effects.reset(); assert.ok(scene.children.every(item => !item.visible));
    effects.dispose(); assert.equal(scene.children.length, 0);
  } finally { globalThis.document = previous; }
});
