import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { applyTraits, modelStats, disposeModel } from './collection.js';
import './studio.css';

document.querySelector('#app').innerHTML = `
  <header><a class="brand" href="/nft.html"><span class="brand-mark">T<span>×</span></span> TAXI / OBJECTS</a><span class="edition">COLLECTION LAB <i></i> SERIES 001</span></header>
  <main><section class="viewport" aria-label="Интерактивный предпросмотр Porsche 911">
    <div class="title"><p class="eyebrow">STUTTGART, REIMAGINED</p><h1>Porsche <strong>911.</strong></h1><p class="subtitle">An icon. A new character.</p></div>
    <div id="canvas"></div><div id="loading" role="status">Загрузка модели…</div>
    <div class="view-tools"><button id="rotate" aria-pressed="false">↻ Вращение</button><button id="silhouette" aria-pressed="false">◐ Силуэт</button><button id="wireframe" aria-pressed="false">◇ Сетка</button></div>
    <div class="view-footer"><span>DRAG TO ROTATE <b>·</b> SCROLL TO ZOOM</span><span>Y ↑ <b> / </b> METERS <b> / </b> GLB</span></div>
  </section><aside>
    <div class="spec-heading"><span class="eyebrow">YOUR COLLECTIBLE</span><span class="serial">№ 001</span></div>
    <h2>911 Taxi Edition</h2><p class="description">Знакомый силуэт. Простые формы.<br>Свой характер в каждой детали.</p>
    <div class="section"><label>01 <span>BODY COLOR</span><output id="color-name">Signal yellow</output></label><div class="swatches" id="colors"></div></div>
    <div class="section"><label>02 <span>WHEEL FINISH</span></label><div class="segmented" id="wheel-options"><button class="selected" data-wheel="silver">Silver disc</button><button data-wheel="dark">Graphite disc</button></div></div>
    <div class="section"><label>03 <span>ACCESSORIES</span></label>
      <label class="toggle">Taxi roof sign<input id="taxi" type="checkbox" checked><span></span></label>
      <label class="toggle">Checker decals<input id="decals" type="checkbox" checked><span></span></label>
      <label class="toggle">Rear spoiler<input id="spoiler" type="checkbox"><span></span></label>
    </div>
    <div class="section"><label>04 <span>INSPECTION VIEWS</span></label><div class="views" id="views"></div></div>
    <div class="technical"><div><strong id="triangles">—</strong><span>TRIANGLES</span></div><div><strong id="size">—</strong><span>GLB SIZE</span></div><div><strong id="draws">—</strong><span>CAR DRAWS</span></div></div>
    <button class="download" id="download" disabled>Скачать GLB <span>↗</span></button><p id="status" role="status" class="status">REALTIME THREE.JS · TEXTURE-FREE PBR</p>
  </aside></main><footer><span>LESS GEOMETRY. MORE CHARACTER.</span><span>COLLECTION STANDARD / V1.0</span></footer>
  <section class="contact-sheet"><div><p class="eyebrow">THE SILHOUETTE TEST</p><h2>Узнаваемость в 200 пикселях.</h2><p>Один автомобиль, все ракурсы. Нажмите «Силуэт», чтобы проверить только форму.</p></div><div id="thumbnails"></div></section>`;

