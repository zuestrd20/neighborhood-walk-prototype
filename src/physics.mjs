/** Pure, unit-tested collision and movement math; scene units are metres. */
export const WORLD_RADIUS = 100;
export const PLAYER_RADIUS = 0.34;
export const WALK_SPEED = 2.6;
export const RUN_SPEED = 5.8;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function normalizedInput(x, z) {
  const length = Math.hypot(x, z);
  return length > 1 ? {x:x/length, z:z/length} : {x,z};
}
export function cameraRelativeMove(x,z,yaw) {
  const n=normalizedInput(x,z), s=Math.sin(yaw), c=Math.cos(yaw);
  return {x:n.x*c+n.z*s, z:-n.x*s+n.z*c};
}
export function resolveCircleBox(x,z,r,b) {
  const nearX=clamp(x,b.minX,b.maxX), nearZ=clamp(z,b.minZ,b.maxZ);
  let dx=x-nearX,dz=z-nearZ,distSq=dx*dx+dz*dz;
  if(distSq >= r*r) return {x,z,hit:false};
  if(distSq>1e-12) {
    const correction=r/Math.sqrt(distSq)-1;
    return {x:x+dx*correction,z:z+dz*correction,hit:true};
  }
  // The centre is in/on the box: choose the nearest valid exit face.
  const exits=[{d:x-b.minX,x:b.minX-r,z},{d:b.maxX-x,x:b.maxX+r,z},
    {d:z-b.minZ,x,z:b.minZ-r},{d:b.maxZ-z,x,z:b.maxZ+r}];
  exits.sort((a,b)=>a.d-b.d);
  return {x:exits[0].x,z:exits[0].z,hit:true};
}
export function clampToWorld(x,z,radius=WORLD_RADIUS-PLAYER_RADIUS-0.12) {
  const d=Math.hypot(x,z);
  return d>radius ? {x:x/d*radius,z:z/d*radius,hit:true} : {x,z,hit:false};
}
function isPositionClear(x,z,boxes,radius) {
  return boxes.every(b=>!resolveCircleBox(x,z,radius-1e-8,b).hit);
}
function resolveCandidate(x,z,boxes,radius) {
  let hit=false,boundary=false;
  for(let pass=0;pass<16;pass++) {
    let adjusted=false;
    for(const b of boxes) {
      if(x<b.minX-radius||x>b.maxX+radius||z<b.minZ-radius||z>b.maxZ+radius)continue;
      const result=resolveCircleBox(x,z,radius,b);
      if(result.hit){x=result.x;z=result.z;hit=true;adjusted=true;}
    }
    const edge=clampToWorld(x,z,WORLD_RADIUS-radius-0.12);
    x=edge.x;z=edge.z;boundary ||= edge.hit;adjusted ||= edge.hit;
    if(!adjusted)break;
  }
  return {x,z,hit,boundary,clear:isPositionClear(x,z,boxes,radius)};
}
export function movePlayer(position,dx,dz,boxes,radius=PLAYER_RADIUS) {
  let {x,z}=position, hit=false, boundary=false;
  // Small fixed spatial steps prevent tunnelling through thin street furniture.
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/0.12));
  const sx=dx/steps,sz=dz/steps;
  for(let i=0;i<steps;i++) {
    const beforeX=x,beforeZ=z;
    let next=resolveCandidate(x+sx,z+sz,boxes,radius);
    hit ||= next.hit;boundary ||= next.boundary;
    if(!next.clear){
      // Closely spaced or overlapping colliders may prevent convergence.
      // Try safe axis slides, then retain the last collision-free position.
      const alternatives=[resolveCandidate(x+sx,z,boxes,radius),resolveCandidate(x,z+sz,boxes,radius)]
        .filter(p=>p.clear).sort((a,b)=>((b.x-x)*sx+(b.z-z)*sz)-((a.x-x)*sx+(a.z-z)*sz));
      next=alternatives[0]||{x:beforeX,z:beforeZ};
    }
    x=next.x;z=next.z;
  }
  return {x,z,hit,boundary};
}
/** Earliest hit along segment start→end, with expanded AABBs for camera volume. */
export function segmentBoxFraction(start,end,box,padding=0) {
  let near=0,far=1;
  const axes=[['x','minX','maxX'],['y','minY','maxY'],['z','minZ','maxZ']];
  for(const [axis,minKey,maxKey] of axes) {
    const lo=(box[minKey] ?? 0)-padding,hi=(box[maxKey] ?? 30)+padding;
    const origin=start[axis],delta=end[axis]-origin;
    if(Math.abs(delta)<1e-10){if(origin<lo||origin>hi)return null;continue;}
    let a=(lo-origin)/delta,b=(hi-origin)/delta;
    if(a>b)[a,b]=[b,a];
    near=Math.max(near,a);far=Math.min(far,b);
    if(near>far)return null;
  }
  return near>=0&&near<=1?near:null;
}
export function cameraSafeFraction(start,end,boxes,padding=0.24) {
  let fraction=1;
  for(const box of boxes){const hit=segmentBoxFraction(start,end,box,padding);if(hit!==null)fraction=Math.min(fraction,Math.max(0,hit-0.025));}
  return fraction;
}
export function dampAngle(current,target,rate,dt) {
  const delta=Math.atan2(Math.sin(target-current),Math.cos(target-current));
  return current+delta*(1-Math.exp(-rate*dt));
}
