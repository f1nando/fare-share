import * as THREE from 'three';
import { createTemplate, gridGeometry, optimizeParts } from './collection.js';

// Shared collection convention: real-world meters, ground Y=0, nose -X.
// Each model owns its silhouette stations; collection helpers own assembly/export.
export function createPorsche911() {
  const t = createTemplate('PORSCHE_911');
  const { root, groups, mesh, box } = t;
  const wheelX = [-1.34, 1.27], radius = 0.405;
  // x, half-width, hood/deck height, fender crown. Short nose, broad rear haunches.
  const profile = [
    [-2.15, .68, .68, .73], [-2.05, .87, .78, .84], [-1.86, .95, .84, .98],
    [-1.63, .98, .89, 1.08], [-1.34, .99, .93, 1.10], [-1.05, .96, .97, 1.07],
    [-.78, .92, 1.01, 1.03], [-.48, .91, 1.03, 1.02], [0, .93, 1.04, 1.04],
    [.48, .98, 1.06, 1.09], [.78, 1.02, 1.08, 1.14], [1.02, 1.04, 1.06, 1.15],
    [1.27, 1.04, 1.03, 1.13], [1.55, 1.02, .98, 1.06], [1.82, .97, .91, .96],
    [2.02, .86, .84, .88], [2.12, .7, .72, .78],
  ];
  const rows = profile.map(([x, w, h, f]) => {
    let edge = .26;
    for (const wx of wheelX) { const dx = Math.abs(x - wx); if (dx < .47) edge = Math.max(edge, radius + Math.sqrt(.47 ** 2 - dx ** 2)); }
    return [[x,.25,-w*.64],[x,edge,-w],[x,Math.max(edge+.045,f-.10),-w],[x,f,-w*.82],
      [x,h,-w*.52],[x,h+.015,0],[x,h,w*.52],[x,f,w*.82],[x,Math.max(edge+.045,f-.10),w],[x,edge,w],[x,.25,w*.64]];
  });
  mesh('BODY','Body',gridGeometry(rows));
  for (const [row, reverse] of [[rows[0], true], [rows.at(-1), false]]) {
    const center = [row[0][0], .5, 0], vertices = [], indices = [];
    for(let j=0;j<row.length;j++) { const k=vertices.length/3; vertices.push(...center,...row[j],...row[(j+1)%row.length]); indices.push(...(reverse?[k,k+2,k+1]:[k,k+1,k+2])); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();mesh('BODY','Body',g);
  }
  box('BODY','Black',[3.5,.09,1.25],[0,.245,0]);

  // Continuous roof arc / fastback, with painted margins around inset glass patches.
  const cabin = [[-.93,1.015,.78],[-.70,1.22,.73],[-.42,1.44,.65],[-.14,1.535,.60],[.20,1.55,.60],[.48,1.48,.64],[.77,1.33,.70],[1.05,1.16,.77],[1.43,1.015,.81]];
  const roofRows = cabin.map(([x,y,w]) => [[x,1.015,-.84],[x,y-.055,-w],[x,y,-w*.58],[x,y+.018,0],[x,y,w*.58],[x,y-.055,w],[x,1.015,.84]]);
  mesh('BODY','Body',gridGeometry(roofRows));
  const roofGlass = (start,end) => cabin.slice(start,end).map(([x,y,w]) => [-.88,-.58,0,.58,.88].map(v => [x,y+.025-.055*Math.max(0,(Math.abs(v)-.58)/.42),w*v]));
  mesh('GLASS','Glass',gridGeometry(roofGlass(0,3)));
  mesh('GLASS','Glass',gridGeometry(roofGlass(5,9)));
  for(const sign of [-1,1]) {
    const side = cabin.slice(1,8).map(([x,y,w]) => [.1,.91].map(f => [x,1.015+(y-.055-1.015)*f,sign*(.84+(w-.84)*f+.009)]));
    mesh('GLASS','Glass',gridGeometry(side,sign===-1));
    // Slim B pillar, mirrored side surfaces.
    mesh('BODY','Body',gridGeometry([
      [[.22,1.047,sign*.85],[.22,1.495,sign*.612]],
      [[.275,1.047,sign*.85],[.275,1.48,sign*.62]],
    ],sign===-1));
    box('SIDE_ACCESSORY','Black',[.22,.105,.17],[-.63,1.06,sign*.96],[0,0,-.10]);
    box('BODY','Black',[.18,.027,.012],[.37,.98,sign*.947]);
  }
  // Simple rounded tire cross section, 16 radial segments, no hidden brake geometry.
  for(const x of wheelX) for(const sign of [-1,1]) {
    const wheel = new THREE.Group(); wheel.name = `WHEEL_${x<0?'FRONT':'REAR'}_${sign<0?'LEFT':'RIGHT'}`;
    wheel.position.set(x,radius,sign*.925); groups.WHEELS.add(wheel);
    const points = [[.265,-.14],[.35,-.14],[radius,-.09],[radius,.09],[.35,.14],[.265,.14]].map(([r,y])=>new THREE.Vector2(r,y));
    const tire = new THREE.Mesh(new THREE.LatheGeometry(points,16),t.materials.Black);
    tire.geometry.normalizeNormals();
    tire.rotation.x=Math.PI/2; tire.name='TIRE';wheel.add(tire);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(.273,.273,.025,16),t.materials.Wheels);
    face.rotation.x=Math.PI/2;face.position.z=sign*.143;face.name='WHEEL_FACE';wheel.add(face);
  }
  // Oval 911 lamp pods lie on the raised front wings, facing forward and up.
  const normal = new THREE.Vector3(-.6,.8,0).normalize();
  const lampRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
  for(const sign of [-1,1]) {
    const pod = mesh('HEADLIGHTS','Black',new THREE.CircleGeometry(1,16),[-1.887,.997,sign*.728]);
    pod.quaternion.copy(lampRotation);pod.scale.set(.177,.224,1);
    const light = mesh('HEADLIGHTS','Lights',new THREE.CircleGeometry(1,16),[-1.893,1.005,sign*.728]);
    light.quaternion.copy(lampRotation);light.scale.set(.128,.169,1);
    box('FRONT_ACCESSORY','Black',[.045,.19,.30],[-2.158,.45,sign*.51],[0,sign*.13,0]);
    box('TAILLIGHTS','Taillights',[.045,.077,.38],[2.149,.752,sign*.49]);
    box('BODY','Black',[.04,.16,.35],[2.119,.397,sign*.48],[0,-sign*.16,0]);
  }
  box('FRONT_ACCESSORY','Black',[.095,.17,.68],[-2.15,.45,0]);
  box('TAILLIGHTS','Taillights',[.045,.039,1.08],[2.149,.752,0]);
  box('BODY','Black',[.05,.055,.61],[2.137,.683,0]);
  box('BODY','Black',[.13,.07,1.39],[-2.065,.295,0]);
  // Optional spoiler is exported as a real removable trait, not baked into body.
  box('REAR_ACCESSORY','Body',[.25,.065,1.65],[1.67,1.15,0]);
  for(const sign of [-1,1]) box('REAR_ACCESSORY','Black',[.06,.19,.06],[1.65,1.045,sign*.55]);

  box('ROOF_ACCESSORY','Body',[.34,.065,.79],[.05,1.596,0]);
  const shape = new THREE.Shape();shape.moveTo(-.38,0);shape.lineTo(.38,0);shape.lineTo(.32,.235);shape.lineTo(-.32,.235);shape.closePath();
  const signGeometry = new THREE.ExtrudeGeometry(shape,{depth:.24,bevelEnabled:false});
  signGeometry.rotateY(Math.PI/2);signGeometry.translate(-.07,1.624,0);
  mesh('ROOF_ACCESSORY','Body',signGeometry);
  // Tiny bitmap glyphs become merged planar geometry: no font, canvas or texture dependency.
  const glyphs = ['111/010/010/010/010','010/101/111/101/101','101/101/010/101/101','111/010/010/010/111'];
  for(const direction of [-1,1]) glyphs.forEach((glyph,k) => glyph.split('/').forEach((row,y) => [...row].forEach((on,x)=>{
    if(on==='1') {
      const g=new THREE.PlaneGeometry(.028,.031);g.rotateY(direction*Math.PI/2);
      mesh('ROOF_ACCESSORY','Black',g,[direction===-1?-.071:.171,1.812-y*.033,-direction*((k*4+x)*.033-.245)]);
    }
  })));
  const widthAt = x => {
    const i = profile.findIndex(station => station[0] >= x), a = profile[i-1], b = profile[i];
    return a[1] + (b[1]-a[1]) * (x-a[0]) / (b[0]-a[0]);
  };
  for(const sign of [-1,1]) for(let i=0;i<6;i++) for(let j=0;j<2;j++) if((i+j)%2===0) {
    const x=-.52+i*.16, y=.70+j*.145;
    const rows=[x-.077,x+.077].map(px=>[[px,y-.07,sign*(widthAt(px)+.009)],[px,y+.07,sign*(widthAt(px)+.009)]]);
    mesh('DECALS','Black',gridGeometry(rows,sign===-1));
  }
  root.userData.model = 'Porsche 911 — stylized modern fastback';
  root.userData.anchors = { roof:[.05,1.59,0], front:[-2.15,.45,0], rear:[2.12,.6,0], wheelRadius:radius };
  return optimizeParts(root);
}
