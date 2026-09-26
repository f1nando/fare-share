import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPorsche911 } from './porsche-model.js';
import './porsche-preview.css';

document.querySelector('#app').innerHTML = `
  <main class="studio">
    <div id="viewport" role="img" aria-label="Интерактивная 3D-модель жёлтого Porsche 911"></div>
    <header class="topbar"><div class="brand"><span class="brand-mark">//</span> GARAGE / 001</div><div class="edition">LOW POLY COLLECTION</div></header>
    <section class="intro"><p class="eyebrow">THE SPORTS CAR, REIMAGINED</p><h1>Porsche 911</h1><p class="subtitle">Знакомый силуэт. Новые грани.</p></section>
    <span class="number">01 / 01</span><span class="side-label">INDEPENDENT DESIGN STUDY — 2026</span>
    <div class="tools" aria-label="Управление моделью">
      <button class="tool" id="rotate" aria-label="Автовращение" title="Автовращение" aria-pressed="false">↻</button>
      <button class="tool" id="wireframe" aria-label="Показать сетку" title="Показать сетку" aria-pressed="false">◇</button>
      <button class="tool" id="reset" aria-label="Сбросить ракурс" title="Сбросить ракурс">⌖</button>
    </div>
    <footer class="bottom">
      <div class="details"><div class="finish"><span class="swatch"></span><div><div class="small-label">EXTERIOR FINISH</div><div class="finish-name">Racing Yellow</div></div></div>
      <div class="specs"><div><div class="small-label">BODY</div><div class="spec-value">911 / Coupé</div></div><div><div class="small-label">GEOMETRY</div><div class="spec-value">Low poly</div></div></div></div>
      <div class="navigation"><nav class="views" aria-label="Ракурсы автомобиля">
        <button class="view" data-view="perspective" aria-pressed="true">Перспектива</button><button class="view" data-view="front" aria-pressed="false">Спереди</button><button class="view" data-view="side" aria-pressed="false">Сбоку</button><button class="view" data-view="rear" aria-pressed="false">Сзади</button><button class="view" data-view="top" aria-pressed="false">Сверху</button>
      </nav><span class="hint">Вращайте мышью · Скролл для приближения</span></div>
    </footer>
  </main>`;

try {
  const viewport = document.querySelector('#viewport');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  viewport.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eeede9');
  scene.fog = new THREE.Fog('#eeede9', 17, 38);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.65;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b0a995', 1.1));
  const key = new THREE.DirectionalLight('#fff6e0', 3);
  key.position.set(-3, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#e6eeff', 1.2);
  fill.position.set(5, 4, -4);
  scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#eeede9', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  // Soft contact shadow complements the directional shadow under the chassis.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(25, 22, 15, .32)');
  gradient.addColorStop(0.6, 'rgba(25, 22, 15, .16)');
  gradient.addColorStop(1, 'rgba(25, 22, 15, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 5.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  scene.add(shadow);
  scene.add(createPorsche911());
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.75, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI / 2 - 0.035;
  controls.autoRotateSpeed = 0.65;
  const views = {
    perspective: [6.5, 3.45, 7.5], front: [0, 2.05, 9.7],
    side: [10.1, 1.65, 0], rear: [-0.001, 2.25, -9.7], top: [0, 10.5, 0.001],
  };
  let currentView = 'perspective';
  function setView(name) {
    currentView = name;
    const scale = viewport.clientWidth < 650 ? 1.48 : 1;
    camera.position.fromArray(views[name]).sub(controls.target).multiplyScalar(scale).add(controls.target);
    controls.update();
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
  }
  function stopRotation() {
    controls.autoRotate = false;
    document.querySelector('#rotate').setAttribute('aria-pressed', 'false');
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { stopRotation(); setView(button.dataset.view); }));
  document.querySelector('#rotate').addEventListener('click', event => {
    controls.autoRotate = !controls.autoRotate;
    event.currentTarget.setAttribute('aria-pressed', String(controls.autoRotate));
  });
  document.querySelector('#wireframe').addEventListener('click', event => {
    const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    event.currentTarget.setAttribute('aria-pressed', String(enabled));
    scene.traverse(object => { if (object.isMesh && object !== floor && object !== shadow) object.material.wireframe = enabled; });
  });
  document.querySelector('#reset').addEventListener('click', () => { stopRotation(); setView('perspective'); });
  controls.addEventListener('start', () => {
    stopRotation();
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  });
  function resize() {
    const { clientWidth: width, clientHeight: height } = viewport;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  setView(currentView);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
  document.addEventListener('visibilitychange', () => {
    renderer.setAnimationLoop(document.hidden ? null : () => { controls.update(); renderer.render(scene, camera); });
  });
} catch (error) {
  console.error('Porsche preview initialization failed:', error);
  const notice = document.createElement('p');
  notice.className = 'error';
  notice.textContent = 'Не удалось запустить 3D-предпросмотр. Проверьте поддержку WebGL и аппаратное ускорение в браузере.';
  document.querySelector('.studio').append(notice);
}
