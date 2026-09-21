import { BoxGeometry, BufferGeometry, Float32BufferAttribute, MeshDepthMaterial, RGBADepthPacking, ShaderChunk } from 'three';

// An invertible shear of the whole layout: intersections and lane clearances
// stay connected. Traffic keeps its logical coordinates, including in Worker.
const TAU = Math.PI * 2;
export function streetOffset(x, block) {
  const phase = ((x / block) % 8) * TAU / 4;
  return block * 0.15 * (Math.sin(phase) + 0.18 * Math.sin(phase * 0.5));
}
export function streetSlope(x, block) {
  const phase = ((x / block) % 8) * TAU / 4;
  return 0.15 * TAU / 4 * (Math.cos(phase) + 0.09 * Math.cos(phase * 0.5));
}
export const streetMargin = block => block * 0.36;

// Only the long edges need extra vertices. Rounded slabs keep their footprint
// without subdividing every tiny triangle of RoundedBoxGeometry.
export function sectionGeometry(geometry, sections = 8) {
  if (geometry.type !== 'RoundedBoxGeometry') return new BoxGeometry(1, 1, 1, sections, 1, 1);
  const radius = geometry.parameters.radius, half = 0.5, positions = [];
  const xs = [-half, -half + radius * (1 - Math.SQRT1_2), -half + radius];
  for (let i = 1; i < sections; i++) {
    const x = -half + i / sections;
    if (x > -half + radius && x < half - radius) xs.push(x);
  }
  xs.push(half - radius, half - radius * (1 - Math.SQRT1_2), half);
  const edge = x => half - radius + Math.sqrt(Math.max(0, radius * radius - Math.max(0, Math.abs(x) - half + radius) ** 2));
  const quad = (a, b, c, d) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1], za = edge(a), zb = edge(b);
    quad([a,half,-za], [a,half,za], [b,half,zb], [b,half,-zb]);
    quad([a,-half,-za], [b,-half,-zb], [b,-half,zb], [a,-half,za]);
    quad([a,-half,-za], [a,half,-za], [b,half,-zb], [b,-half,-zb]);
    quad([a,-half,za], [b,-half,zb], [b,half,zb], [a,half,za]);
  }
  const end = edge(half);
  quad([-half,-half,-end], [-half,-half,end], [-half,half,end], [-half,half,-end]);
  quad([half,-half,-end], [half,half,-end], [half,half,end], [half,-half,end]);
  const result = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
  result.computeVertexNormals();
  return result;
}

export function curvedSceneryBatch(batch) {
  return { add(kind, x, y, z, sx, sy, sz, color, rotation = 0, pitch = 0, roll = 0) {
    const sectioned = sx > 6 && Math.abs(rotation) < 0.001 && ['round', 'paint', 'paving', 'box', 'building'].includes(kind);
    batch.add(sectioned ? `${kind}Bend` : kind, x, y, z, sx, sy, sz, color, rotation, pitch, roll);
  } };
}

const shaderFunctions = `
uniform vec4 streetCurve;
float streetDisplacement(float x) {
  float p = x * streetCurve.x + streetCurve.y;
  return streetCurve.z * (sin(p) + 0.18 * sin(p * 0.5)) - streetCurve.w;
}
vec4 streetPosition(vec4 p) { p.z += streetDisplacement(p.x); return p; }
`;

export class StreetBends {
  constructor() {
    this.uniform = { value: [0, 0, 0, 0] };
    this.materials = new WeakSet();
    this.meshes = new WeakSet();
    this.depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    this.applyMaterial(this.depth);
  }
  configure(block, originX) {
    this.uniform.value = [TAU / (4 * block), ((originX / block) % 8) * TAU / 4,
      block * 0.15, streetOffset(originX, block)];
  }
  applyMaterial(material) {
    if (this.materials.has(material)) return;
    this.materials.add(material);
    const before = material.onBeforeCompile, key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      shader.uniforms.streetCurve = this.uniform;
      shader.vertexShader = shaderFunctions + shader.vertexShader
        .replace('#include <project_vertex>', ShaderChunk.project_vertex.replace(
          'mvPosition = modelViewMatrix * mvPosition;', 'mvPosition = viewMatrix * streetPosition(modelMatrix * mvPosition);'))
        .replace('#include <worldpos_vertex>', ShaderChunk.worldpos_vertex.replace(
          'worldPosition = modelMatrix * worldPosition;', 'worldPosition = streetPosition(modelMatrix * worldPosition);'))
        .replace('vec4 mvPosition = modelViewMatrix[ 3 ];', 'vec4 mvPosition = viewMatrix * streetPosition(modelMatrix[ 3 ]);');
    };
    material.customProgramCacheKey = () => `${key}:street-bends-v1`;
    material.needsUpdate = true;
  }
  prepare(scene) {
    scene.traverse(object => {
      if (!object.isMesh && !object.isSprite) return;
      if (this.meshes.has(object)) return;
      this.meshes.add(object);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) this.applyMaterial(material);
      if (object.isMesh) object.customDepthMaterial = this.depth;
      // Batches already tightly filter cars. Shader displacement must not make
      // a surviving mesh disappear at the old, straight bounding sphere.
      object.frustumCulled = false;
    });
  }
  dispose() { this.depth.dispose(); }
}
