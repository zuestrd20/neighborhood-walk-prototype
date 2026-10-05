import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clamp, cameraRelativeMove, movePlayer, cameraSafeFraction, dampAngle, WALK_SPEED, RUN_SPEED, WORLD_RADIUS} from './physics.mjs';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['world','loading','loading-text','load-progress','welcome','start-button','pause-screen','resume-button','game-hud','info-dialog','minimap','minimap-panel','map-toggle','toast','error-screen','error-message','error-detail','pace-label','walk-distance','centre-distance','compass-heading','render-status','lock-button'].map(k=>[k,$(k)]));
let mode='loading', priorInfoMode='welcome', started=false, infoOpen=false, keys=new Set();
let renderer,scene,camera,avatar,model,colliders=[],clock,lastFrame=0,totalDistance=0,phase=0;
let yaw=0,pitch=.35,wantedDistance=7.6,actualDistance=7.6,walkBlend=0,runBlend=0;
let joystick={x:0,z:0},touchSprint=false,drag=null,toastTimer,ready=false;
let edgeNotified=false,frameCount=0,fpsTime=0,currentFps=60,lastUnlockTime=0;
const player={x:0,z:0,angle:Math.PI};
const target=new THREE.Vector3(),desiredCamera=new THREE.Vector3(),lookTarget=new THREE.Vector3();
const mapContext=ui.minimap.getContext('2d');
const mapBase=document.createElement('canvas');mapBase.width=400;mapBase.height=400;
const joints={};
const pointerCoarse=matchMedia('(pointer: coarse)').matches;
function fail(message,detail=''){
  mode='error';ready=false;keys.clear();
  ui.loading.hidden=true;ui.welcome.hidden=true;ui['game-hud'].hidden=true;ui['pause-screen'].hidden=true;
  if(ui['info-dialog'].open)ui['info-dialog'].close();
  ui['error-message'].textContent=message;ui['error-detail'].textContent=String(detail);ui['error-screen'].hidden=false;
}
window.addEventListener('error',e=>{if(mode!=='error')fail('執行時發生問題。請重新載入；若仍出現，請保留以下技術資訊。',e.error?.stack||e.message)});
window.addEventListener('unhandledrejection',e=>{if(mode!=='error')fail('載入未完成。請確認網路連線正常，重新整理頁面。',e.reason?.stack||e.reason)});
$('reload-button').addEventListener('click',()=>location.reload());
function toast(text){ui.toast.textContent=text;ui.toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>ui.toast.classList.remove('visible'),3200)}
function clearInput(){keys.clear();joystick.x=0;joystick.z=0;touchSprint=false;drag=null;$('joystick-stick').style.transform='';$('touch-sprint').classList.remove('active')}
function unlock(){if(document.pointerLockElement)document.exitPointerLock?.()}
function start(){if(!ready||infoOpen)return;started=true;mode='playing';ui.welcome.hidden=true;ui['pause-screen'].hidden=true;ui['game-hud'].hidden=false;document.body.classList.add('playing');clearInput();ui['world'].querySelector('canvas')?.focus({preventScroll:true})}
function pause(){if(!started||mode!=='playing')return;mode='paused';clearInput();unlock();ui['pause-screen'].hidden=false;$('resume-button').focus({preventScroll:true})}
function reset(){player.x=0;player.z=0;player.angle=Math.PI;avatar.position.set(0,.035,0);avatar.rotation.y=Math.PI;yaw=0;pitch=.35;wantedDistance=7.6;actualDistance=7.6;clearInput();edgeNotified=false;toast('已回到街口。散步路程會繼續累計。');updateCamera(1);updateMap()}
function openInfo(){if(mode==='error'||mode==='loading'||infoOpen)return;priorInfoMode=mode;infoOpen=true;if(mode==='playing')mode='paused';clearInput();unlock();ui['info-dialog'].showModal()}
function closeInfo(){if(ui['info-dialog'].open)ui['info-dialog'].close()}
ui['info-dialog'].addEventListener('close',()=>{infoOpen=false;mode=priorInfoMode==='playing'&&document.hidden?'paused':priorInfoMode;if(mode==='paused'&&started)ui['pause-screen'].hidden=false;clearInput()});
ui['info-dialog'].addEventListener('click',e=>{if(e.target===ui['info-dialog']){const r=ui['info-dialog'].getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeInfo()}});
$('info-button').addEventListener('click',openInfo);$('pause-help').addEventListener('click',openInfo);$('close-info').addEventListener('click',closeInfo);
$('start-button').addEventListener('click',start);$('resume-button').addEventListener('click',start);$('pause-button').addEventListener('click',pause);
$('reset-button').addEventListener('click',()=>{reset();start()});
function toggleMap(){if(!started)return;const hidden=!ui['minimap-panel'].hidden;ui['minimap-panel'].hidden=hidden;ui['map-toggle'].hidden=!hidden}
ui['map-toggle'].addEventListener('click',toggleMap);ui['minimap-panel'].addEventListener('dblclick',toggleMap);
window.addEventListener('keydown',e=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)&&!infoOpen)e.preventDefault();
  if(e.repeat)return;
  if(infoOpen){if(e.code==='KeyH')closeInfo();return}
  if(e.code==='Enter'&&(mode==='welcome'||mode==='paused')){e.preventDefault();start();return}
  if(e.code==='Escape'){if(performance.now()-lastUnlockTime<250)return;if(mode==='playing')pause();else if(mode==='paused')start();return}
  if(e.code==='KeyH'){openInfo();return}
  if(mode!=='playing')return;
  if(e.code==='KeyR'){reset();return}
  if(e.code==='KeyM'){toggleMap();return}
  keys.add(e.code);
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{clearInput();pause()});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause()});
ui['lock-button'].addEventListener('click',async()=>{
  if(mode!=='playing')return;
  const canvas=renderer?.domElement;
  if(document.pointerLockElement){unlock();return}
  if(!canvas?.requestPointerLock){toast('這個瀏覽器不支援鎖定視角；仍可拖曳滑鼠轉動。');return}
  try{await canvas.requestPointerLock()}catch{toast('無法鎖定滑鼠；拖曳畫面也能轉動視角。')}
});
document.addEventListener('pointerlockchange',()=>{const locked=!!document.pointerLockElement;ui['lock-button'].textContent=locked?'解除鎖定':'鎖定視角';if(!locked&&mode==='playing'){lastUnlockTime=performance.now();clearInput();pause()}});
document.addEventListener('pointerlockerror',()=>toast('拖曳畫面也能轉動視角。'));
function orbit(dx,dy){yaw-=dx*.004;pitch=clamp(pitch+dy*.003,.12,1.12)}
function installPointerControls(canvas){
  canvas.tabIndex=0;canvas.setAttribute('aria-label','3D 遊戲。WASD 移動，拖曳滑鼠轉動視角。');
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{if(mode!=='playing'||document.pointerLockElement)return;if(e.pointerType==='touch'&&e.clientX<innerWidth*.36)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId)});
  canvas.addEventListener('pointermove',e=>{if(mode!=='playing')return;if(document.pointerLockElement){orbit(e.movementX,e.movementY);return}if(drag?.id===e.pointerId){orbit(e.clientX-drag.x,e.clientY-drag.y);drag.x=e.clientX;drag.y=e.clientY}});
  const end=e=>{if(drag?.id===e.pointerId)drag=null};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
  canvas.addEventListener('wheel',e=>{if(mode!=='playing')return;e.preventDefault();wantedDistance=clamp(wantedDistance+e.deltaY*.006,3,13)},{passive:false});
}
let joystickPointer=null;
$('joystick').addEventListener('pointerdown',e=>{if(mode!=='playing')return;joystickPointer=e.pointerId;$('joystick').setPointerCapture(e.pointerId);updateJoystick(e)});
$('joystick').addEventListener('pointermove',e=>{if(e.pointerId===joystickPointer)updateJoystick(e)});
function updateJoystick(e){const r=$('joystick').getBoundingClientRect(),max=r.width*.3;let x=e.clientX-r.left-r.width/2,z=e.clientY-r.top-r.height/2;const d=Math.hypot(x,z);if(d>max){x=x/d*max;z=z/d*max}joystick.x=x/max;joystick.z=z/max;$('joystick-stick').style.transform=`translate(${x}px,${z}px)`}
function stopJoystick(e){if(e.pointerId!==joystickPointer)return;joystickPointer=null;joystick.x=0;joystick.z=0;$('joystick-stick').style.transform=''}
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('joystick').addEventListener(event,stopJoystick);
$('touch-sprint').addEventListener('pointerdown',e=>{if(mode!=='playing')return;touchSprint=true;$('touch-sprint').setPointerCapture(e.pointerId);$('touch-sprint').classList.add('active')});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('touch-sprint').addEventListener(event,()=>{touchSprint=false;$('touch-sprint').classList.remove('active')});

