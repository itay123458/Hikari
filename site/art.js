const $ = selector => document.querySelector(selector);
const scenes = {
  sanctuary: { file:'hikari-midnight', title:'Moonlit sanctuary', alt:'Detailed Hikari moonlit sanctuary with engraved torii, waving cat, sakura, ribbed lanterns and moonwater pool.', orbit:'27deg 68deg auto' },
  lantern: { file:'hikari-lantern', title:'Astral lantern', alt:'Original 3D astral lantern with twelve curved brass ribs, luminous glass, silk tassels, onyx base and orbiting violet crystals.', orbit:'20deg 78deg auto' },
  grimoire: { file:'hikari-grimoire', title:'Celestial grimoire', alt:'Original floating grimoire with separate vellum leaves, gilded inscriptions, cabochons, celestial rings and a levitating star map.', orbit:'28deg 48deg auto' },
};
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const preview=$('#scene-preview'), poster=$('#scene-poster'), enter=$('#explore-3d'), status=$('#model-status'), previewControl=$('#toggle-preview');
let selected='sanctuary', viewer, viewerRequestedPlay=false, userPausedPreview=false, previewFailed=false, generation=0, modulePromise, modelTimeout, moduleAttempts=0;
const overviewVisible=()=>!document.querySelector('[data-view=overview]').hidden;
function revealPreview() {
  if(selected==='sanctuary'&&!viewer&&!previewFailed&&!preview.paused&&preview.readyState>=2&&overviewVisible()&&!document.hidden){
    preview.hidden=false;poster.style.visibility='hidden';
  }
  previewUI();
}
function previewUI() {
  previewControl.hidden=selected!=='sanctuary'||!!viewer||previewFailed||!preview.getAttribute('src');
  previewControl.setAttribute('aria-label',preview.paused?'Play animation preview':'Pause animation preview');
  previewControl.innerHTML=`<svg aria-hidden="true"><use href="#${preview.paused?'play':'pause'}"/></svg>`;
}
function syncPreview() {
  const eligible=selected==='sanctuary'&&!viewer&&!previewFailed;
  if(!eligible){preview.hidden=true;poster.style.visibility='visible';}
  previewControl.hidden=!eligible||!preview.getAttribute('src');
  if(!eligible||!overviewVisible()||document.hidden||motion.matches||userPausedPreview){preview.pause();previewUI();return;}
  if(!navigator.connection?.saveData){
    if(!preview.getAttribute('src'))preview.src='assets/hikari-midnight-loop.webm';
    preview.play().then(revealPreview).catch(previewUI);
  }
}
preview.addEventListener('playing',()=>{
  if(selected!=='sanctuary'||viewer||previewFailed){preview.pause();return;}
  revealPreview();
});
preview.addEventListener('error',()=>{previewFailed=true;preview.hidden=true;poster.style.visibility='visible';previewControl.hidden=true;});
previewControl.addEventListener('click',()=>{
  if(!preview.paused){userPausedPreview=true;preview.pause();previewUI();}
  else {userPausedPreview=false;preview.play().then(revealPreview).catch(()=>{status.textContent='Animation preview unavailable. The artwork is still available.';});}
});
function syncModel() {
  if(!viewer)return;
  if(viewerRequestedPlay&&overviewVisible()&&!document.hidden)viewer.play();else viewer.pause();
  $('#toggle-animation').textContent=viewer.paused?'Play animation':'Pause animation';
}
function closeModel() {
  generation++;clearTimeout(modelTimeout);viewer?.remove();viewer=undefined;viewerRequestedPlay=false;
  poster.hidden=false;poster.style.visibility='visible';preview.hidden=true;$('#viewer-controls').hidden=true;enter.hidden=false;enter.disabled=false;
  enter.innerHTML='<svg aria-hidden="true"><use href="#cube"/></svg>Explore in 3D';
  syncPreview();
}
for(const button of document.querySelectorAll('[data-scene]'))button.addEventListener('click',()=>{
  selected=button.dataset.scene;closeModel();const scene=scenes[selected];
  poster.classList.add('media-loading');
  poster.src=`assets/${scene.file}.webp`;poster.alt=scene.alt;$('#scene-caption').textContent=`${scene.title.toUpperCase()} · AN ORIGINAL BLENDER SCENE`;
  for(const card of document.querySelectorAll('[data-scene]'))card.setAttribute('aria-pressed',String(card===button));
  status.textContent=`${scene.title} selected. Choose Explore in 3D to load its animated model.`;
  preview.hidden=true;syncPreview();$('.hero-art').scrollIntoView({behavior:motion.matches?'instant':'smooth',block:'center'});
});
function loadModule() {
  if(customElements.get('model-viewer'))return Promise.resolve();
  if(modulePromise)return modulePromise;
  modulePromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.type='module';
    // Browsers cache failed module URLs within a page. A retry needs a new URL.
    const attempt=moduleAttempts++;
    script.src='https://ajax.googleapis.com/ajax/libs/model-viewer/4.4.0/model-viewer.min.js'+(attempt?`?retry=${attempt}`:'');
    const fail=()=>{clearTimeout(timeout);script.remove();modulePromise=undefined;reject(new Error('Viewer unavailable'));};
    const timeout=setTimeout(fail,15000);script.onerror=fail;script.onload=()=>{clearTimeout(timeout);resolve();};document.head.append(script);
  });return modulePromise;
}
enter.addEventListener('click',async()=>{
  const request=++generation;const scene=scenes[selected];
  enter.disabled=true;enter.textContent='Loading 3D…';status.textContent=`Loading ${scene.title}.`;
  const fail=()=>{
    if(request!==generation)return;
    closeModel();enter.textContent='Retry 3D';status.textContent='3D could not load. The original artwork and preview are still available.';
  };
  try{
    await loadModule();if(request!==generation)return;
    viewer=document.createElement('model-viewer');
    for(const [key,value] of Object.entries({src:`assets/${scene.file}.glb`,poster:`assets/${scene.file}.webp`,alt:scene.alt+' Drag or use arrow keys to orbit.', 'camera-controls':'','touch-action':'pan-y','camera-orbit':scene.orbit,'shadow-intensity':'.7','environment-image':'neutral',exposure:'.8','interaction-prompt':'none',tabindex:'0'}))viewer.setAttribute(key,value);
    syncPreview();preview.hidden=true;modelTimeout=setTimeout(fail,30000);
    viewer.addEventListener('error',fail,{once:true});
    viewer.addEventListener('load',()=>{
      if(request!==generation)return;
      clearTimeout(modelTimeout);poster.hidden=true;enter.hidden=true;$('#viewer-controls').hidden=false;
      viewerRequestedPlay=!motion.matches;syncModel();status.textContent=`${scene.title} ready. Eight-second Blender animation. Drag to orbit; use Play or Pause to control motion.`;
      if(document.activeElement===enter)$('#toggle-animation').focus({preventScroll:true});
    },{once:true});$('#art-stage').append(viewer);
  }catch{fail();}
});
$('#toggle-animation').addEventListener('click',()=>{viewerRequestedPlay=!viewerRequestedPlay;syncModel();});
$('#exit-3d').addEventListener('click',()=>{closeModel();enter.focus({preventScroll:true});status.textContent='Returned to the original Blender artwork.';});
function syncVisibility(){syncPreview();syncModel();}
document.addEventListener('visibilitychange',syncVisibility);
document.addEventListener('hikari:viewchange',syncVisibility);
motion.addEventListener('change',()=>{if(motion.matches)viewerRequestedPlay=false;syncVisibility();});
