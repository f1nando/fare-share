import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { exportCar, MODELS } from '../scripts/build-collection.mjs';
import { PARTS, applyTraits, modelStats, disposeModel } from '../src/nft/collection.js';

test('collection GLB roundtrip: names, budgets, ground, wheel pivots and replaceable traits',async()=>{
  for(const factory of Object.values(MODELS)){
    const {glb,stats}=await exportCar(factory);
    assert.ok(stats.triangles<=3000);assert.ok(stats.materials<=6);assert.ok(glb.byteLength<250_000);
    const {scene}=await new GLTFLoader().parseAsync(glb,'');
    const root=scene.getObjectByName('PORSCHE_911');assert.ok(root);
    for(const name of PARTS)assert.ok(root.getObjectByName(name),name);
    assert.equal(modelStats(root).triangles,stats.triangles);
    const bounds=new THREE.Box3().setFromObject(root);
    assert.ok(Math.abs(bounds.min.y)<.001,`ground ${bounds.min.y}`);
    assert.ok(bounds.max.x-bounds.min.x>4);assert.ok(bounds.max.x-bounds.min.x<4.6);
    assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).z)<.001);
    const wheels=root.getObjectByName('WHEELS');assert.equal(wheels.children.length,4);
    for(const wheel of wheels.children){assert.ok(wheel.name.startsWith('WHEEL_'));assert.ok(Math.abs(wheel.position.y-.405)<1e-5);}
    root.traverse(o=>{if(o.isMesh){assert.ok(o.geometry.index);assert.ok(!o.material.map);for(const v of o.geometry.attributes.position.array)assert.ok(Number.isFinite(v));}});
    applyTraits(root,{color:'#ff0000',taxi:false,decals:false,spoiler:true,wheels:'dark'});
    assert.equal(root.getObjectByName('ROOF_ACCESSORY').visible,false);assert.equal(root.getObjectByName('DECALS').visible,false);assert.equal(root.getObjectByName('REAR_ACCESSORY').visible,true);
    root.traverse(o=>{if(o.isMesh&&o.material.name==='Body')assert.equal(o.material.color.getHexString(),'ff0000');});
    disposeModel(root);
  }
});
