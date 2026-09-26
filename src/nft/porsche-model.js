import * as THREE from 'three';

// Standalone, metre-scale model. +Z is the front; no city assets or state.
export function createPorsche911() {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: '#ffcf08', roughness: 0.36, metalness: 0.22, flatShading: true });
  const black = new THREE.MeshStandardMaterial({ color: '#17191a', roughness: 0.65 });
  const glass = new THREE.MeshStandardMaterial({ color: '#171e22', roughness: 0.22, metalness: 0.32, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: '#202123', roughness: 0.94, flatShading: true });
  const silver = new THREE.MeshStandardMaterial({ color: '#d9dcdd', metalness: 0.48, roughness: 0.32, flatShading: true });
  const led = new THREE.MeshStandardMaterial({ color: '#f3fcff', emissive: '#c9efff', emissiveIntensity: 2 });
  const red = new THREE.MeshStandardMaterial({ color: '#c50915', emissive: '#fc1123', emissiveIntensity: 0.8 });
  const seam = new THREE.MeshStandardMaterial({ color: '#987207', roughness: 0.7 });

  function mesh(geometry, material, position = [0, 0, 0]) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    car.add(object);
    return object;
  }
  function box(size, position, material = paint) {
    return mesh(new THREE.BoxGeometry(...size), material, position);
  }
  function surface(rows, material) {
    const positions = [], indices = [];
    rows.forEach(row => row.forEach(p => positions.push(...p)));
    const width = rows[0].length;
    for (let r = 0; r < rows.length - 1; r++) {
      for (let c = 0; c < width - 1; c++) {
        const a = r * width + c, b = a + width;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    // Both sides also make the handcrafted open body shell visible underneath.
    const mat = material.clone();
    mat.side = THREE.DoubleSide;
    return mesh(geometry, mat);
  }
  function line(points, material = seam, radius = 0.008) {
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal'), Math.max(12, points.length * 3), radius, 4, false), material);
  }

  const stations = [-2.22, -2.08, -1.91, -1.74, -1.54, -1.34, -1.14, -0.94, -0.76, -0.57, 0, 0.57, 0.78, 0.96, 1.16, 1.36, 1.56, 1.76, 1.94, 2.1, 2.23];
  function width(z) { return 0.96 - 0.12 * Math.pow(Math.abs(z) / 2.24, 6) + 0.035 * Math.exp(-((z + 1.35) ** 2) / 0.3); }
  function arch(z) {
    const d = Math.min(Math.abs(z - 1.36), Math.abs(z + 1.34));
    return d < 0.59 ? 0.52 + Math.sqrt(0.59 ** 2 - d ** 2) : 0.3;
  }
  surface(stations.map(z => {
    const w = width(z);
    const center = z > 0.5 ? 1.02 - 0.21 * ((z - 0.5) / 1.73) : 1.06 - 0.16 * Math.max(0, (-z - 1.3) / 0.92);
    const shoulder = Math.max(center + 0.04, arch(z) + 0.085);
    return [[-w * 0.98, arch(z), z], [-w, shoulder - 0.08, z], [-w * 0.86, shoulder, z], [-w * 0.61, center + 0.025, z], [0, center, z], [w * 0.61, center + 0.025, z], [w * 0.86, shoulder, z], [w, shoulder - 0.08, z], [w * 0.98, arch(z), z]];
  }), paint);
  box([1.42, 0.3, 3.95], [0, 0.47, 0]);
  // Flat, chamfered front and rear fascia, with a low, wide bumper.
  for (const [z, h] of [[2.23, 0.8], [-2.22, 0.9]]) {
    surface([
      [[-0.82, 0.3, z], [-0.5, 0.3, z], [0, 0.3, z], [0.5, 0.3, z], [0.82, 0.3, z]],
      [[-0.85, h - 0.04, z], [-0.5, h, z], [0, h, z], [0.5, h, z], [0.85, h - 0.04, z]],
    ], paint);
  }
  box([1.53, 0.235, 0.075], [0, 0.48, 2.245], black);
  box([1.63, 0.055, 0.11], [0, 0.325, 2.21]);
  for (const side of [-1, 1]) {
    box([0.035, 0.22, 0.09], [side * 0.43, 0.48, 2.29]);
    for (let i = 0; i < 3; i++) box([0.29, 0.014, 0.018], [side * 0.6, 0.41 + i * 0.061, 2.292], black);
    box([0.3, 0.023, 0.025], [side * 0.59, 0.655, 2.266], glass);
    box([0.1, 0.1, 1.47], [side * 0.915, 0.335, 0.01]);
  }

  // 911's continuous fastback: shallow rear glass, compact roof, raked screen.
  const roof = [
    { z: -1.55, y: 1.07, w: 0.73 }, { z: -1.08, y: 1.37, w: 0.69 },
    { z: -0.65, y: 1.64, w: 0.635 }, { z: -0.36, y: 1.72, w: 0.62 },
    { z: 0.19, y: 1.72, w: 0.62 }, { z: 0.43, y: 1.63, w: 0.66 },
    { z: 1.03, y: 1.075, w: 0.77 },
  ];
  surface(roof.map(({ z, y, w }) => [[-w, y - 0.08, z], [-w * 0.76, y - 0.012, z], [0, y + 0.015, z], [w * 0.76, y - 0.012, z], [w, y - 0.08, z]]), paint);
  surface([
    [[-0.602, 1.577, 0.468], [-0.46, 1.644, 0.468], [0, 1.663, 0.468], [0.46, 1.644, 0.468], [0.602, 1.577, 0.468]],
    [[-0.714, 1.062, 0.997], [-0.55, 1.13, 0.997], [0, 1.153, 0.997], [0.55, 1.13, 0.997], [0.714, 1.062, 0.997]],
  ], glass);
  surface([
    [[-0.577, 1.575, -0.681], [-0.43, 1.646, -0.681], [0, 1.666, -0.681], [0.43, 1.646, -0.681], [0.577, 1.575, -0.681]],
    [[-0.647, 1.28, -1.14], [-0.47, 1.347, -1.14], [0, 1.367, -1.14], [0.47, 1.347, -1.14], [0.647, 1.28, -1.14]],
    [[-0.674, 1.063, -1.48], [-0.5, 1.13, -1.48], [0, 1.15, -1.48], [0.5, 1.13, -1.48], [0.674, 1.063, -1.48]],
  ], glass);
  for (const side of [-1, 1]) {
    const p = (x, y, z) => [x * side, y, z];
    surface([
      [p(0.73, 1.065, -1.43), p(0.67, 1.33, -1.04), p(0.625, 1.565, -0.62), p(0.618, 1.625, -0.34), p(0.629, 1.615, 0.18), p(0.685, 1.475, 0.49), p(0.768, 1.062, 0.94)],
      [p(0.82, 1.035, -1.43), p(0.843, 1.045, -1.04), p(0.842, 1.048, -0.62), p(0.839, 1.05, -0.34), p(0.832, 1.052, 0.18), p(0.818, 1.055, 0.49), p(0.789, 1.058, 0.94)],
    ], glass);
    line([p(0.63, 1.587, -0.38), p(0.84, 1.045, -0.5)], black, 0.018);
    line([p(0.806, 1.056, 0.76), p(0.954, 0.91, 0.72), p(0.958, 0.48, 0.54), p(0.958, 0.409, 0.33), p(0.966, 0.408, -0.55), p(0.978, 0.55, -0.7), p(0.964, 0.88, -0.75), p(0.856, 1.045, -0.75)], seam, 0.005);
    box([0.022, 0.028, 0.18], p(0.965, 0.943, -0.46), seam);
    box([0.032, 0.025, 0.155], p(0.98, 0.953, -0.45));
    const stem = box([0.17, 0.04, 0.055], p(0.85, 1.065, 0.66), black);
    stem.rotation.z = side * 0.2;
    const mirror = mesh(new THREE.IcosahedronGeometry(1, 1), black, p(0.99, 1.12, 0.64));
    mirror.scale.set(0.16, 0.087, 0.12);

    for (const z of [-1.34, 1.36]) {
      const tire = mesh(new THREE.CylinderGeometry(0.525, 0.525, 0.25, 16, 1), rubber, p(0.96, 0.535, z));
      tire.rotation.z = Math.PI / 2;
      const rim = mesh(new THREE.CylinderGeometry(0.383, 0.383, 0.018, 16), silver, p(1.092, 0.535, z));
      rim.rotation.z = Math.PI / 2;
      const disc = mesh(new THREE.CylinderGeometry(0.337, 0.358, 0.027, 16), silver, p(1.104, 0.535, z));
      disc.rotation.z = side * -Math.PI / 2;
      const archPoints = Array.from({ length: 13 }, (_, i) => {
        const a = i / 12 * Math.PI;
        return p(width(z + Math.cos(a) * 0.57) + 0.004, 0.52 + Math.sin(a) * 0.575, z + Math.cos(a) * 0.575);
      });
      line(archPoints, black, 0.026);
    }

    const light = new THREE.Group();
    light.position.set(side * 0.719, 1.019, 1.932);
    light.rotation.x = -0.64;
    light.rotation.y = side * 0.13;
    car.add(light);
    const housing = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), paint);
    housing.scale.set(0.205, 0.247, 0.13);
    housing.position.z = -0.075;
    light.add(housing);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(1, 16), black);
    lens.scale.set(0.185, 0.225, 1);
    light.add(lens);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(1, 16), silver);
    inner.scale.set(0.153, 0.19, 1);
    inner.position.z = 0.003;
    light.add(inner);
    const dark = new THREE.Mesh(new THREE.CircleGeometry(1, 16), glass);
    dark.scale.set(0.14, 0.177, 1);
    dark.position.z = 0.006;
    light.add(dark);
    for (const y of [-0.061, 0.061]) {
      const lamp = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.126, 2, 6), led);
      lamp.rotation.z = Math.PI / 2;
      lamp.position.set(0, y, 0.019);
      light.add(lamp);
    }
  }
  // Hood outline, crest, rear cooling grille and continuous red light strip.
  for (const s of [-1, 1]) line([[s * 0.52, 1.047, 0.99], [s * 0.48, 0.975, 1.45], [s * 0.39, 0.864, 2.04], [0, 0.839, 2.07]], seam, 0.004);
  const crest = box([0.042, 0.005, 0.054], [0, 0.88, 1.91], silver);
  crest.rotation.x = 0.12;
  box([1.31, 0.018, 0.25], [0, 1.064, -1.66], black);
  for (let i = 0; i < 19; i++) box([0.016, 0.02, 0.25], [-0.6 + i * 0.067, 1.079, -1.66], glass);
  line([[-0.89, 0.953, -1.98], [-0.75, 0.925, -2.22], [0, 0.925, -2.255], [0.75, 0.925, -2.22], [0.89, 0.953, -1.98]], black, 0.047);
  line([[-0.88, 0.962, -1.99], [-0.745, 0.939, -2.237], [0, 0.939, -2.282], [0.745, 0.939, -2.237], [0.88, 0.962, -1.99]], red, 0.019);
  box([1.55, 0.24, 0.09], [0, 0.435, -2.24], black);
  for (const side of [-1, 1]) {
    box([0.23, 0.027, 0.018], [side * 0.64, 0.598, -2.279], red);
    box([0.23, 0.133, 0.09], [side * 0.57, 0.416, -2.305], silver);
    box([0.186, 0.092, 0.015], [side * 0.57, 0.421, -2.356], black);
  }
  car.userData.paint = paint;
  return car;
}
