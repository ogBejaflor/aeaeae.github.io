// The ae-boot-source preview editor (v4.1), wired into the admin: it uses the site's own
// runtime in /ae-boot/, starts from the site's settings, and adds Save to site,
// Load site settings and Export video (for sound design).
import { AEBootSequence } from '/ae-boot/boot-sequence.js';
import { AEPowerScreen } from '/ae-boot/power-screen.js';
import { DEFAULT_OPTIONS, CONTROL_GROUPS, sanitizeOptions, sceneTime, progressAtSceneTime, formatControl } from '/ae-boot/boot-options.js';

const $=id=>document.getElementById(id);
const STORAGE='ae.admin.boot.draft.v1';
// Start from the site's settings; keep an unsaved draft from last time if there is one.
let siteOptions={},hasFfmpeg=false;
try{const r=await fetch('/api/boot-options',{cache:'no-store'});if(r.ok){const d=await r.json();siteOptions=d.options||{};hasFfmpeg=!!d.ffmpeg;}}catch{}
let restored=siteOptions,draftNote=false;
try{
  const draft=JSON.parse(localStorage.getItem(STORAGE)||'null');
  if(draft&&JSON.stringify(sanitizeOptions(draft))!==JSON.stringify(sanitizeOptions(siteOptions))){restored=draft;draftNote=true;}
}catch{}
const boot=new AEBootSequence($('stage'),{...sanitizeOptions(restored),endBehavior:'hold'});
const power=new AEPowerScreen($('stage'),boot.options);
const timeline=$('timeline'),settings=$('settings');
let scrubPlaying=false,idleTimer,loopTimer,settingsOpen=false,currentGroup='timing',lastPhase='';
let saveTimer,powerMode=true;

function rangeMarkup([key,label,min,max,step]){
  return `<div class="setting"><div class="setting-heading"><label for="${key}">${label}</label><output id="${key}-value" for="${key}"></output></div><input id="${key}" type="range" min="${min}" max="${max}" step="${step}" title="Double-click to reset this control"></div>`;
}
function buildEditor(){
  $('settings-tabs').innerHTML=CONTROL_GROUPS.map(g=>`<button id="tab-${g.id}" class="settings-tab" role="tab" aria-controls="group-${g.id}" aria-selected="${g.id==='timing'}" tabindex="${g.id==='timing'?0:-1}" data-group="${g.id}">${g.label}</button>`).join('');
  $('settings-scroll').innerHTML=CONTROL_GROUPS.map(g=>{
    let extra='';
    if(g.id==='timing')extra=`<label class="check-setting"><span>Loop preview</span><input id="loop" type="checkbox" role="switch"><span class="switch" aria-hidden="true"></span></label><div class="select-setting"><label for="motion-mode">Motion</label><select id="motion-mode"><option value="auto">Follow system</option><option value="full">Full animation</option><option value="gentle">Gentle fade</option></select></div>`;
    if(g.id==='light')extra=`<div class="color-setting"><label for="lightTint">Light tint</label><div class="color-input-wrap"><input type="color" id="lightTint" value="#b9d2ff"><output id="lightTint-value" for="lightTint">#b9d2ff</output></div></div>`;
    if(g.id==='chrome')extra=`<div class="select-setting"><label for="logo-version">Logo version</label><select id="logo-version"><option value="compact">Chrome reference</option><option value="full">Full mark + TM</option></select></div><div class="select-setting"><label for="quality">Render quality</label><select id="quality"><option value="balanced">Balanced</option><option value="high">High</option><option value="ultra">Ultra</option></select></div>`;
    return `<section id="group-${g.id}" class="settings-group" role="tabpanel" aria-labelledby="tab-${g.id}" ${g.id!=='timing'?'hidden':''}><p class="group-description">${g.description}</p>${g.controls.map(rangeMarkup).join('')}${extra}</section>`;
  }).join('');
}
buildEditor();

