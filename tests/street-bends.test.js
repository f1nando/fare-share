import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene, ShaderLib } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { streetOffset, streetSlope, streetMargin, sectionGeometry, StreetBends, curvedSceneryBatch } from '../src/city/streetBends.js';
import { createBackgroundFade } from '../src/city/colorSchemes.js';

test('curved streets remain continuous over tile boundaries and camera rebasing', () => {
  for (const block of [24, 40, 48]) for (const cell of [-801, -8, -1, 0, 1, 8, 801]) {
    const origin = cell * block, x = origin + block * 0.83, focus = origin + block * 0.65;
    const relative = o => (streetOffset(x, block) - streetOffset(o, block)) -
      (streetOffset(focus, block) - streetOffset(o, block));
    assert.ok(Math.abs(relative(origin) - relative(origin + block)) < 1e-10);
    const epsilon = 1e-5;
    assert.ok(Math.abs(streetOffset(origin + epsilon, block) - streetOffset(origin - epsilon, block)) < 1e-4);
    const numerical = (streetOffset(x + epsilon, block) - streetOffset(x - epsilon, block)) / (2 * epsilon);
    assert.ok(Math.abs(numerical - streetSlope(x, block)) < 1e-7);
    assert.ok(Math.abs(streetSlope(x, block)) < 0.26);
    assert.ok(Math.abs(streetOffset(x, block) - streetOffset(focus, block)) < streetMargin(block));
  }
});

test('render mapping preserves lane separation and has a unique inverse', () => {
  for (const block of [24, 40, 48]) for (let x = -block * 8; x < block * 8; x += 0.7) {
    const center = streetOffset(x, block);
    assert.ok(Math.abs(((2.45 + center) - (0.9 + center)) - 1.55) < 1e-12);
    const z = x * 0.2, mappedZ = z + center;
    assert.ok(Math.abs(mappedZ - streetOffset(x, block) - z) < 1e-12);
  }
});

test('long curb and marking sections retain shape and approximate smooth bends', () => {
  for (const base of [new BoxGeometry(), new RoundedBoxGeometry(1, 1, 1, 1, 0.075)]) {
    const sliced = sectionGeometry(base), p = sliced.getAttribute('position');
    sliced.computeBoundingBox(); base.computeBoundingBox();
    assert.deepEqual(sliced.boundingBox, base.boundingBox);
    for (let i = 0; i < (sliced.index?.count ?? p.count); i += 3) {
      const xs = [0, 1, 2].map(j => p.getX(sliced.index ? sliced.index.getX(i + j) : i + j));
      assert.ok(Math.max(...xs) - Math.min(...xs) <= 1 / 8 + 1e-7);
      // Even a double park at maximum block size has less than 0.18 units
      // interpolation error, well inside the 0.55-unit driveable shoulder.
      const a = Math.min(...xs) * 86, b = Math.max(...xs) * 86;
      const midpoint = (a + b) / 2;
      assert.ok(Math.abs(streetOffset(midpoint, 48) - (streetOffset(a, 48) + streetOffset(b, 48)) / 2) < 0.18);
    }
    base.dispose(); sliced.dispose();
  }
});

test('only long scenery uses sectioned meshes', () => {
  const kinds = [], batch = curvedSceneryBatch({ add: kind => kinds.push(kind) });
  batch.add('round', 0, 0, 0, 30, 0.3, 30, '#fff');
  batch.add('paint', 0, 0, 0, 28, 0.02, 0.06, '#fff');
  batch.add('paint', 0, 0, 0, 1.3, 0.02, 0.14, '#fff');
  batch.add('car', 0, 0, 0, 8, 1, 1, '#fff');
  assert.deepEqual(kinds, ['roundBend', 'paintBend', 'paint', 'car']);
});

test('color, shadow and horn sprite shaders use the same bend and retain palette fade', () => {
  const bends = new StreetBends(), scene = new Scene(), material = new MeshStandardMaterial();
  createBackgroundFade('pale').apply(material);
  const mesh = new Mesh(new BoxGeometry(), material); scene.add(mesh);
  bends.configure(40, -320); bends.prepare(scene);
  const compile = (mat, lib) => {
    const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} };
    mat.onBeforeCompile(shader, null);
    assert.equal(shader.uniforms.streetCurve, bends.uniform);
    return shader;
  };
  const color = compile(material, ShaderLib.standard);
  const depth = compile(mesh.customDepthMaterial, ShaderLib.depth);
  assert.ok(color.fragmentShader.includes('backgroundFade'));
  assert.ok(color.vertexShader.includes('worldPosition = streetPosition(modelMatrix * worldPosition)'));
  for (const shader of [color, depth]) assert.ok(shader.vertexShader.includes('viewMatrix * streetPosition(modelMatrix * mvPosition)'));
  const sprite = new MeshStandardMaterial(); bends.applyMaterial(sprite);
  assert.ok(compile(sprite, ShaderLib.sprite).vertexShader.includes('viewMatrix * streetPosition(modelMatrix[ 3 ])'));
  const hook = material.onBeforeCompile; bends.prepare(scene); assert.equal(hook, material.onBeforeCompile);
  assert.equal(mesh.frustumCulled, false);
  bends.dispose(); material.dispose(); sprite.dispose(); mesh.geometry.dispose();
});
