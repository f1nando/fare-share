import * as THREE from 'three';
import { hornAnimation } from './hornAnimation.js';

export class HornEffects {
  constructor(scene) {
    this.scene = scene;
    this.rings = [];
    this.labels = [];
    this.ringGeometry = new THREE.RingGeometry(0.97, 1, 32);
    this.textures = new Map(['HONK!', 'BEEP!'].map(word => {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 96;
      const context = canvas.getContext('2d');
      context.font = 'italic 900 64px Arial, sans-serif';
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.lineJoin = 'round'; context.lineWidth = 9;
      context.strokeStyle = '#3b3520'; context.fillStyle = '#ffdf46';
      context.strokeText(word, 128, 48); context.fillText(word, 128, 48);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return [word, texture];
    }));
    this.reset();
  }
  reset() {
    this.ringCount = this.labelCount = 0;
    for (const item of this.rings) item.visible = false;
    for (const item of this.labels) item.visible = false;
  }
  createRing() {
    const ring = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({
      color: '#ffe36b', transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    }));
    ring.rotation.x = -Math.PI / 2;
    this.rings.push(ring); this.scene.add(ring);
    return ring;
  }
  createLabel() {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textures.get('HONK!'),
      transparent: true, depthWrite: false, toneMapped: false }));
    this.labels.push(sprite); this.scene.add(sprite);
    return sprite;
  }
  prepare(renderer, camera) {
    // Prepare a small pool and both canvas textures before animation starts.
    // Further simultaneous horns can grow the pool without changing shaders.
    for (const texture of this.textures.values()) renderer.initTexture(texture);
    for (let i = 0; i < 24; i++) {
      this.createRing().material.opacity = 0;
      this.createLabel().material.opacity = 0;
    }
    renderer.compile(this.scene, camera);
    this.reset();
  }
  add(car, x, z, camera) {
    const animation = hornAnimation(car.hornAge, car.signalIndex);
    for (const wave of animation.waves) {
      let ring = this.rings[this.ringCount++];
      if (!ring) ring = this.createRing();
      ring.visible = true;
      ring.position.set(x, 0.65 + (car.rideHeight ?? 0), z);
      ring.scale.setScalar(wave.radius);
      ring.material.opacity = wave.opacity;
    }
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    for (const label of animation.labels) {
      let sprite = this.labels[this.labelCount++];
      if (!sprite) sprite = this.createLabel();
      sprite.visible = true;
      sprite.position.set(x + right.x * label.x, label.y + (car.rideHeight ?? 0), z + right.z * label.x);
      sprite.scale.set(2.9 * label.size, 1.1 * label.size, 1);
      sprite.material.map = this.textures.get(label.word);
      sprite.material.opacity = label.opacity;
      sprite.material.rotation = label.rotation;
    }
  }
  dispose() {
    for (const object of [...this.rings, ...this.labels]) { this.scene.remove(object); object.material.dispose(); }
    for (const texture of this.textures.values()) texture.dispose();
    this.ringGeometry.dispose();
  }
}
