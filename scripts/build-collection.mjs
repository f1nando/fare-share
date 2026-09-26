import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createPorsche911 } from '../src/nft/porsche911.js';
import { modelStats, disposeModel } from '../src/nft/collection.js';

// GLTFExporter uses FileReader only to package binary buffers; Node supplies Blob.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result=result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
};
export const MODELS = { 'porsche-911': createPorsche911 };
export async function exportCar(factory) {
  const root = factory();
  try {
    const stats = modelStats(root);
    if(stats.triangles>3000) throw new Error(`Triangle budget exceeded: ${stats.triangles}`);
    const glb = await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:false});
    return { glb, stats:{...stats,bytes:glb.byteLength} };
  } finally { disposeModel(root); }
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output=new URL('../public/models/collection/',import.meta.url);await mkdir(output,{recursive:true});
  const manifest={version:1,units:'meters',up:'+Y',forward:'-X',models:{}};
  for(const [id,factory] of Object.entries(MODELS)) {
    const {glb,stats}=await exportCar(factory);
    await writeFile(new URL(`${id}.glb`,output),Buffer.from(glb));
    manifest.models[id]={url:`/models/collection/${id}.glb`,...stats};console.log(id,stats);
  }
  await writeFile(new URL('manifest.json',output),`${JSON.stringify(manifest,null,2)}\n`);
}
