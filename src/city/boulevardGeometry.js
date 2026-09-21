import { streetHalf, boulevardRoad } from './roadProfile.js';
import { roadOpen } from './roadLayout.js';

// Widen only the existing planted avenues. Clip flat slabs and omit objects
// whose footprint reaches the extra lane; ordinary streets keep their width.
export function boulevardSceneryBatch(batch,gx,gz,x,z,block){
  const cuts=[];
  for(const axis of[0,1])for(let n=0;n<=2;n++)for(let s=0;s<2;s++){
    const line=(axis===0?gz:gx)+n,segment=(axis===0?gx:gz)+s;
    if(!boulevardRoad(axis,line)||!roadOpen(axis,line,segment))continue;
    const half=streetHalf(axis,line),cx=x+n*block,cz=z+n*block;
    cuts.push(axis===0?{left:x+s*block,right:x+(s+1)*block,top:cz-half,bottom:cz+half}:
      {left:cx-half,right:cx+half,top:z+s*block,bottom:z+(s+1)*block});
  }
  if(!cuts.length)return batch;
  return {add(kind,px,y,pz,w,h,d,color,rotation=0,pitch=0,roll=0){
    const scale=kind==='crown'?1:.5,hw=(Math.abs(Math.cos(rotation))*w+Math.abs(Math.sin(rotation))*d)*scale,
      hd=(Math.abs(Math.sin(rotation))*w+Math.abs(Math.cos(rotation))*d)*scale;
    let pieces=[{left:px-hw,right:px+hw,top:pz-hd,bottom:pz+hd}],changed=false;
    for(const c of cuts){const next=[];
      for(const p of pieces){
        if(p.right<=c.left||p.left>=c.right||p.bottom<=c.top||p.top>=c.bottom){next.push(p);continue;}
        if(h>=.65||rotation||pitch||roll)return;changed=true;
        const left=Math.max(p.left,c.left),right=Math.min(p.right,c.right);
        if(p.left<left)next.push({...p,right:left});if(p.right>right)next.push({...p,left:right});
        if(p.top<c.top)next.push({left,right,top:p.top,bottom:c.top});
        if(p.bottom>c.bottom)next.push({left,right,top:c.bottom,bottom:p.bottom});
      }pieces=next;
    }
    if(!changed)batch.add(kind,px,y,pz,w,h,d,color,rotation,pitch,roll);
    else for(const p of pieces)batch.add('box',(p.left+p.right)/2,y,(p.top+p.bottom)/2,p.right-p.left,h,p.bottom-p.top,color);
  }};
}