function showInterface(visible=true){document.body.classList.toggle('interface-visible',(visible||settingsOpen)&&!(powerMode&&!settingsOpen));}
function syncPowerInterface(){
  document.body.classList.toggle('power-off',powerMode&&!settingsOpen);
  document.body.classList.toggle('power-preview',powerMode&&settingsOpen);
  document.querySelectorAll('.interface').forEach(element=>{element.inert=powerMode&&!settingsOpen;});
  timeline.disabled=powerMode;$('play').disabled=powerMode;$('skip').hidden=powerMode;
  $('stage').setAttribute('aria-label',powerMode?'Turn on the æ computer':'æ boot animation: a heavenly light, a spinning four-point star, and a chrome logo');
}
function leavePower(){
  if(!powerMode)return;
  powerMode=false;power.hide();syncPowerInterface();updateTime();updatePlay();
}
function showPower(){
  clearTimeout(loopTimer);clearTimeout(idleTimer);
  powerMode=true;boot.pause();boot.seek(0);power.setOptions(boot.options);power.show({focus:!settingsOpen});
  syncPowerInterface();updateTime();updatePlay();showInterface(settingsOpen);
}
function say(message){$('save-state').textContent=message;}
function save(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    try{localStorage.setItem(STORAGE,JSON.stringify(boot.options));say('Draft kept on this device — Save to site when you like it.');}
    catch{say('Use Export to keep these settings.');}
  },200);
}
function updatePlay(){
  $('play').setAttribute('aria-label',boot.playing?'Pause animation':boot.completed?'Replay boot animation':'Play animation');
  $('play').title=boot.playing?'Pause (Space)':boot.completed?'Replay (R)':'Play (Space)';
  $('play-icon').innerHTML=boot.playing?'<path d="M9 6v12m6-12v12"/>':boot.completed?'<path d="M5 9a7.2 7.2 0 1 1-.2 5M5 4v5h5"/>':'<path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none"/>';
}
function phaseAt(progress){
  const t=sceneTime(progress,boot.options);
  if(t<.55)return 'From nothing.';
  if(t<1.5)return 'A turning light.';
  if(t<3.78)return 'A flare takes shape.';
  if(t<3.78+1.35*boot.options.dissolveDuration)return 'Light dissolves into form.';
  if(t<7.4)return 'The chrome awakens.';
  if(t<9.05&&boot.options.endGlints>0&&boot.options.glintStrength>0)return 'One last shimmer.';
  return 'Ready for the desktop.';
}
function updateTime(){
  const t=boot.currentTime,d=boot.duration,p=t/d;
  timeline.max=d;timeline.value=t;timeline.style.setProperty('--progress',`${p*100}%`);
  timeline.setAttribute('aria-valuetext',`${t.toFixed(1)} of ${d.toFixed(1)} seconds`);
  $('time').innerHTML=`${t.toFixed(1)} <span>/ ${d.toFixed(1)}</span>`;
  const phase=powerMode?(power.state==='starting'?'Turning on the computer.':'Waiting to turn on.'):phaseAt(p);
  if(phase!==lastPhase){$('phase').textContent=phase;lastPhase=phase;$('status').textContent=phase;}
  $('skip').classList.toggle('visible',boot.playing&&t>.8&&!settingsOpen&&!document.body.classList.contains('interface-visible'));
}
function openSettings(open){
  settingsOpen=open;settings.hidden=!open;
  document.body.classList.toggle('settings-open',open);
  $('tune').setAttribute('aria-expanded',String(open));syncPowerInterface();showInterface();
  if(open)$(`tab-${currentGroup}`).focus();else if(powerMode)power.show({focus:true});else $('tune').focus();
}
function inspect(group){
  const times={light:1.35,flare:3.3,blend:3.78+1.35*boot.options.dissolveDuration*.58,chrome:8.35};
  const t=times[group];if(t===undefined)return;
  leavePower();
  clearTimeout(loopTimer);boot.pause();
  boot.seek(progressAtSceneTime(t,boot.options)*boot.duration);showInterface();updatePlay();
}
function selectGroup(id,{focus=false,preview=true}={}){
  const wasPower=powerMode;
  currentGroup=id;
  for(const g of CONTROL_GROUPS){
    const selected=g.id===id;$(`group-${g.id}`).hidden=!selected;
    $(`tab-${g.id}`).setAttribute('aria-selected',String(selected));$(`tab-${g.id}`).tabIndex=selected?0:-1;
  }
  $('settings-scroll').scrollTop=0;
  if(focus)$(`tab-${id}`).focus();
  if(id==='power'){showPower();return;}
  if(wasPower)leavePower();
  if(preview&&!boot.playing)inspect(id==='timing'&&wasPower?'chrome':id);
}
function updateSettings(){
  for(const g of CONTROL_GROUPS)for(const [key,,min,max,,format] of g.controls){
    const value=boot.options[key],input=$(key);input.value=value;
    input.style.setProperty('--progress',`${(value-min)/(max-min)*100}%`);
    const formatted=formatControl(value,format,boot.options);
    $(`${key}-value`).textContent=formatted;input.setAttribute('aria-valuetext',formatted);
  }
  $('logo-version').value=boot.options.trademark?'full':'compact';
  $('motion-mode').value=boot.options.reducedMotion==='auto'?'auto':boot.options.reducedMotion?'gentle':'full';
  $('loop').checked=boot.options.loop;$('quality').value=boot.options.quality;
  $('lightTint').value=boot.options.lightTint;$('lightTint-value').textContent=boot.options.lightTint;
}
function change(values){
  if(!boot.playing&&!powerMode){
    const now=sceneTime(boot.currentTime/boot.duration,boot.options);
    let inspectTime;
    if(Object.keys(values).some(k=>k==='dissolveDuration'||k==='diffusion'))inspectTime=3.78+1.35*(values.dissolveDuration??boot.options.dissolveDuration)*.58;
    if(Object.keys(values).some(k=>k==='endGlints'||k==='glintDuration')&&(now<7.4||now>8.9))inspectTime=8.35;
    if(Object.hasOwn(values,'logoTilt')&&(now<4.4||now>6.1))inspectTime=5.1;
    if(Object.hasOwn(values,'glintStrength')&&!(now>=7.3&&now<9.05)&&![5.32,6.33,7.05].some(t=>Math.abs(t-now)<.15))inspectTime=6.33;
    if(Object.keys(values).some(k=>k==='sweepWidth'||k==='sweepBrightness')&&(now<4.45||now>7.4))inspectTime=5.9;
    if(inspectTime!==undefined)boot.seek(progressAtSceneTime(inspectTime,boot.options)*boot.duration);
  }
  boot.setOptions({...values,endBehavior:'hold'});power.setOptions(boot.options);updateSettings();save();
  if(Object.keys(values).some(key=>key.startsWith('power'))&&!powerMode)showPower();
  if(values.loop===false)clearTimeout(loopTimer);
}
async function replay(){
  if(powerMode){await power.activate();return;}
  clearTimeout(loopTimer);clearTimeout(idleTimer);showInterface(settingsOpen);await boot.play();updatePlay();
}
function togglePlay(){
  if(powerMode)return;
  clearTimeout(loopTimer);
  if(boot.playing){boot.pause();showInterface();}
  else if(boot.completed)replay();else boot.play({restart:false});
  updatePlay();
}
boot.addEventListener('timeupdate',updateTime);
boot.addEventListener('play',updatePlay);boot.addEventListener('pause',updatePlay);
boot.addEventListener('complete',()=>{
  showInterface();$('skip').classList.remove('visible');updatePlay();
  $('status').textContent='Boot complete. Replay or open the sequence editor.';
  if(boot.options.loop&&!boot.reduced)loopTimer=setTimeout(replay,900);
});
boot.addEventListener('fallback',()=>{$('status').textContent='The animated renderer is unavailable. Showing the static logo.';});
power.addEventListener('activating',()=>{updateTime();$('status').textContent='Turning on the computer.';});
power.addEventListener('activate',()=>{leavePower();replay();});
$('play').addEventListener('click',togglePlay);$('skip').addEventListener('click',()=>boot.skip());
$('tune').addEventListener('click',()=>openSettings(!settingsOpen));
$('close-settings').addEventListener('click',()=>openSettings(false));$('replay-settings').addEventListener('click',replay);
$('reset').addEventListener('click',()=>{clearTimeout(loopTimer);boot.setOptions(DEFAULT_OPTIONS);power.setOptions(boot.options);updateSettings();save();say('Default light and animation restored.');});
timeline.addEventListener('pointerdown',()=>{clearTimeout(loopTimer);scrubPlaying=boot.playing;boot.pause();});
timeline.addEventListener('input',()=>{clearTimeout(loopTimer);boot.pause();boot.seek(Number(timeline.value));updatePlay();showInterface();});
timeline.addEventListener('change',()=>{if(scrubPlaying&&!boot.completed)boot.play({restart:false});scrubPlaying=false;updatePlay();});
for(const g of CONTROL_GROUPS)for(const [key] of g.controls){
  $(key).addEventListener('input',()=>change({[key]:Number($(key).value)}));
  $(key).addEventListener('dblclick',()=>change({[key]:DEFAULT_OPTIONS[key]}));
}
for(const g of CONTROL_GROUPS){
  $(`tab-${g.id}`).addEventListener('click',()=>selectGroup(g.id));
  $(`tab-${g.id}`).addEventListener('keydown',event=>{
    let i=CONTROL_GROUPS.findIndex(item=>item.id===g.id);
    const count=CONTROL_GROUPS.length;
    if(event.key==='ArrowRight')i=(i+1)%count;else if(event.key==='ArrowLeft')i=(i+count-1)%count;
    else if(event.key==='Home')i=0;else if(event.key==='End')i=count-1;else return;
    event.preventDefault();selectGroup(CONTROL_GROUPS[i].id,{focus:true});
  });
}
document.querySelectorAll('[data-inspect]').forEach(button=>button.addEventListener('click',()=>inspect(button.dataset.inspect)));
$('logo-version').addEventListener('change',()=>change({trademark:$('logo-version').value==='full'}));
$('quality').addEventListener('change',()=>change({quality:$('quality').value}));
$('loop').addEventListener('change',()=>change({loop:$('loop').checked}));
$('lightTint').addEventListener('input',()=>change({lightTint:$('lightTint').value}));
$('motion-mode').addEventListener('change',()=>change({reducedMotion:$('motion-mode').value==='auto'?'auto':$('motion-mode').value==='gentle'}));

