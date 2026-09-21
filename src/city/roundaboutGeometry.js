import { BufferGeometry, Float32BufferAttribute } from 'three';
import { roundaboutCornerEdge, roundaboutCapEdge, ROUNDABOUT_CLEARANCE } from './roundaboutDimensions.js';

export function roundaboutCornerGeometry(inset = 0, cap = false) {
  const edge = cap ? roundaboutCapEdge(inset) : roundaboutCornerEdge(inset);
  const corner = { x: cap ? 0 : ROUNDABOUT_CLEARANCE, z: ROUNDABOUT_CLEARANCE }, positions = [];
  const vertex = (p,y) => [p.x,y,p.z];
  const triangle = (a,b,c) => positions.push(...a,...b,...c);
  for (let i=0;i<edge.length-1;i++) {
    triangle(vertex(corner,.5),vertex(edge[i+1],.5),vertex(edge[i],.5));
    triangle(vertex(corner,-.5),vertex(edge[i],-.5),vertex(edge[i+1],-.5));
  }
  const boundary = cap ? [...edge,{x:ROUNDABOUT_CLEARANCE,z:ROUNDABOUT_CLEARANCE},{x:-ROUNDABOUT_CLEARANCE,z:ROUNDABOUT_CLEARANCE}] : [...edge,corner];
  if(cap) for(const [a,b] of [[edge.at(-1),boundary.at(-2)],[boundary.at(-1),edge[0]]]) {
    triangle(vertex(corner,.5),vertex(b,.5),vertex(a,.5));
    triangle(vertex(corner,-.5),vertex(a,-.5),vertex(b,-.5));
  }
  for (let i=0;i<boundary.length;i++) {
    const a=boundary[i],b=boundary[(i+1)%boundary.length];
    triangle(vertex(a,.5),vertex(b,.5),vertex(b,-.5));
    triangle(vertex(a,.5),vertex(b,-.5),vertex(a,-.5));
  }
  const geometry = new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  return geometry;
}
