import { REVEAL, sceneryStage } from './revealStages.js';
import { streetHalf } from './roadProfile.js';
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { PAVED_ROAD } from './world.js';
import { DIAGONAL_HALF } from './diagonalLayout.js';
import { ROUNDABOUT_CLEARANCE } from './roundaboutDimensions.js';

export function diagonalLotGeometry() {
  const p=[],tri=(a,b,c)=>p.push(...a,...b,...c),edge=[[0,0],[1,0],[0,1]],at=(v,y)=>[v[0],y,v[1]];
  tri(at(edge[0],.5),at(edge[2],.5),at(edge[1],.5));
  tri(at(edge[0],-.5),at(edge[1],-.5),at(edge[2],-.5));
  for(let i=0;i<3;i++){const a=edge[i],b=edge[(i+1)%3];
    tri(at(a,-.5),at(a,.5),at(b,.5));tri(at(a,-.5),at(b,.5),at(b,-.5));}
  const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(p,3));
  geometry.computeVertexNormals();return geometry;
}
export function clipPolygon(poly,signedDistance) {
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=signedDistance(a),db=signedDistance(b);
    if(da>=-1e-8)out.push(a);
    if((da>0)!==(db>0)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}
  }
  return out;
}
export function outsideApproach(poly,road,block,inset=0){
  const signed=p=>(p.x-road.a.x*block)*road.dz-(p.z-road.a.z*block)*road.dx;
  return [-1,1].map(side=>clipPolygon(poly,p=>side*signed(p)-DIAGONAL_HALF-inset)).filter(p=>p.length>=3);
}
// Arbitrary convex polygons use the same instanced right-triangle prism.
export function polygonSlab(batch,poly,y,h,color,offsetX=0,offsetZ=0,stage){
  for(const indices of ShapeUtils.triangulateShape(poly.map(p=>new Vector2(p.x,p.z)),[])){
    let [a,b,c]=indices.map(i=>poly[i]);
    const length=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
    if(length(a,c)>length(a,b))[b,c]=[c,b];
    if(length(b,c)>length(a,b))[a,c]=[c,a];
    const len=length(a,b);if(len<1e-6)continue;
    const dx=(b.x-a.x)/len,dz=(b.z-a.z)/len,t=(c.x-a.x)*dx+(c.z-a.z)*dz;
    const foot={x:a.x+dx*t,z:a.z+dz*t};
    for(const tip of [a,b]){
      let u={x:tip.x-foot.x,z:tip.z-foot.z},v={x:c.x-foot.x,z:c.z-foot.z};
      if(u.x*v.z-u.z*v.x<0)[u,v]=[v,u];
      const w=Math.hypot(u.x,u.z),d=Math.hypot(v.x,v.z);
      if(w*d>1e-7)batch.add('diagonalLot',foot.x+offsetX,y,foot.z+offsetZ,w,h,d,color,-Math.atan2(u.z,u.x),0,0,stage);
    }
  }
}
// Tile corners adjoining a ring are supplied separately by curved inserts.
export function approachLots(road,gx,gz,block,inset=0){
  const left=gx*block+streetHalf(1,gx)+inset,right=(gx+1)*block-streetHalf(1,gx+1)-inset;
  const top=gz*block+streetHalf(0,gz)+inset,bottom=(gz+1)*block-streetHalf(0,gz+1)-inset;
  let polys=outsideApproach([{x:left,z:top},{x:right,z:top},{x:right,z:bottom},{x:left,z:bottom}],road,block,inset);
  const cx=road.b.x*block,cz=road.b.z*block,r=ROUNDABOUT_CLEARANCE;
  if(road.b.x>=gx&&road.b.x<=gx+1&&road.b.z>=gz&&road.b.z<=gz+1){
    const next=[];
    for(const p of polys){
      const signX=gx>=road.b.x?1:-1,signZ=gz>=road.b.z?1:-1;
      next.push(clipPolygon(p,q=>signX*(q.x-cx)-r));
      next.push(clipPolygon(clipPolygon(p,q=>r-signX*(q.x-cx)),q=>signZ*(q.z-cz)-r));
    }
    polys=next.filter(p=>p.length>=3);
  }
  return polys;
}
function inside(poly,x,z,margin){
  let sign=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
    if(len<1e-6)continue;
    const side=((x-a.x)*dz-(z-a.z)*dx)/len;
    if(Math.abs(side)<margin)return false;
    if(sign&&Math.sign(side)!==sign)return false;sign=Math.sign(side);
  }
  return true;
}
export function populateDiagonal(batch,road,x,z,block,gx=Math.round(x/block),gz=Math.round(z/block)){
  const ox=x-gx*block,oz=z-gz*block;
  for(const [inset,y,h,color]of[[0,.1,.3,'#bdbdbd'],[.21,.25,.34,'#dedede']])
    for(const poly of approachLots(road,gx,gz,block,inset))polygonSlab(batch,poly,y,h,color,ox,oz);
  const lots=approachLots(road,gx,gz,block,.6);
  for(let ix=0;ix<4;ix++)for(let iz=0;iz<4;iz++){
    const px=(gx+(ix+.5)/4)*block,pz=(gz+(iz+.5)/4)*block,w=Math.min(6,block/4-2);
    if(lots.some(p=>inside(p,px,pz,w*.72+1))){
      const h=2.5+((ix*3+iz+gx+gz)%4+4)%4;
      batch.add('building',px+ox,.42+h/2,pz+oz,w,h,w,'#d3d3d3');
    }else if(lots.some(p=>inside(p,px,pz,1.3))){
      batch.add('box',px+ox,1,pz+oz,.25,1.2,.25,'#777777',0,0,0,REVEAL.trees);
      batch.add('crown',px+ox,2,pz+oz,.85,1.1,.85,'#969696');
    }
  }
  const angle=Math.atan2(road.dx,road.dz);
  for(let d=9;d<road.length-12;d+=3.3){
    const px=road.a.x*block+road.dx*d,pz=road.a.z*block+road.dz*d;
    if(Math.floor(px/block)!==gx||Math.floor(pz/block)!==gz)continue;
    if(road.crossings.some(c=>Math.hypot(px-c.x*block,pz-c.z*block)<7))continue;
    batch.add('paint',px+ox,.02,pz+oz,.12,.025,1.3,'#e9e9e9',angle);
    for(const side of [-1,1])batch.add('paint',px+ox-road.dz*side*(DIAGONAL_HALF-.25),.016,
      pz+oz+road.dx*side*(DIAGONAL_HALF-.25),.06,.02,2.8,'#8d8d8d',angle);
  }
}