const serialized=()=>JSON.stringify({name:'æ boot preset',version:4,options:boot.options},null,2);
function exportPreset(){
  const url=URL.createObjectURL(new Blob([serialized()],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='ae-boot-preset.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);say('Preset exported.');
}
$('export-settings').addEventListener('click',exportPreset);
$('copy-settings').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(serialized());say('Settings copied.');}
  catch{say('Clipboard unavailable. Use Export to save this preset.');}
});
$('import-settings').addEventListener('click',()=>$('preset-file').click());
$('preset-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>65536)throw new Error('Choose an æ preset JSON file smaller than 64 KB.');
    const data=JSON.parse(await file.text()),input=data?.options??data;
    if(!input||Array.isArray(input)||typeof input!=='object'||!Object.keys(DEFAULT_OPTIONS).some(k=>Object.hasOwn(input,k)))throw new Error('This file does not contain animation settings.');
    clearTimeout(loopTimer);boot.pause();boot.setOptions({...sanitizeOptions(input),endBehavior:'hold'});
    power.setOptions(boot.options);updateSettings();save();
    if(currentGroup==='power')showPower();else inspect(currentGroup==='timing'?'flare':currentGroup);say('Preset imported.');
  }catch(error){say(error.message||'That preset could not be read.');}
  event.target.value='';
});