const colors=[['Signal yellow','#ffc318'],['Chalk','#d8d6ce'],['Guards red','#c83232'],['Mint green','#92b9a5'],['Gentian blue','#356295'],['Carbon','#32383e']];
const traits={color:colors[0][1],taxi:true,decals:true,spoiler:false,wheels:'silver'};
const canvasHost=document.querySelector('#canvas');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#e7e8e4');renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
canvasHost.append(renderer.domElement);
renderer.domElement.setAttribute('aria-label','3D Porsche 911; вращайте мышью или касанием');
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(35,1,.1,100);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.72,0);controls.enableDamping=true;
controls.minDistance=4.6;controls.maxDistance=12;controls.maxPolarAngle=Math.PI/2-.025;controls.autoRotateSpeed=.65;controls.enablePan=false;
const pmrem=new THREE.PMREMGenerator(renderer), room=new RoomEnvironment();
const environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=.7;room.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight('#ffffff','#78838c',.8));
const key=new THREE.DirectionalLight('#fff8e8',2);key.position.set(-3,7,5);key.castShadow=true;
key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.1,far:20});key.shadow.normalBias=.035;scene.add(key);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#e7e8e4',roughness:1}));
floor.rotation.x=-Math.PI/2;floor.position.y=-.008;floor.receiveShadow=true;scene.add(floor);
const views={ '¾ Front':[-5.8,3.4,5.8],Front:[-7.8,2.35,0],Rear:[7.8,2.35,0],Left:[0,2.0,-8.1],Right:[0,2.0,8.1],'¾ Front R':[-5.8,3.4,-5.8],'¾ Rear':[5.8,3.3,5.8],'¾ Rear L':[5.8,3.3,-5.8],Top:[0,8.7,.001] };
camera.position.fromArray(views['¾ Front']);controls.update();
let model, silhouette=false, wireframe=false, disposed=false;
const originals=new Map(), black=new THREE.MeshBasicMaterial({color:0x080909});
function renderMode() {
  if(!model)return;
  model.traverse(o=>{if(o.isMesh){o.material=silhouette?black:originals.get(o);if(!silhouette)o.material.wireframe=wireframe;}});
  scene.environment=silhouette?null:environment.texture;
  floor.visible=!silhouette;renderer.setClearColor(silhouette?'#f5f5f0':'#e7e8e4');
}
function updateTraits() {
  if(!model)return;
  model.traverse(o=>{if(o.isMesh)o.material=originals.get(o);});applyTraits(model,traits);renderMode();makeThumbnails();
}
function makeThumbnails() {
  if(!model)return;
  const oldSize=renderer.getSize(new THREE.Vector2()), ratio=renderer.getPixelRatio();
  const thumbCamera=new THREE.PerspectiveCamera(35,1,.1,100);
  renderer.setPixelRatio(1);renderer.setSize(200,200,false);
  const host=document.querySelector('#thumbnails');host.replaceChildren();
  for(const [name,position] of Object.entries(views)) {
    thumbCamera.position.fromArray(position);thumbCamera.lookAt(0,.72,0);renderer.render(scene,thumbCamera);
    const figure=document.createElement('figure'),image=new Image(200,200),caption=document.createElement('figcaption');
    image.src=renderer.domElement.toDataURL('image/png');image.alt=`Porsche 911 ${name}${silhouette?' — силуэт':''}`;caption.textContent=name;
    figure.append(image,caption);host.append(figure);
  }
  renderer.setPixelRatio(ratio);renderer.setSize(oldSize.x,oldSize.y,false);
}
colors.forEach(([name,color],index)=>{
  const button=document.createElement('button');button.style.setProperty('--swatch',color);button.title=name;button.setAttribute('aria-label',name);button.setAttribute('aria-pressed',String(index===0));
  button.onclick=()=>{traits.color=color;document.querySelector('#color-name').textContent=name;document.querySelectorAll('.swatches button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));updateTraits();};
  document.querySelector('#colors').append(button);
});
for(const [name,position] of Object.entries(views)) {
  const button=document.createElement('button');button.textContent=name;
  button.onclick=()=>{camera.position.fromArray(position);controls.target.set(0,.72,0);controls.update();};document.querySelector('#views').append(button);
}
for(const id of ['taxi','decals','spoiler'])document.getElementById(id).onchange=e=>{traits[id]=e.target.checked;updateTraits();};
document.querySelectorAll('[data-wheel]').forEach(button=>button.onclick=()=>{traits.wheels=button.dataset.wheel;document.querySelectorAll('[data-wheel]').forEach(b=>b.classList.toggle('selected',b===button));updateTraits();});
document.querySelector('#rotate').onclick=e=>{controls.autoRotate=!controls.autoRotate;e.currentTarget.setAttribute('aria-pressed',String(controls.autoRotate));};
document.querySelector('#silhouette').onclick=e=>{silhouette=!silhouette;e.currentTarget.setAttribute('aria-pressed',String(silhouette));renderMode();makeThumbnails();};
document.querySelector('#wireframe').onclick=e=>{wireframe=!wireframe;e.currentTarget.setAttribute('aria-pressed',String(wireframe));renderMode();makeThumbnails();};
const resize=new ResizeObserver(()=>{const {width,height}=canvasHost.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();});resize.observe(canvasHost);
const clock=new THREE.Clock();
renderer.setAnimationLoop(()=>{controls.update(Math.min(clock.getDelta(),.05));renderer.render(scene,camera);});
try {
  const response=await fetch('/models/collection/porsche-911.glb');if(!response.ok)throw new Error(`GLB HTTP ${response.status}`);
  const bytes=await response.arrayBuffer();
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  model=gltf.scene.getObjectByName('PORSCHE_911');if(!model)throw new Error('Missing PORSCHE_911 root');
  if(disposed)disposeModel(model);
  else {
    model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;originals.set(o,o.material);}});scene.add(model);
    const stats=modelStats(model);document.querySelector('#triangles').textContent=stats.triangles.toLocaleString('en-US');
    document.querySelector('#size').textContent=`${(bytes.byteLength/1024).toFixed(0)} KB`;
    updateTraits();document.querySelector('#loading').hidden=true;document.querySelector('#download').disabled=false;
    // Diagnostics are scoped to this isolated studio and include visible car calls only.
    window.__NFT_STUDIO__={model,scene,renderer,traits,stats};
  }
}catch(error){document.querySelector('#loading').textContent=`Не удалось загрузить модель: ${error.message}. Выполните npm run models:build.`;console.error(error);}
// Update draw count after optional traits change, ignoring the studio floor/shadow passes.
const countDraws=()=>{if(model){let count=0;model.traverseVisible(o=>{if(o.isMesh)count++;});document.querySelector('#draws').textContent=count;}};
document.querySelector('aside').addEventListener('change',countDraws);countDraws();
document.querySelector('#download').onclick=async()=>{
  const button=document.querySelector('#download');button.disabled=true;
  try {
    model.traverse(o=>{if(o.isMesh){o.material=originals.get(o);o.material.wireframe=false;}});
    const bytes=await new GLTFExporter().parseAsync(model,{binary:true,onlyVisible:true});
    const url=URL.createObjectURL(new Blob([bytes],{type:'model/gltf-binary'})),a=document.createElement('a');a.href=url;a.download='porsche-911-custom.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    document.querySelector('#status').textContent='GLB экспортирован с выбранными traits';
  }catch(error){document.querySelector('#status').textContent=`Ошибка экспорта: ${error.message}`;}
  finally{renderMode();button.disabled=false;}
};
window.addEventListener('pagehide',()=>{
  disposed=true;renderer.setAnimationLoop(null);resize.disconnect();controls.dispose();
  if(model){model.traverse(o=>{if(o.isMesh)o.material=originals.get(o);});disposeModel(model);}
  black.dispose();environment.dispose();floor.geometry.dispose();floor.material.dispose();key.shadow.dispose();renderer.dispose();
},{once:true});
