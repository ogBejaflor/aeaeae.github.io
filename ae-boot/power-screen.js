// A procedural, quiet power-on gate. No dependencies, images, or network work.
export const POWER_DEFAULTS=Object.freeze({
  powerBrightness:1,powerBloom:1,powerRadius:1,powerRotation:.01,powerFlicker:.6,
  powerRippleDuration:.9,powerRippleStrength:1
});
export const POWER_CONTROLS=Object.freeze([
  ['powerBrightness','Brightness',0,2,.05,'percent'],
  ['powerBloom','Bloom',0,2,.05,'percent'],
  ['powerRadius','Halo size',.5,1.8,.05,'percent'],
  ['powerRotation','Rotation speed',-.08,.08,.002,'slowRotation'],
  ['powerFlicker','Shimmer amount',0,1.25,.05,'percent'],
  ['powerRippleDuration','Ripple duration',.45,1.8,.05,'preciseSeconds'],
  ['powerRippleStrength','Ripple strength',0,2,.05,'percent']
]);
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=x=>x*x*(3-2*x);
const hash=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453123;return v-Math.floor(v);};
const noise=x=>{const i=Math.floor(x);return hash(i)+(hash(i+1)-hash(i))*smooth(x-i);};
const TAU=Math.PI*2;

export function sanitizePowerOptions(input={}){
  const value=input&&typeof input==='object'?input:{};
  const result={...POWER_DEFAULTS};
  for(const [key,,min,max]of POWER_CONTROLS){
    const v=value[key];
    if(v!==null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v)))result[key]=clamp(Number(v),min,max);
  }
  result.lightTint=/^#[0-9a-f]{6}$/i.test(value.lightTint||'')?value.lightTint.toLowerCase():'#b9d2ff';
  result.reducedMotion=typeof value.reducedMotion==='boolean'||value.reducedMotion==='auto'?value.reducedMotion:'auto';
  return result;
}