async function toggleFullscreen(){
  try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();}
  catch{$('status').textContent='Fullscreen is unavailable in this browser.';}
}
$('fullscreen').addEventListener('click',toggleFullscreen);
if(!document.documentElement.requestFullscreen)$('fullscreen').hidden=true;
document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Enter fullscreen');});
document.addEventListener('keydown',event=>{
  const typing=/INPUT|SELECT|TEXTAREA/.test(event.target.tagName);
  if(event.key==='Escape'){if(settingsOpen)openSettings(false);else if(boot.playing)boot.skip();}
  if(powerMode)return;
  if(typing||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.code==='Space'&&!event.target.closest('button,a')){event.preventDefault();togglePlay();}
  if(event.key.toLowerCase()==='r')replay();if(event.key.toLowerCase()==='f')toggleFullscreen();
  if(event.key.toLowerCase()==='c')openSettings(!settingsOpen);if(event.key==='Tab')showInterface();
});
document.addEventListener('pointermove',event=>{
  const box=$('stage').getBoundingClientRect();
  if(event.pointerType==='mouse')boot.setPointer((event.clientX-box.left)/box.width*2-1,(event.clientY-box.top)/box.height*2-1);
  if(boot.playing&&event.clientY>innerHeight-170){
    showInterface();clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(boot.playing&&!settingsOpen)showInterface(false);},2400);
  }
});
$('stage').addEventListener('pointerleave',()=>boot.setPointer(0,0));
$('stage').addEventListener('pointerdown',event=>{if(event.pointerType==='touch')showInterface();});
window.addEventListener('pagehide',event=>{if(!event.persisted){clearTimeout(loopTimer);power.destroy();boot.destroy();}});
syncPowerInterface();updateSettings();updateTime();updatePlay();
openSettings(true); // in the admin, open straight into the editor
if(draftNote)say('Showing your unsaved draft. Save to site, or Load site settings to discard it.');