function material(color,roughness=.85){return new THREE.MeshStandardMaterial({color,roughness})}
function mesh(geometry,mat,parent,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
function capsule(parent,mat,r,len,x,y,z){return mesh(new THREE.CapsuleGeometry(r,len,4,10),mat,parent,x,y,z)}
function makeAvatar(){
  const root=new THREE.Group();root.name='Original Human Walker';
  const skin=material('#c18c68'),coat=material('#e0ae57'),seam=material('#c88e3e'),pants=material('#284b4f'),shoe=material('#f4ead4'),sole=material('#536e67'),hair=material('#26322e'),bag=material('#8c503e'),white=material('#efe8d4'),black=material('#1d2d2c');
  const body=new THREE.Group();body.position.y=.92;root.add(body);joints.body=body;
  mesh(new THREE.SphereGeometry(.27,12,12),coat,body,0,.32,0).scale.set(1,.97,.67);
  capsule(body,coat,.215,.22,0,.17,0).scale.set(1,1,.73);
  mesh(new THREE.BoxGeometry(.024,.47,.012),seam,body,0,.25,.167);
  mesh(new THREE.BoxGeometry(.11,.12,.018),seam,body,-.13,.16,.165);
  mesh(new THREE.BoxGeometry(.11,.12,.018),seam,body,.13,.16,.165);
  capsule(body,skin,.077,.1,0,.59,0);
  const head=new THREE.Group();head.position.set(0,.77,0);body.add(head);joints.head=head;
  mesh(new THREE.SphereGeometry(.173,16,14),skin,head,0,0,0).scale.set(.86,1.12,.91);
  mesh(new THREE.SphereGeometry(.177,16,10,0,Math.PI*2,0,Math.PI*.56),hair,head,0,.046,-.018).scale.set(.92,1,.98);
  mesh(new THREE.SphereGeometry(.035,8,6),skin,head,0,-.008,.146).scale.set(.7,.7,1);
  for(const s of [-1,1]){mesh(new THREE.SphereGeometry(.014,8,6),black,head,s*.063,.028,.141);mesh(new THREE.SphereGeometry(.031,8,6),skin,head,s*.15,0,0).scale.set(.6,1,.7)}
  // Soft knitted cap and brim make the original walker easy to pick out.
  mesh(new THREE.SphereGeometry(.182,16,10,0,Math.PI*2,0,Math.PI*.48),pants,head,0,.064,-.016).scale.set(.99,.79,1.02);
  mesh(new THREE.BoxGeometry(.29,.026,.095),pants,head,0,.074,.16);
  const backpack=mesh(new THREE.BoxGeometry(.30,.38,.13),bag,body,0,.29,-.218);backpack.geometry.translate(0,0,0);
  mesh(new THREE.BoxGeometry(.24,.11,.03),seam,body,0,.18,-.298);
  for(const s of [-1,1]){
    mesh(new THREE.BoxGeometry(.035,.43,.03),bag,body,s*.14,.29,.155).rotation.z=s*.08;
    const arm=new THREE.Group();arm.position.set(s*.277,.45,0);body.add(arm);
    capsule(arm,coat,.078,.19,0,-.13,0);
    const elbow=new THREE.Group();elbow.position.y=-.29;arm.add(elbow);
    capsule(elbow,coat,.065,.17,0,-.115,0);
    capsule(elbow,skin,.058,.06,0,-.264,.009);
    const leg=new THREE.Group();leg.position.set(s*.11,-.05,0);body.add(leg);
    capsule(leg,pants,.092,.25,0,-.20,0);
    const knee=new THREE.Group();knee.position.y=-.39;leg.add(knee);
    capsule(knee,pants,.077,.23,0,-.16,0);
    mesh(new THREE.BoxGeometry(.158,.11,.285),shoe,knee,0,-.375,.055);
    mesh(new THREE.BoxGeometry(.162,.036,.29),sole,knee,0,-.434,.057);
    joints[s===-1?'leftArm':'rightArm']=arm;joints[s===-1?'leftElbow':'rightElbow']=elbow;joints[s===-1?'leftLeg':'rightLeg']=leg;joints[s===-1?'leftKnee':'rightKnee']=knee;
  }
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;const ctx=shadowCanvas.getContext('2d'),g=ctx.createRadialGradient(64,64,2,64,64,63);g.addColorStop(0,'rgba(6,32,30,.34)');g.addColorStop(.45,'rgba(6,32,30,.2)');g.addColorStop(1,'rgba(6,32,30,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
  const sm=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false,opacity:.82});const shadow=mesh(new THREE.PlaneGeometry(1.4,1.4),sm,root,0,.009,0);shadow.rotation.x=-Math.PI/2;shadow.castShadow=false;shadow.receiveShadow=false;
  root.position.set(0,.035,0);root.rotation.y=Math.PI;scene.add(root);return root;
}
function animateAvatar(dt,moving,sprint,speed){
  walkBlend=THREE.MathUtils.damp(walkBlend,moving?1:0,9,dt);runBlend=THREE.MathUtils.damp(runBlend,sprint&&moving?1:0,6,dt);
  phase+=dt*(moving?(sprint?11.5:7.8):2.3);
  const swing=Math.sin(phase),stride=(.5+runBlend*.28)*walkBlend;
  joints.leftLeg.rotation.x=swing*stride;joints.rightLeg.rotation.x=-swing*stride;
  joints.leftKnee.rotation.x=Math.max(0,-swing)*(.47+runBlend*.48)*walkBlend;joints.rightKnee.rotation.x=Math.max(0,swing)*(.47+runBlend*.48)*walkBlend;
  joints.leftArm.rotation.x=-swing*stride*.86-.14*runBlend;joints.rightArm.rotation.x=swing*stride*.86-.14*runBlend;
  joints.leftArm.rotation.z=.07;joints.rightArm.rotation.z=-.07;
  joints.leftElbow.rotation.x=-.13-.62*runBlend;joints.rightElbow.rotation.x=-.13-.62*runBlend;
  joints.body.position.y=.92+Math.abs(Math.sin(phase))*walkBlend*(.023+runBlend*.025)+Math.sin(performance.now()*.0016)*.004*(1-walkBlend);
  joints.body.rotation.x=runBlend*.085;joints.body.rotation.z=Math.sin(phase)*.025*walkBlend;
  joints.head.rotation.y=Math.sin(performance.now()*.0005)*.07*(1-walkBlend);
  avatar.rotation.y=player.angle;avatar.position.set(player.x,.035,player.z);
}
function addSky(){
  const skyGeometry=new THREE.SphereGeometry(440,24,16);
  const skyMaterial=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color('#7dc4d7')},bottom:{value:new THREE.Color('#efefcd')}},vertexShader:'varying vec3 vPosition;void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform vec3 top;uniform vec3 bottom;varying vec3 vPosition;void main(){float h=clamp(normalize(vPosition).y*1.5,0.0,1.0);gl_FragColor=vec4(mix(bottom,top,pow(h,.65)),1.0);}' });
  scene.add(new THREE.Mesh(skyGeometry,skyMaterial));
}
function addBoundary(){
  const points=[];for(let i=0;i<=360;i++){const a=i/360*Math.PI*2;points.push(new THREE.Vector3(Math.sin(a)*99.75,.06,Math.cos(a)*99.75))}
  const geometry=new THREE.BufferGeometry().setFromPoints(points),line=new THREE.Line(geometry,new THREE.LineDashedMaterial({color:'#eac773',dashSize:1.2,gapSize:1,transparent:true,opacity:.75}));line.computeLineDistances();scene.add(line);
}
function buildMap(){
  const ctx=mapBase.getContext('2d'),scale=1.82,centre=200;
  ctx.clearRect(0,0,400,400);ctx.fillStyle='#eef0e3';ctx.beginPath();ctx.arc(200,200,185,0,Math.PI*2);ctx.fill();ctx.save();ctx.clip();
  ctx.fillStyle='#e2e6d6';ctx.fillRect(0,0,400,400);ctx.fillStyle='#fcfaf0';
  const rect=(x,z,w,h)=>ctx.fillRect(centre+x*scale,centre+z*scale,w*scale,h*scale);
  rect(-6,-100,12,200);rect(-100,-5,200,10);rect(-100,-36.5,200,7);rect(-100,29.5,200,7);rect(-84,-100,6,200);rect(78,-100,6,200);
  for(const b of colliders){ctx.fillStyle=b.maxY>4?'#9cb2a5':'#bdc9ad';rect(b.minX,b.minZ,b.maxX-b.minX,b.maxZ-b.minZ)}
  ctx.restore();ctx.strokeStyle='#c1cec0';ctx.lineWidth=2;ctx.beginPath();ctx.arc(200,200,185,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#b3bdaa';ctx.beginPath();ctx.arc(200,200,5,0,Math.PI*2);ctx.fill();
}
function updateMap(){
  if(ui['minimap-panel'].hidden)return;
  const ctx=mapContext,scale=1.82;ctx.clearRect(0,0,400,400);ctx.drawImage(mapBase,0,0);
  const x=200+player.x*scale,y=200+player.z*scale;
  ctx.save();ctx.translate(x,y);ctx.rotate(-yaw);ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,31,-Math.PI*.68,-Math.PI*.32);ctx.closePath();ctx.fillStyle='#4d97933a';ctx.fill();ctx.restore();
  ctx.save();ctx.translate(x,y);ctx.rotate(-player.angle);ctx.fillStyle='#123e3e';ctx.strokeStyle='#fffaf0';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,12);ctx.lineTo(-8,-9);ctx.lineTo(0,-5);ctx.lineTo(8,-9);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}