export class AEPowerScreen extends EventTarget {
  constructor(container,options={}){
    super();
    if(!container||typeof container.append!=='function')throw new TypeError('AEPowerScreen needs a container element.');
    this.container=container;this.options=sanitizePowerOptions(options);
    this.state='hidden';this._generation=0;this._clock=0;this._raf=0;this._lastFrame=null;this._activation=null;
    this._abort=new AbortController();
    this._motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    this.element=document.createElement('section');
    this.element.className='ae-power-screen';this.element.dataset.state='hidden';
    this.element.setAttribute('aria-label','Computer power');
    this.canvas=document.createElement('canvas');this.canvas.className='ae-power-canvas';this.canvas.setAttribute('aria-hidden','true');
    this.aura=document.createElement('div');this.aura.className='ae-power-aura';this.aura.setAttribute('aria-hidden','true');
    this.ripple=document.createElement('div');this.ripple.className='ae-power-ripple';this.ripple.setAttribute('aria-hidden','true');
    this.element.dataset.rippleEngine=typeof this.ripple.animate==='function'?'waapi':'css';
    this.button=document.createElement('button');this.button.type='button';this.button.className='ae-power-button';
    this.button.textContent='turn on computer';
    this.element.append(this.aura,this.canvas,this.ripple,this.button);container.append(this.element);
    try{this.ctx=this.canvas.getContext('2d',{alpha:true,desynchronized:true});}catch{this.ctx=null;}
    this.element.dataset.renderer=this.ctx?'canvas':'css';
    this._frame=this._frame.bind(this);this._resize=this._resize.bind(this);
    this.button.addEventListener('click',()=>{void this.activate();},{signal:this._abort.signal});
    document.addEventListener('visibilitychange',()=>{
      this._lastFrame=null;
      if(document.hidden)this._stopFrame();else this._updateMotion();
    },{signal:this._abort.signal});
    this._onMotionChange=()=>{if(this.options.reducedMotion==='auto')this._updateMotion();};
    if(this._motion.addEventListener)this._motion.addEventListener('change',this._onMotionChange,{signal:this._abort.signal});
    else this._motion.addListener(this._onMotionChange);
    if(typeof ResizeObserver==='function'){
      this._observer=new ResizeObserver(this._resize);this._observer.observe(container);
    }else window.addEventListener('resize',this._resize,{signal:this._abort.signal});
    this.show();
  }
  get reduced(){return this.options.reducedMotion==='auto'?this._motion.matches:this.options.reducedMotion;}
  _visible(){return this.state==='waiting'||this.state==='starting';}
  _setState(state){
    this.state=state;this.element.dataset.state=state;
    this.element.hidden=state==='hidden'||state==='destroyed';
  }
  _cancelActivation(){
    const pending=this._activation;
    if(!pending)return;
    this._activation=null;clearTimeout(pending.timer);
    try{pending.animation?.cancel();}catch{}
    pending.resolve(false);
  }
  show({focus=false}={}){
    if(this.state==='destroyed')return this;
    this._generation++;this._cancelActivation();
    this.button.disabled=false;this.button.removeAttribute('aria-disabled');
    this._setState('waiting');this._resize();this._updateMotion();
    if(focus)this.button.focus({preventScroll:true});
    return this;
  }
  hide(){
    if(this.state==='destroyed')return this;
    this._generation++;this._cancelActivation();this._stopFrame();
    this.button.disabled=true;this._setState('hidden');
    return this;
  }
  /** Resolves true after one activation, false when canceled or unavailable. */
  activate(){
    if(this.state==='starting'&&this._activation)return this._activation.promise;
    if(this.state!=='waiting')return Promise.resolve(false);
    const token=++this._generation;
    this.button.disabled=true;this.button.setAttribute('aria-disabled','true');
    let resolve;
    const promise=new Promise(done=>{resolve=done;});
    const pending={token,promise,resolve,timer:0,animation:null};this._activation=pending;
    this._setState('starting');this._stopFrame();
    this.dispatchEvent(new CustomEvent('activating'));
    if(this._generation!==token||this.state!=='starting'||this._activation!==pending)return promise;
    const duration=this.reduced?0:Math.round(this.options.powerRippleDuration*1000);
    if(duration>0&&typeof this.ripple.animate==='function'){
      const peak=clamp(this.options.powerRippleStrength*.62);
      const pose=scale=>`translate(-50%,-50%) scale(${scale})`;
      try{
        this.element.dataset.rippleEngine='waapi';
        pending.animation=this.ripple.animate([
          {offset:0,transform:pose(.018),opacity:0},
          {offset:.12,transform:pose(.12),opacity:peak},
          {offset:.52,transform:pose(.55),opacity:peak*.55},
          {offset:.88,transform:pose(.95),opacity:peak*.12},
          {offset:1,transform:pose(1.04),opacity:0}
        ],{duration,easing:'linear',fill:'both'});
      }catch{this.element.dataset.rippleEngine='css';}
    }
    pending.timer=setTimeout(()=>{
      if(this._generation!==token||this.state!=='starting'||this._activation!==pending)return;
      try{pending.animation?.cancel();}catch{}
      this._activation=null;this._stopFrame();this._setState('hidden');
      resolve(true);this.dispatchEvent(new CustomEvent('activate'));
    },duration);
    return promise;
  }
  setOptions(options={}){
    if(this.state==='destroyed')return this;
    this.options=sanitizePowerOptions({...this.options,...options});
    this._resize();this._updateMotion();
    return this;
  }
  _resize(){
    if(this.state==='destroyed')return;
    const bounds=this.container.getBoundingClientRect();
    const short=Math.max(1,Math.min(bounds.width||1,bounds.height||1));
    this._radius=clamp(short*.07,32,54)*this.options.powerRadius;
    this._cssSize=Math.min(1500,Math.max(280,Math.ceil(this._radius*6.4)));
    const density=Math.min(window.devicePixelRatio||1,1.5,Math.sqrt(750000/(this._cssSize*this._cssSize)));
    const dimension=Math.max(1,Math.round(this._cssSize*density));
    this._density=dimension/this._cssSize;
    this.canvas.style.width=`${this._cssSize}px`;this.canvas.style.height=`${this._cssSize}px`;
    if(this.canvas.width!==dimension||this.canvas.height!==dimension){this.canvas.width=dimension;this.canvas.height=dimension;}
    const tint=[1,3,5].map(i=>parseInt(this.options.lightTint.slice(i,i+2),16));
    this._tint=tint.map(c=>Math.round(c+(255-c)*.76));
    this.element.style.setProperty('--ae-power-tint',this._tint.join(','));
    this.element.style.setProperty('--ae-power-aura-size',`${this._radius*5.2}px`);
    const diameter=Math.max(1,Math.hypot(bounds.width||1,bounds.height||1)*1.06);
    this.ripple.style.width=`${diameter}px`;this.ripple.style.height=`${diameter}px`;
    this.element.style.setProperty('--ae-power-ripple-duration',`${Math.round(this.options.powerRippleDuration*1000)}ms`);
    this.element.style.setProperty('--ae-power-ripple-peak',String(clamp(this.options.powerRippleStrength*.62)));
    this.aura.style.opacity=String(clamp(this.options.powerBrightness*(.25+.25*this.options.powerBloom)));
    if(this._visible()&&!document.hidden)this._draw();
  }
  _stopFrame(){
    if(this._raf)cancelAnimationFrame(this._raf);
    this._raf=0;this._lastFrame=null;
  }
  _updateMotion(){
    if(this.state==='destroyed')return;
    this.element.dataset.reducedMotion=String(this.reduced);
    if(!this._visible()||document.hidden){this._stopFrame();return;}
    this._draw();
    if(this.reduced||!this.ctx||this.state!=='waiting'){this._stopFrame();return;}
    if(!this._raf)this._raf=requestAnimationFrame(this._frame);
  }
  _frame(now){
    this._raf=0;
    if(this.state!=='waiting'||document.hidden||this.reduced||!this.ctx)return;
    if(this._lastFrame===null)this._lastFrame=now;
    const elapsed=now-this._lastFrame;
    // Never draw more than 30 frames/second, even on a high-refresh display.
    if(elapsed>=1000/30){
      this._clock+=Math.min(elapsed,150)/1000;this._lastFrame=now;this._draw();
    }
    if(this.state==='waiting'&&!document.hidden&&!this.reduced&&this.ctx)this._raf=requestAnimationFrame(this._frame);
  }
  _colour(alpha,white=0){
    const tint=this._tint||[238,244,255];
    return `rgba(${tint.map(c=>Math.round(c+(255-c)*white)).join(',')},${clamp(alpha)})`;
  }
  _halo(radius,stops,energy){
    const ctx=this.ctx,gradient=ctx.createRadialGradient(0,0,0,0,0,radius);
    for(const [position,alpha,white=0]of stops)gradient.addColorStop(position,this._colour(alpha*energy,white));
    ctx.fillStyle=gradient;ctx.fillRect(-radius,-radius,radius*2,radius*2);
  }
  _draw(){
    if(!this.ctx||!this._visible()||document.hidden||this.state==='destroyed')return;
    try{
      const ctx=this.ctx,o=this.options,r=this._radius||100;
      const time=this.reduced?0:this._clock;
      const shimmer=this.reduced?1:1+o.powerFlicker*.4*(.62*(noise(time*.72)-.5)+.28*(noise(time*1.63+19)-.5)+.10*(noise(time*2.83+47)-.5));
      const energy=o.powerBrightness*shimmer;
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
      if(energy<=0)return;
      ctx.setTransform(this._density,0,0,this._density,this.canvas.width/2,this.canvas.height/2);
      ctx.globalCompositeOperation='lighter';ctx.globalAlpha=1;
      this._halo(r*2.65,[[0,.12,.5],[.19,.060,.2],[.48,.014,0],[.80,.001,0],[1,0,0]],energy*o.powerBloom);
      this._halo(r*1.55,[[0,.23,.8],[.25,.13,.6],[.56,.032,.25],[1,0,0]],energy*(.74+.26*o.powerBloom));
      const rotation=time*TAU*o.powerRotation;
      for(let i=0;i<26;i++){
        const seed=hash(i+3),angle=i*TAU/26+(seed-.5)*.12+rotation;
        const breathe=this.reduced?1:1+.035*o.powerFlicker*Math.sin(time*.58+i*2.13);
        const length=r*(1+1.05*hash(i+71))*breathe;
        const width=r*(.035+.040*hash(i+131))*(.9+.1*o.powerBloom);
        const strength=(.48+.52*hash(i+211))*(.72+.28*Math.cos(i*.71))*energy*.72;
        ctx.save();ctx.rotate(angle);ctx.scale(length,width);
        const ray=ctx.createRadialGradient(.22,0,0,.22,0,1);
        ray.addColorStop(0,this._colour(.115*strength,.5));
        ray.addColorStop(.23,this._colour(.075*strength,.25));
        ray.addColorStop(.59,this._colour(.023*strength,0));
        ray.addColorStop(1,this._colour(0,0));
        ctx.fillStyle=ray;ctx.fillRect(0,-1.15,1.24,2.3);ctx.restore();
      }
      this._halo(r*.56,[[0,.12,.95],[.35,.045,.65],[1,0,0]],energy);
    }catch{
      // Rendering must never prevent someone from turning the computer on.
      this.ctx=null;this.element.dataset.renderer='css';this._stopFrame();
    }
  }
  destroy(){
    if(this.state==='destroyed')return;
    this._generation++;this._cancelActivation();this._stopFrame();
    this._observer?.disconnect();this._abort.abort();
    if(!this._motion.removeEventListener)this._motion.removeListener(this._onMotionChange);
    this._setState('destroyed');this.element.remove();
    this.canvas.width=0;this.canvas.height=0;this.ctx=null;
  }
}