// Clear only the old grid's markings/medians where a new arm passes through.
// The new approach's own curb and paint use the original batch directly.
export function approachStreetBatch(batch,roads,block,offsetX,offsetZ){
  return {add(kind,x,y,z,w,h,d,color,rotation=0,pitch=0,roll=0,stage=sceneryStage(kind,y)){
    let polys=[[{x:x-w/2-offsetX,z:z-d/2-offsetZ},{x:x+w/2-offsetX,z:z-d/2-offsetZ},
      {x:x+w/2-offsetX,z:z+d/2-offsetZ},{x:x-w/2-offsetX,z:z+d/2-offsetZ}]],changed=false;
    for(const road of roads){
      const px=x-offsetX-road.a.x*block,pz=z-offsetZ-road.a.z*block,along=px*road.dx+pz*road.dz;
      if(along<0||along>road.length)continue;
      const radius=Math.hypot(w,d)*(kind==='crown'?1:.5);
      if(Math.abs(px*road.dz-pz*road.dx)>DIAGONAL_HALF+radius+.3)continue;
      if(h>.65||rotation||pitch||roll)return;
      polys=polys.flatMap(p=>outsideApproach(p,road,block,.2));changed=true;
    }
    if(!changed)batch.add(kind,x,y,z,w,h,d,color,rotation,pitch,roll,stage);
    else for(const poly of polys)polygonSlab(batch,poly,y,h,color,offsetX,offsetZ,stage);
  }};
}
