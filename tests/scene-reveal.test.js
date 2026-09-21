import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SceneReveal, REVEAL, REVEAL_STEP } from '../src/city/sceneReveal.js';
import { sceneryStage } from '../src/city/revealStages.js';
import { Batches } from '../src/city/Batches.js';
import { SceneryCache } from '../src/city/sceneryCache.js';
import { populateBlock } from '../src/city/createCity.js';
import { createBackgroundFade } from '../src/city/colorSchemes.js';
import { TrafficWorkerClient } from '../src/city/TrafficWorkerClient.js';
import { DEFAULT_SETTINGS } from '../src/city/settings.js';

test('all six stages fade fractionally in strict order, pause and finish once', () => {
  const reveal = new SceneReveal();
  for (let stage = 0; stage < 6; stage++) {
    reveal.advance(REVEAL_STEP / 2);
    assert.ok(Math.abs(reveal.opacity.value[stage] - 0.5) < 1e-5);
    assert.ok([...reveal.opacity.value.slice(0, stage)].every(value => value === 1));
    assert.ok([...reveal.opacity.value.slice(stage + 1)].every(value => value === 0));
    const before = [...reveal.opacity.value];
    reveal.advance(10, { paused: true });
    assert.deepEqual([...reveal.opacity.value], before);
    reveal.advance(REVEAL_STEP / 2);
  }
  reveal.advance(1e-9);
  assert.equal(reveal.done, true);
  reveal.advance(10);
  assert.deepEqual([...reveal.opacity.value], [1, 1, 1, 1, 1, 1]);
});

test('absent water skips the first slot; initial pause and reduced motion reveal immediately', () => {
  const reveal = new SceneReveal(); reveal.waterPresent = false;
  reveal.advance(REVEAL_STEP / 2);
  assert.equal(reveal.opacity.value[REVEAL.roads], 0.5);
  for (const options of [{ paused: true }, { reducedMotion: true }]) {
    const immediate = new SceneReveal(options);
    assert.equal(immediate.done, true);
    assert.ok([...immediate.opacity.value].every(value => value === 1));
    const material = new THREE.MeshStandardMaterial();
    immediate.apply(material); assert.equal(material.alphaHash, false);
  }
  reveal.advance(0, { paused: true, reducedMotion: true });
  assert.equal(reveal.done, true);
});

const kinds = ['box', 'round', 'paint', 'paving', 'building', 'crown', 'cone', 'island',
  'roundaboutCurb', 'roundaboutWalk', 'roundaboutCapCurb', 'roundaboutCapWalk', 'diagonalLot'];
test('cached stages survive clipping, rebase, capacity growth and restore original geometry/batching', () => {
  const reveal = new SceneReveal(), geometry = new THREE.BoxGeometry();
  const geometries = Object.fromEntries(kinds.map(kind => [kind, geometry]));
  const cache = new SceneryCache(populateBlock), scene = new THREE.Scene();
  const batch = new Batches(scene, geometries, false, reveal);
  const seen = new Set();
  for (const [worldX, worldZ] of [[0, 0], [1, 1], [-3, -2]]) {
    batch.reset(); cache.configure(worldX, worldZ, { x: 3, z: 3 }, 40);
    for (let x = worldX - 3; x <= worldX + 3; x++) for (let z = worldZ - 3; z <= worldZ + 3; z++) {
      cache.draw(batch, x, z, worldX, worldZ);
      for (const { kind, values } of cache.get(x, z).records) {
        const stage = values[10] ?? sceneryStage(kind, values[1]); seen.add(stage);
        if (kind === 'building') assert.equal(stage, REVEAL.buildings);
        if (kind === 'crown') assert.equal(stage, REVEAL.trees);
        if (kind === 'box' && values[6] === '#777777' && values[4] > 1)
          assert.equal(stage, REVEAL.trees, 'all trunks, including clipped avenues and diagonal lots');
        if (kind === 'paving' && values[1] < -2) assert.equal(stage, REVEAL.water);
      }
    }
    batch.flush();
    for (const [kind, mesh] of batch.meshes) {
      assert.equal(mesh.geometry.attributes.position, geometry.attributes.position);
      assert.ok(mesh.customDepthMaterial.alphaHash);
      const stages = mesh.geometry.attributes.sceneRevealStage;
      assert.deepEqual([...stages.array.slice(0, mesh.count)], batch.items.get(kind).values.slice(0, mesh.count).map(item => item[11]));
    }
    assert.equal(reveal.elapsed, 0, 'rebuild never advances or resets the timeline');
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4]);
  const count = scene.children.length;
  assert.ok(count <= kinds.length, 'no extra batches per stage');
  assert.equal(reveal.depthMaterials.size, 1, 'one shadow material for all static stages');
  reveal.finish();
  for (const mesh of batch.meshes.values()) {
    assert.equal(mesh.geometry, geometry); assert.equal(mesh.customDepthMaterial, undefined);
  }
  cache.configure(8, 5, { x: 1, z: 1 }, 48); batch.reset(); cache.draw(batch, 8, 5, 8, 5); batch.flush();
  assert.equal(reveal.done, true);
  assert.equal(scene.children.length, count);
  for (const mesh of batch.meshes.values()) assert.equal(mesh.geometry.attributes.sceneRevealStage, undefined);
  batch.dispose(); cache.dispose(); geometry.dispose();
});

