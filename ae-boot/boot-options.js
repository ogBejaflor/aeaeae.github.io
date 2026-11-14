import { POWER_DEFAULTS, POWER_CONTROLS } from './power-screen.js';

// Shared, serializable controls for the renderer and the preview editor.
export const BASE_DURATION = 9.2;
export const DEFAULT_OPTIONS = Object.freeze({
  ...POWER_DEFAULTS,
  duration: 9.2, glow: 1.35, bloomRadius: 1.6,
  lightAt: .55/9.2, starAt: 1.5/9.2, logoAt: 3.92/9.2, sweepEnd: 7.4/9.2,
  lightIntensity: 1.3, lightBloom: 1.8, lightRadius: 1, lightRotation: .12,
  rayLength: 1.2, rayStrength: 1.2, lightTint: '#b9d2ff',
  starSize: 1, starThinness: .22, starAspect: 1.35, spin: 1,
  starBloom: 2, starBrightness: 1.1, streakLength: 1.8,
  dissolveDuration: 1, diffusion: 1.15,
  size: 1, bevel: 1, depth: 1, metalExposure: 1, reflectionSoftness: .3,
  logoTilt: 12, sweepWidth: 1, sweepBrightness: 1, glintStrength: .65,
  endGlints: 1, glintDuration: 1.2,
  trademark: false, quality: 'high', reducedMotion: 'auto', loop: false,
  endBehavior: 'hold'
});

// [key, label, min, max, step, display format].
export const CONTROL_GROUPS = [
  { id:'power', label:'Power', description:'A quiet light, waiting for you. Click the button in the preview to turn on the computer.', controls:POWER_CONTROLS },
  { id:'timing', label:'Timing', description:'Set the pace and when each moment arrives.', controls:[
    ['duration','Total duration',4,20,.2,'seconds'],
    ['lightAt','Light appears',0,.2,.005,'timepoint'],
    ['starAt','Flare appears',.06,.42,.005,'timepoint'],
    ['logoAt','Logo appears',.22,.74,.005,'timepoint'],
    ['sweepEnd','Sweep finishes',.55,.96,.005,'timepoint'],
    ['glow','Master bloom',0,4,.05,'percent'],
    ['bloomRadius','Bloom spread',.3,3,.05,'percent']
  ]},
  { id:'light', label:'Light', description:'A rotating light before the flare takes shape.', controls:[
    ['lightIntensity','Brightness',0,3,.05,'percent'],
    ['lightBloom','Opening bloom',0,4,.05,'percent'],
    ['lightRadius','Halo size',.4,2.5,.05,'percent'],
    ['lightRotation','Rotation speed',-.5,.5,.01,'rotation'],
    ['rayLength','Ray length',.3,3,.05,'percent'],
    ['rayStrength','Ray brightness',0,3,.05,'percent']
  ]},
  { id:'flare', label:'Flare', description:'A fine, bright cross with a small luminous core.', controls:[
    ['starThinness','Core width',.12,.65,.01,'core'],
    ['starSize','Flare size',.4,1.8,.05,'percent'],
    ['starAspect','Vertical stretch',.5,2.5,.05,'ratio'],
    ['spin','Rotation',-2.4,2.4,.04,'turns'],
    ['starBrightness','Brightness',.2,3,.05,'percent'],
    ['starBloom','Flare bloom',0,4,.05,'percent'],
    ['streakLength','Streak length',.4,4,.05,'percent'],
    ['dissolveDuration','Dissolve length',.55,1.7,.05,'percent'],
    ['diffusion','Dissolve spread',.25,2,.05,'percent']
  ]},
  { id:'chrome', label:'Chrome', description:'Shape the metal and the light moving over it.', controls:[
    ['size','Logo scale',.6,1.4,.02,'percent'],
    ['bevel','Edge roundness',.45,1.6,.05,'percent'],
    ['depth','Depth',.6,1.8,.05,'percent'],
    ['metalExposure','Brightness',.3,2,.05,'percent'],
    ['reflectionSoftness','Reflection softness',0,1,.025,'percent'],
    ['logoTilt','Reveal tilt',-30,30,1,'degrees'],
    ['sweepWidth','Sweep width',.25,3,.05,'percent'],
    ['sweepBrightness','Sweep brightness',0,3,.05,'percent'],
    ['glintStrength','Edge glints',0,2,.05,'percent'],
    ['endGlints','Finish glints',0,2,.05,'percent'],
    ['glintDuration','Glint linger',.6,2,.05,'percent']
  ]}
];

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function sanitizeOptions(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))input={};
  const out={...DEFAULT_OPTIONS};
  for(const group of CONTROL_GROUPS) for(const [key,,min,max] of group.controls){
    if(Object.hasOwn(input,key)&&Number.isFinite(Number(input[key])))out[key]=clamp(Number(input[key]),min,max);
  }
  // Maintain the event order while allowing every interval to be stretched.
  out.starAt=Math.max(out.starAt,out.lightAt+.03);
  out.logoAt=Math.max(out.logoAt,out.starAt+.08);
  out.sweepEnd=Math.max(out.sweepEnd,out.logoAt+.12);
  if(/^#[0-9a-f]{6}$/i.test(input.lightTint||''))out.lightTint=input.lightTint.toLowerCase();
  for(const key of ['trademark','loop'])if(typeof input[key]==='boolean')out[key]=input[key];
  if(['balanced','high','ultra'].includes(input.quality))out.quality=input.quality;
  if(input.reducedMotion==='auto'||typeof input.reducedMotion==='boolean')out.reducedMotion=input.reducedMotion;
  if(input.endBehavior==='dismiss')out.endBehavior='dismiss';
  return out;
}

export function sceneTime(progress, options) {
  const input=[0,options.lightAt,options.starAt,options.logoAt,options.sweepEnd,1];
  const output=[0,.55,1.5,3.92,7.4,BASE_DURATION];
  for(let i=1;i<input.length;i++)if(progress<=input[i]){
    const span=input[i]-input[i-1];
    const mix=span>0?clamp((progress-input[i-1])/span,0,1):1;
    return output[i-1]+(output[i]-output[i-1])*mix;
  }
  return BASE_DURATION;
}

export function progressAtSceneTime(time, options) {
  const input=[0,.55,1.5,3.92,7.4,BASE_DURATION];
  const output=[0,options.lightAt,options.starAt,options.logoAt,options.sweepEnd,1];
  for(let i=1;i<input.length;i++)if(time<=input[i]){
    const mix=clamp((time-input[i-1])/(input[i]-input[i-1]),0,1);
    return output[i-1]+(output[i]-output[i-1])*mix;
  }
  return 1;
}

export function colorVector(hex) {
  return [1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16)/255);
}

export function formatControl(value, format, options) {
  if(format==='seconds')return `${value.toFixed(1)} s`;
  if(format==='preciseSeconds')return `${value.toFixed(2)} s`;
  if(format==='timepoint')return `${(value*options.duration).toFixed(1)} s`;
  if(format==='rotation')return `${value>0?'+':''}${value.toFixed(2)} turns/s`;
  if(format==='slowRotation')return `${value>0?'+':''}${value.toFixed(3)} turns/s`;
  if(format==='turns')return `${(value*1.25).toFixed(2)} turns`;
  if(format==='degrees')return `${value}°`;
  if(format==='core')return `${Math.round(value*100)}%`;
  if(format==='ratio')return `${value.toFixed(2)}×`;
  return `${Math.round(value*100)}%`;
}