// ------------------------------------------------------------------ site settings
const forSite=()=>{const {loop,endBehavior,...rest}=boot.options;return rest;};
$('save-site').addEventListener('click',async()=>{
  try{
    const r=await fetch('/api/boot-options',{method:'PUT',headers:{'Content-Type':'application/json','X-AE-Admin':'1'},body:JSON.stringify({options:forSite()})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||`Saving failed (${r.status}).`);
    siteOptions=forSite();
    say('Saved to the site. Publish in the admin to put it live.');
  }catch(e){say(e.message);}
});
$('load-site').addEventListener('click',async()=>{
  try{
    const r=await fetch('/api/boot-options',{cache:'no-store'});siteOptions=(await r.json()).options||{};
    clearTimeout(loopTimer);boot.pause();boot.setOptions({...sanitizeOptions(siteOptions),endBehavior:'hold'});
    power.setOptions(boot.options);updateSettings();
    try{localStorage.removeItem(STORAGE);}catch{}
    if(currentGroup==='power')showPower();else inspect(currentGroup==='timing'?'flare':currentGroup);
    say('Loaded the site\u2019s settings.');
  }catch{say('Couldn\u2019t load the site\u2019s settings.');}
});

// ------------------------------------------------------------------ video export
// Plays the boot in real time and records it at 1920×1080 / 60 fps, so its timing is
// exactly what visitors see. Frame 0 = the moment the boot sound starts on the site.
let recording=false;
function cueSheet(){
  const o=boot.options,d=boot.duration,at=p=>(p*d).toFixed(2);
  const dissolveEnd=progressAtSceneTime(Math.min(9.2,3.78+1.35*o.dissolveDuration),o)*d;
  return [
    'æ boot animation — cue sheet (seconds from the first frame of the video)',
    'The boot sound starts at 0.00, right after the "turn on computer" ripple.',
    '',
    `0.00  black`,
    `${at(o.lightAt)}  the light appears`,
    `${at(o.starAt)}  the flare appears`,
    `${at(o.logoAt)}  the logo appears (flare dissolves into it, until ~${dissolveEnd.toFixed(2)})`,
    `${at(o.sweepEnd)}  the light sweep finishes; finishing glints`,
    `${d.toFixed(2)}  animation ends; on the site the screen then fades to the desktop over 0.65 s`,
    '',
    `Total length: ${d.toFixed(2)} s (+0.65 s fade).`,
  ].join('\n');
}
function download(blob,name){
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
// With ffmpeg: render every frame at its exact time (1/60 s steps) → JPEGs → MP4.
async function exportFrameExact(){
  recording=true;
  const wasOpen=settingsOpen;if(wasOpen)openSettings(false);
  leavePower();clearTimeout(loopTimer);boot.pause();
  await new Promise(r=>setTimeout(r,400)); // let the stage settle at full size
  const W=1920,H=1080,FPS=60,FADE=0.65,TAIL=0.5;
  const out=document.createElement('canvas');out.width=W;out.height=H;
  const g=out.getContext('2d');
  const frame=document.createElement('canvas');frame.width=W;frame.height=H;
  const fg=frame.getContext('2d');
  const grab=()=>{
    const c=boot.canvas;if(!c||!c.width)return;
    const s=Math.min(W/c.width,H/c.height),w=c.width*s,h=c.height*s;
    fg.fillStyle='#000';fg.fillRect(0,0,W,H);fg.drawImage(c,(W-w)/2,(H-h)/2,w,h);
  };
  const originalRender=boot.render;
  boot.render=function(...args){const r=originalRender.apply(this,args);grab();return r;};
  $('rec-badge').hidden=false;$('rec-badge').textContent='● Rendering video';
  try{
    const start=await fetch('/api/boot-video/start',{method:'POST',headers:{'X-AE-Admin':'1'}});
    const {id,error}=await start.json();if(!start.ok)throw new Error(error||'Couldn\u2019t start the video.');
    const d=boot.duration,total=Math.ceil((d+FADE+TAIL)*FPS)+1;
    for(let i=0;i<total;i++){
      const t=i/FPS;
      if(t<=d)boot.seek(t);
      const fade=t<=d?1:Math.max(0,1-(t-d)/FADE);
      g.globalAlpha=1;g.fillStyle='#000';g.fillRect(0,0,W,H);
      g.globalAlpha=fade;g.drawImage(frame,0,0);
      const blob=await new Promise(r=>out.toBlob(r,'image/jpeg',0.92));
      const r=await fetch(`/api/boot-video/${id}/frame/${i}`,{method:'POST',headers:{'X-AE-Admin':'1','Content-Type':'image/jpeg'},body:blob});
      if(!r.ok)throw new Error('A frame couldn\u2019t be saved.');
      if(i%10===0){say(`Rendering video: frame ${i+1} of ${total}\u2026`);$('rec-badge').textContent=`● Rendering video ${Math.round(i/total*100)}%`;}
    }
    say('Making the MP4\u2026');
    const fin=await fetch(`/api/boot-video/${id}/finish`,{method:'POST',headers:{'X-AE-Admin':'1'}});
    if(!fin.ok){const e=await fin.json().catch(()=>({}));throw new Error(e.error||'Making the video failed.');}
    const stamp=new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
    download(await fin.blob(),`ae-boot-${d.toFixed(1)}s-${stamp}.mp4`);
    download(new Blob([cueSheet()],{type:'text/plain'}),`ae-boot-cues-${stamp}.txt`);
    say(`Video exported: 1920×1080, 60 fps, frame-exact (${total} frames) — with a cue sheet.`);
  }catch(e){say(e.message);}
  finally{
    boot.render=originalRender;boot.seek(0);
    $('rec-badge').hidden=true;$('rec-badge').textContent='● Recording';
    recording=false;if(wasOpen)openSettings(true);
  }
}

$('export-video').addEventListener('click',async()=>{
  if(recording)return;
  if(hasFfmpeg){await exportFrameExact();return;}
  if(typeof MediaRecorder==='undefined'){say('This browser can\u2019t record video. Try Chrome.');return;}
  // WebM keeps exact timing; with ffmpeg the admin turns it into a constant-60-fps MP4.
  // Without ffmpeg, record MP4 directly when the browser can.
  const webm=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  const mp4=['video/mp4;codecs=avc1.640028','video/mp4;codecs=avc1','video/mp4'];
  const types=hasFfmpeg?[...webm,...mp4]:[...mp4,...webm];
  const mime=types.find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime){say('This browser can\u2019t record video. Try Chrome.');return;}
  recording=true;
  const wasOpen=settingsOpen;if(wasOpen)openSettings(false);
  leavePower();clearTimeout(loopTimer);boot.pause();boot.seek(0);
  await new Promise(r=>setTimeout(r,400)); // let the stage settle at full size
  const W=1920,H=1080,FPS=60;
  const out=document.createElement('canvas');out.width=W;out.height=H;
  const g=out.getContext('2d');
  // Copy each frame the moment the renderer draws it (a WebGL canvas can't be read later).
  const frame=document.createElement('canvas');frame.width=W;frame.height=H;
  const fg=frame.getContext('2d');
  const grab=()=>{
    const c=boot.canvas;
    if(!c||!c.width)return;
    const s=Math.min(W/c.width,H/c.height),w=c.width*s,h=c.height*s;
    fg.fillStyle='#000';fg.fillRect(0,0,W,H);fg.drawImage(c,(W-w)/2,(H-h)/2,w,h);
  };
  const originalRender=boot.render;
  boot.render=function(...args){const r=originalRender.apply(this,args);grab();return r;};
  boot.seek(0);
  let fade=1,raf=0;
  const draw=()=>{
    g.globalAlpha=1;g.fillStyle='#000';g.fillRect(0,0,W,H);
    g.globalAlpha=fade;g.drawImage(frame,0,0);
    raf=requestAnimationFrame(draw);
  };
  draw();
  const rec=new MediaRecorder(out.captureStream(FPS),{mimeType:mime,videoBitsPerSecond:24e6});
  const chunks=[];rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
  const stopped=new Promise(r=>rec.onstop=r);
  $('rec-badge').hidden=false;document.body.classList.add('recording');
  rec.start(250);
  const done=new Promise(r=>boot.addEventListener('complete',r,{once:true}));
  boot.play();
  await done;
  // the site's fade to the desktop (0.65 s), then a moment of black
  const t0=performance.now();
  await new Promise(r=>{const step=()=>{fade=Math.max(0,1-(performance.now()-t0)/650);if(fade>0)requestAnimationFrame(step);else r();};step();});
  await new Promise(r=>setTimeout(r,500));
  rec.stop();await stopped;cancelAnimationFrame(raf);
  boot.render=originalRender;
  $('rec-badge').hidden=true;document.body.classList.remove('recording');
  let blob=new Blob(chunks,{type:mime.split(';')[0]});
  let ext=mime.startsWith('video/mp4')?'mp4':'webm';
  {
    // through ffmpeg when available: MP4, constant 60 fps (what video editors and DAWs like)
    say('Converting to MP4…');
    try{
      const fd=new FormData();fd.append('file',blob,'boot.webm');
      const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),120000);
      const r=await fetch('/api/boot-video',{method:'POST',headers:{'X-AE-Admin':'1'},body:fd,signal:ctl.signal});
      clearTimeout(timer);
      if(r.ok){blob=await r.blob();ext='mp4';}
    }catch{}
  }
  const stamp=new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
  download(blob,`ae-boot-${boot.duration.toFixed(1)}s-${stamp}.${ext}`);
  download(new Blob([cueSheet()],{type:'text/plain'}),`ae-boot-cues-${stamp}.txt`);
  say(ext==='mp4'?'Video exported (1920×1080, 60 fps) with a cue sheet.':'Video exported as WebM (install ffmpeg for MP4) with a cue sheet.');
  recording=false;
  if(wasOpen)openSettings(true);
});

await boot.ready;
