import * as THREE from 'three';

import { REVEAL } from './revealStages.js';
export { REVEAL } from './revealStages.js';
export const REVEAL_STEP = 0.16;

// A single timeline belongs to the scene, never to a tile or settings revision.
// Alpha hashing gives instanced surfaces genuine fractional coverage without
// transparent-object sorting, lost depth priority or fully opaque early shadows.
// All temporary attributes/shader hooks are removed after the one-shot reveal.
export class SceneReveal {
  constructor({ reducedMotion = false, paused = false } = {}) {
    this.done = reducedMotion || paused;
    this.elapsed = 0;
    this.waterPresent = true;
    this.opacity = { value: new Float32Array(6).fill(this.done ? 1 : 0) };
    this.materials = new Map();
    this.meshes = new Map();
    this.depthMaterials = new Map();
  }
  advance(delta, { paused = false, reducedMotion = false } = {}) {
    if (this.done) return;
    if (reducedMotion) { this.finish(); return; }
    if (paused) return;
    this.elapsed += Math.max(0, delta);
    for (let stage = 0; stage < 6; stage++) {
      const start = (stage - (this.waterPresent ? 0 : 1)) * REVEAL_STEP;
      const t = THREE.MathUtils.clamp((this.elapsed - start) / REVEAL_STEP, 0, 1);
      this.opacity.value[stage] = t * t * (3 - 2 * t);
    }
    if (this.elapsed >= REVEAL_STEP * (this.waterPresent ? 6 : 5)) this.finish();
  }
  apply(material, stage = null) {
    if (this.done || this.materials.has(material)) return;
    const key = material.customProgramCacheKey();
    const previous = { compile: material.onBeforeCompile, key: material.customProgramCacheKey,
      alphaHash: material.alphaHash };
    this.materials.set(material, previous);
    // Beams already blend at opacity .48; retain their native blend/depth state.
    material.alphaHash = !material.transparent;
    material.onBeforeCompile = (shader, renderer) => {
      previous.compile.call(material, shader, renderer);
      shader.uniforms.sceneRevealOpacity = this.opacity;
      const selector = stage === null ? 'int(vSceneRevealStage)' : `${stage}`;
      if (stage === null) {
        shader.vertexShader = 'attribute float sceneRevealStage;\nvarying float vSceneRevealStage;\n' +
          shader.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\nvSceneRevealStage = sceneRevealStage;');
        shader.fragmentShader = 'varying float vSceneRevealStage;\n' + shader.fragmentShader;
      }
      shader.fragmentShader = 'uniform float sceneRevealOpacity[6];\n' + shader.fragmentShader.replace(
        '#include <alphahash_fragment>',
        `diffuseColor.a *= sceneRevealOpacity[${selector}];\nif (diffuseColor.a <= 0.0) discard;\n#include <alphahash_fragment>`,
      );
    };
    // Capture the old key before replacing its hook (Three's default key is
    // onBeforeCompile.toString), preserving the palette shader's program key.
    material.customProgramCacheKey = () => `${key}:scene-reveal:${stage ?? 'instance'}`;
    material.needsUpdate = true;
  }
  prepareMesh(mesh, dynamic) {
    if (this.done) return;
    const source = mesh.geometry;
    if (!dynamic) {
      // Share cached vertex/index buffers, only the per-instance tag is new.
      const geometry = new THREE.BufferGeometry();
      geometry.index = source.index;
      geometry.attributes = { ...source.attributes };
      geometry.groups = source.groups;
      geometry.boundingBox = source.boundingBox;
      geometry.boundingSphere = source.boundingSphere;
      geometry.setAttribute('sceneRevealStage', new THREE.InstancedBufferAttribute(
        new Float32Array(mesh.instanceMatrix.count), 1));
      mesh.geometry = geometry;
    }
    this.meshes.set(mesh, source);
    const stage = dynamic ? REVEAL.cars : null;
    if (!this.depthMaterials.has(stage)) {
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      this.apply(depth, stage);
      this.depthMaterials.set(stage, depth);
    }
    mesh.customDepthMaterial = this.depthMaterials.get(stage);
  }
  releaseMesh(mesh) {
    const source = this.meshes.get(mesh);
    if (!source) return;
    if (mesh.geometry !== source) { mesh.geometry.dispose(); mesh.geometry = source; }
    delete mesh.customDepthMaterial;
    this.meshes.delete(mesh);
  }
  finish() {
    this.done = true;
    this.opacity.value.fill(1);
    for (const [material, previous] of this.materials) {
      material.onBeforeCompile = previous.compile;
      material.customProgramCacheKey = previous.key;
      material.alphaHash = previous.alphaHash;
      material.needsUpdate = true;
    }
    for (const mesh of this.meshes.keys()) this.releaseMesh(mesh);
    for (const depth of this.depthMaterials.values()) depth.dispose();
    this.materials.clear(); this.depthMaterials.clear();
  }
}
