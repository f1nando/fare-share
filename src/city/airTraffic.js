import * as THREE from 'three';
import { CAMERA_OFFSET } from './activeWorld.js';

const FLIGHTS = {
  helicopter: { first: 6, period: 58, duration: 15, altitude: 19 },
  airplane: { first: 28, period: 83, duration: 9, altitude: 32 },
};
const horizontal = Math.hypot(CAMERA_OFFSET.x, CAMERA_OFFSET.z);
const rightX = CAMERA_OFFSET.z / horizontal, rightZ = -CAMERA_OFFSET.x / horizontal;
const forwardX = CAMERA_OFFSET.x / horizontal, forwardZ = CAMERA_OFFSET.z / horizontal;
const groundScale = Math.hypot(horizontal, CAMERA_OFFSET.y) / CAMERA_OFFSET.y;

// Camera-relative routes cross the whole view, including on a drifting camera.
// Rebased focus coordinates keep aircraft and their shadows in the same world.
export function flightPose(kind, time, focus, camera) {
  const flight = FLIGHTS[kind], elapsed = time - flight.first;
  if (elapsed < 0) return null;
  const cycle = Math.floor(elapsed / flight.period), age = elapsed % flight.period;
  if (age >= flight.duration) return null;
  const direction = (cycle + (kind === 'airplane' ? 1 : 0)) % 2 ? -1 : 1;
  const progress = age / flight.duration;
  const across = (progress * 2 - 1) * (camera.right + 38) * direction;
  const screenY = camera.top * (cycle % 2 ? -0.18 : 0.18) + (progress - 0.5) * camera.top * 0.3;
  const along = flight.altitude * horizontal / CAMERA_OFFSET.y - screenY * groundScale;
  const dx = rightX * 2 * (camera.right + 38) * direction - forwardX * camera.top * 0.3 * groundScale;
  const dz = rightZ * 2 * (camera.right + 38) * direction - forwardZ * camera.top * 0.3 * groundScale;
  return { x: focus.x + rightX * across + forwardX * along,
    y: flight.altitude, z: focus.z + rightZ * across + forwardZ * along,
    angle: Math.atan2(dx, dz), age };
}

export class AirTraffic {
  constructor(scene) {
    this.scene = scene;
    this.geometries = [];
    this.materials = [];
    const geometry = value => { this.geometries.push(value); return value; };
    const material = color => {
      const value = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
      this.materials.push(value); return value;
    };
    const box = geometry(new THREE.BoxGeometry(1, 1, 1));
    const rounded = geometry(new THREE.SphereGeometry(1, 10, 6));
    const body = material('#777f7d'), glass = material('#283a42');
    const metal = material('#353b3b'), trim = material('#deded4');
    const add = (parent, shape, paint, x, y, z, sx, sy, sz) => {
      const mesh = new THREE.Mesh(shape, paint);
      mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh); return mesh;
    };
    const helicopter = this.helicopter = new THREE.Group();
    add(helicopter, rounded, body, 0, 0, 0, 1.1, 0.95, 2.15);
    add(helicopter, rounded, glass, 0, 0.17, 1.25, 0.97, 0.73, 1.1);
    add(helicopter, box, body, 0, 0.25, -3.05, 0.3, 0.36, 3.8);
    add(helicopter, box, body, 0, 0.77, -4.85, 0.18, 1.45, 0.75);
    add(helicopter, box, trim, 0, 0.27, -3.85, 2.3, 0.12, 0.65);
    for (const side of [-1, 1]) {
      add(helicopter, box, metal, side * 1.1, -1.3, 0, 0.14, 0.16, 3.7);
      for (const z of [-0.8, 0.9]) add(helicopter, box, metal, side * 0.85, -0.91, z, 0.12, 0.8, 0.12);
    }
    add(helicopter, box, metal, 0, 1.15, -0.15, 0.18, 0.7, 0.18);
    this.rotor = new THREE.Group(); this.rotor.position.set(0, 1.55, -0.15);
    helicopter.add(this.rotor);
    for (const angle of [0, Math.PI / 2]) {
      const blade = add(this.rotor, box, metal, 0, 0, 0, 9.5, 0.075, 0.2);
      blade.rotation.y = angle;
    }
    this.tailRotor = new THREE.Group(); this.tailRotor.position.set(0.25, 0.8, -4.85);
    helicopter.add(this.tailRotor);
    add(this.tailRotor, box, metal, 0, 0, 0, 0.08, 1.7, 0.13);
    add(this.tailRotor, box, metal, 0, 0, 0, 0.08, 0.13, 1.7);

    // A silhouette writes only to the sun's shadow map, never to colour/depth
    // in the main view. Its shadow falls naturally over roofs, roads and water.
    const outline = new THREE.Shape();
    const points = [[0, 8.5], [0.65, 6.6], [0.7, 1.6], [8.5, -1.9], [8.5, -3],
      [0.65, -1], [0.45, -5.8], [3.1, -7.1], [3.1, -7.8], [0, -7],
      [-3.1, -7.8], [-3.1, -7.1], [-0.45, -5.8], [-0.65, -1], [-8.5, -3],
      [-8.5, -1.9], [-0.7, 1.6], [-0.65, 6.6]];
    points.forEach(([x, z], i) => i ? outline.lineTo(x, z) : outline.moveTo(x, z));
    outline.closePath();
    const silhouette = geometry(new THREE.ShapeGeometry(outline).rotateX(Math.PI / 2));
    const invisible = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    this.materials.push(invisible);
    this.airplane = new THREE.Mesh(silhouette, invisible);
    this.airplane.castShadow = true;
    helicopter.visible = this.airplane.visible = false;
    scene.add(helicopter, this.airplane);
  }

  update(time, focus, camera, { effectFor, onVisible } = {}) {
    for (const kind of ['helicopter', 'airplane']) {
      const mesh = this[kind], pose = flightPose(kind, time, focus, camera);
      mesh.visible = Boolean(pose);
      if (!pose) continue;
      mesh.position.set(pose.x, pose.y, pose.z);
      const key = kind;
      const effect = kind === 'helicopter' ? effectFor?.(key, kind) : null;
      mesh.rotation.set(0, pose.angle + (effect?.yaw ?? 0), 0);
      if (kind === 'helicopter') onVisible?.(pose.x, pose.y, pose.z, key, kind);
    }
    this.rotor.rotation.y = time * 31;
    this.tailRotor.rotation.x = time * 43;
  }

  dispose() {
    this.scene.remove(this.helicopter, this.airplane);
    this.geometries.forEach(item => item.dispose());
    this.materials.forEach(item => item.dispose());
  }
}