test('opacity composes with the palette shader, preserves taxi/beam state and fades shadows', () => {
  const reveal = new SceneReveal();
  const batch = new Batches(new THREE.Scene(), { car: new THREE.BoxGeometry() }, true, reveal);
  createBackgroundFade('pale').apply(batch.material);
  const paletteHook = batch.material.onBeforeCompile;
  const materials = [batch.material, batch.taxiMaterial, batch.taxiDetailMaterial, batch.lightMaterial, batch.beamMaterial];
  for (const material of materials) {
    const opacity = material.opacity, transparent = material.transparent, depthWrite = material.depthWrite;
    reveal.apply(material, REVEAL.cars);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.sceneRevealOpacity, reveal.opacity);
    assert.ok(shader.fragmentShader.includes('diffuseColor.a *= sceneRevealOpacity[5]'));
    assert.equal(Boolean(shader.uniforms.backgroundFade), material === batch.material);
    assert.equal(material.opacity, opacity); assert.equal(material.transparent, transparent); assert.equal(material.depthWrite, depthWrite);
  }
  batch.add('car', 0, 0, 0, 1, 1, 1, '#ffffff'); batch.flush();
  const mesh = batch.meshes.get('car');
  assert.equal(mesh.geometry, batch.geometries.car, 'dynamic cars need no extra attribute or geometry');
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  mesh.customDepthMaterial.onBeforeCompile(shader);
  assert.equal(shader.uniforms.sceneRevealOpacity, reveal.opacity);
  assert.ok(shader.fragmentShader.includes('diffuseColor.a *= sceneRevealOpacity[5]'));
  reveal.finish();
  assert.equal(batch.material.onBeforeCompile, paletteHook);
  for (const material of materials) assert.equal(material.alphaHash, false);
  assert.equal(batch.taxiMaterial.toneMapped, false); assert.equal(batch.beamMaterial.opacity, 0.48);
  batch.dispose(); batch.geometries.car.dispose();
});

test('Worker initializes and fills its one-second reserve while the first stage is still hidden', () => {
  const reveal = new SceneReveal(), messages = [];
  const fake = { postMessage: message => messages.push(message), terminate() {} };
  const client = new TrafficWorkerClient({ settings: DEFAULT_SETTINGS, simulationHz: 30 }, assert.fail, () => fake);
  try {
    assert.equal(messages[0].type, 'init');
    const receive = message => client.receive({ epoch: client.epoch, ...message });
    let next = 0;
    while (next < client.buffer.capacity) {
      const count = next ? messages.at(-1).count : 1;
      for (let i = 0; i < count; i++) receive({ type: 'frame', frame: {
        time: next++ / 30, data: new Float64Array(), focusX: 0, focusZ: 0, simulationMs: 0, packMs: 0,
      } });
      receive({ type: 'done' });
    }
    assert.equal(client.buffer.frames.length, client.buffer.capacity);
    assert.ok(client.buffer.reserveMs >= 1000);
    assert.equal(reveal.done, false);
    assert.ok([...reveal.opacity.value].every(value => value === 0));
  } finally { client.dispose(); }
});