function updateCamera(dt){
  target.set(player.x,1.55,player.z);
  const targetDistance=mode==='welcome'?13.5:wantedDistance;
  const cameraPitch=mode==='welcome'?.39:pitch;
  const cameraYaw=mode==='welcome'?.36:yaw;
  desiredCamera.set(Math.sin(cameraYaw)*Math.cos(cameraPitch)*targetDistance,Math.sin(cameraPitch)*targetDistance,Math.cos(cameraYaw)*Math.cos(cameraPitch)*targetDistance).add(target);
  const safe=cameraSafeFraction(target,desiredCamera,colliders,.24);
  const safeDistance=targetDistance*safe;
  // Immediately shorten to a wall; ease only when extending to avoid clipping.
  actualDistance=safeDistance<actualDistance?safeDistance:THREE.MathUtils.damp(actualDistance,safeDistance,6,dt);
  desiredCamera.sub(target).normalize().multiplyScalar(Math.max(.08,actualDistance)).add(target);
  camera.position.copy(desiredCamera);camera.position.y=Math.max(.5,camera.position.y);
  lookTarget.copy(target);camera.lookAt(lookTarget);
  avatar.visible=actualDistance>1.1;
  const degrees=((yaw*180/Math.PI)%360+360)%360;
  const headings=['北','西北','西','西南','南','東南','東','東北'];ui['compass-heading'].textContent=headings[Math.round(degrees/45)%8];
}
function step(dt){
  let moving=false,sprint=false,actualSpeed=0;
  if(mode==='playing'){
    let ix=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+joystick.x;
    let iz=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0)+joystick.z;
    const v=cameraRelativeMove(ix,iz,yaw);sprint=keys.has('ShiftLeft')||keys.has('ShiftRight')||touchSprint;
    const speed=sprint?RUN_SPEED:WALK_SPEED,oldX=player.x,oldZ=player.z;
    const next=movePlayer(player,v.x*speed*dt,v.z*speed*dt,colliders);
    player.x=next.x;player.z=next.z;
    const travelled=Math.hypot(player.x-oldX,player.z-oldZ);totalDistance+=travelled;actualSpeed=travelled/Math.max(.0001,dt);moving=actualSpeed>.1;
    if(Math.hypot(v.x,v.z)>.1)player.angle=dampAngle(player.angle,Math.atan2(v.x,v.z),14,dt);
    if(next.boundary&&!edgeNotified){toast('已到達 100 公尺範圍邊緣。轉個方向，繼續逛逛。');edgeNotified=true}if(Math.hypot(player.x,player.z)<96)edgeNotified=false;
  }
  if(mode==='playing'||mode==='welcome')animateAvatar(dt,moving,sprint,actualSpeed);
  updateCamera(dt);
  ui['pace-label'].textContent=moving?(sprint?'輕快小跑':'自在慢行'):'悠閒站立';ui['walk-distance'].textContent=Math.floor(totalDistance);ui['centre-distance'].textContent=Math.floor(Math.hypot(player.x,player.z));
  if(frameCount%4===0)updateMap();
}
function render(now){
  if(mode==='error')return;
  requestAnimationFrame(render);
  const dt=Math.min(Math.max((now-lastFrame)/1000,0),.05);lastFrame=now;
  if(document.hidden)return;
  step(dt);renderer.render(scene,camera);frameCount++;fpsTime+=dt;
  if(fpsTime>2){currentFps=Math.round(frameCount/fpsTime);frameCount=0;fpsTime=0;ui['render-status'].textContent='WEB · 3D';}
}
function resize(){if(!renderer)return;renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}
window.addEventListener('resize',resize);
async function init(){
  if(location.protocol==='file:'){fail('直接點開 index.html 無法讀取 3D 模型。請使用資料夾內的啟動器，讓瀏覽器透過 127.0.0.1 開啟遊戲。','Local file origin is not supported. Run launch.py.');return}
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance',alpha:false});
  }catch(error){fail('瀏覽器無法啟動 3D 顯示。請開啟硬體加速，或換用支援 WebGL 2 的新版 Chrome、Edge、Firefox 或 Safari。',error);return}
  renderer.setPixelRatio(Math.min(devicePixelRatio,pointerCoarse?1.5:1.75));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.14;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  ui.world.append(renderer.domElement);installPointerControls(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();fail('3D 顯示連線中斷，可能是顯示記憶體不足。請關閉其他 3D 分頁，再重新載入。','WebGL context lost')});
  scene=new THREE.Scene();scene.fog=new THREE.Fog('#d1e1d3',115,250);camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.08,550);
  addSky();scene.add(new THREE.HemisphereLight('#e4f4fb','#9f9974',2.5));
  const sun=new THREE.DirectionalLight('#fff1c5',3.1);sun.position.set(-47,83,35);sun.castShadow=true;sun.shadow.mapSize.set(pointerCoarse?1024:2048,pointerCoarse?1024:2048);sun.shadow.camera.left=-110;sun.shadow.camera.right=110;sun.shadow.camera.top=110;sun.shadow.camera.bottom=-110;sun.shadow.camera.near=1;sun.shadow.camera.far=240;sun.shadow.normalBias=.07;sun.shadow.bias=-.00015;scene.add(sun);
  const fill=new THREE.DirectionalLight('#c7e9f4',.45);fill.position.set(40,30,-70);scene.add(fill);
  ui['load-progress'].style.width='15%';
  try{
    const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('Loading timed out after 45 seconds')),45000));
    const load=Promise.all([
      new GLTFLoader().loadAsync('assets/scene.glb',progress=>{if(progress.total)ui['load-progress'].style.width=`${20+progress.loaded/progress.total*65}%`}),
      fetch('assets/collision.json').then(r=>{if(!r.ok)throw new Error(`collision.json HTTP ${r.status}`);return r.json()})
    ]);
    const [gltf,boxes]=await Promise.race([load,timeout]);
    if(!Array.isArray(boxes)||!boxes.length||boxes.some(b=>![b.minX,b.maxX,b.minZ,b.maxZ].every(Number.isFinite)||b.minX>b.maxX||b.minZ>b.maxZ))throw new Error('Invalid collision geometry');
    colliders=boxes;model=gltf.scene;model.name='Original Approximate Neighborhood';
    model.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;if(node.material){const mats=Array.isArray(node.material)?node.material:[node.material];for(const m of mats){m.roughness=Math.max(m.roughness??.8,.65)}}}if(node.isLight)node.visible=false});
    scene.add(model);addBoundary();avatar=makeAvatar();buildMap();updateMap();
    ui['load-progress'].style.width='100%';ui['loading-text'].textContent='街區準備好了';
    mode='welcome';ready=true;ui.loading.hidden=true;ui.welcome.hidden=false;ui['game-hud'].hidden=true;
    updateCamera(1);renderer.render(scene,camera);lastFrame=performance.now();requestAnimationFrame(render);
    // Read-only diagnostics for local verification; no mutation commands are exposed.
    Object.defineProperty(window,'__WALK_DEBUG__',{value:Object.freeze({
      snapshot:()=>Object.freeze({mode,ready,player:Object.freeze({...player}),camera:Object.freeze({x:camera.position.x,y:camera.position.y,z:camera.position.z}),distance:totalDistance,colliders:colliders.length,fps:currentFps,rendererCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,worldRadius:WORLD_RADIUS,sceneLoaded:!!model,approximation:true}),
      getColliders:()=>colliders.map(b=>({...b})),
      version:'1.0.0'
    }),writable:false,configurable:false});
  }catch(error){fail('場景素材載入失敗。請確認網路連線正常，重新整理頁面。若持續失敗，請提供以下技術資訊。',error.stack||error.message||error)}
}
init();
