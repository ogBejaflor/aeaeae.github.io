// A complete procedural renderer for browsers without a WebGL context.
// PNG inputs are signed distance fields: shape data, never a chrome photograph.
import { DEFAULT_OPTIONS } from './boot-options.js';
const TAU=Math.PI*2;
const asset=name=>new URL(`./assets/${name}`,import.meta.url).href;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=(a,b,t)=>{const x=clamp((t-a)/(b-a));return x*x*x*(x*(x*6-15)+10);};
const gauss=(x,w)=>Math.exp(-x*x/Math.max(w*w,1e-10));
const reflectedGaussian=(x,w,variance)=>{const filtered=Math.sqrt(w*w+variance/6);return gauss(x,filtered)*w/filtered;};
const reflectedPanel=(x,w,power,variance)=>{const filtered=Math.sqrt(w*w+variance/6);return Math.exp(-Math.pow(Math.abs(x/filtered),power))*w/filtered;};
const createCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const colour=(tint,white,alpha)=>`rgba(${tint.map(c=>Math.round(c+(255-c)*white)).join(',')},${clamp(alpha)})`;
const TONE=new Uint8ClampedArray(16385);
for(let i=0;i<TONE.length;i++){
  const c=i/1024,m=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);
  TONE[i]=Math.round(Math.pow(clamp(m),1/2.2)*255);
}
const tone=c=>TONE[Math.min(16384,Math.max(0,Math.round(c*1024)))];

export class CanvasBootRenderer {
  constructor(canvas){
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});
    if(!this.ctx)throw new Error('Canvas drawing is unavailable.');
    this.models={};this.pending=new Set();this.destroyed=false;
  }
  async init(){
    const [compact,full]=await Promise.all([this.loadModel(asset('logo-compact-sdf.png')),this.loadModel(asset('logo-sdf-with-tm.png'))]);
    if(!this.destroyed)this.models={compact,full};
    return this;
  }
  loadModel(url){
    return new Promise((resolve,reject)=>{
      const image=new Image();
      const cancel=()=>{image.onload=null;image.onerror=null;image.src='';reject(new Error('Renderer was disposed.'));};
      this.pending.add(cancel);
      image.onload=()=>{
        this.pending.delete(cancel);
        if(this.destroyed){reject(new Error('Renderer was disposed.'));return;}
        try{resolve(this.makeModel(image));}catch(error){reject(error);}
      };
      image.onerror=()=>{this.pending.delete(cancel);reject(new Error('The numerical logo texture could not be loaded.'));};
      image.src=url;
    });
  }
  makeModel(image){
    const w=image.width,h=image.height;
    // New textures have two samples per original artwork pixel; the encoded
    // distance remains measured in original pixels. Old assets also work.
    const sourceWidth=w>1000?w/2:w,unit=4.65/w,encodedUnit=4.65/sourceWidth;
    const source=createCanvas(w,h),read=source.getContext('2d',{willReadFrequently:true});
    read.drawImage(image,0,0);
    const input=read.getImageData(0,0,w,h).data,distances=new Float32Array(w*h);
    let count=0;
    for(let i=0;i<w*h;i++){
      distances[i]=((input[i*4]*256+input[i*4+1])/65535-.5)*128*encodedUnit;
      if(distances[i]<unit*.65)count++;
    }
    const indexes=new Uint32Array(count),geometry=new Float32Array(count*5),lookup=new Int32Array(w*h);
    lookup.fill(-1);
    const base=new Float32Array(count*3),hitX=new Float32Array(count),hitY=new Float32Array(count),sweepWeight=new Float32Array(count);
    const reflectedY=new Float32Array(count),fresnel=new Float32Array(count),sweepVariance=new Float32Array(count),hasPlane=new Uint8Array(count);
    const body=createCanvas(w,h),bodyContext=body.getContext('2d');
    const glow=createCanvas(w,h),glowContext=glow.getContext('2d');
    const side=createCanvas(w,h),sideContext=side.getContext('2d');
    const pixels=bodyContext.createImageData(w,h),glowPixels=glowContext.createImageData(w,h),sidePixels=sideContext.createImageData(w,h);
    let k=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const index=y*w+x,d=distances[index];
      if(d>=unit*.65)continue;
      indexes[k]=index*4;
      lookup[index]=k;
      geometry[k*5]=d;
      geometry[k*5+1]=(distances[y*w+Math.min(w-1,x+2)]-distances[y*w+Math.max(0,x-2)])/(4*unit);
      geometry[k*5+2]=(distances[Math.max(0,y-2)*w+x]-distances[Math.min(h-1,y+2)*w+x])/(4*unit);
      geometry[k*5+3]=(x+.5-w/2)*unit;
      geometry[k*5+4]=(h/2-y-.5)*unit;
      const alpha=Math.round(clamp(.65-d/unit)*255);
      pixels.data[index*4+3]=alpha;
      sidePixels.data[index*4]=32;sidePixels.data[index*4+1]=36;sidePixels.data[index*4+2]=44;sidePixels.data[index*4+3]=alpha;
      k++;
    }
    sideContext.putImageData(sidePixels,0,0);source.width=0;
    const model={w,h,body,bodyContext,glow,glowContext,side,indexes,geometry,lookup,base,hitX,hitY,reflectedY,fresnel,sweepVariance,hasPlane,sweepWeight,pixels,glowPixels,lastShaded:-100};
    this.material(model,DEFAULT_OPTIONS);
    return model;
  }
  material(model,o){
    const renderedWidth=4.65/5.8*Math.min(this.canvas.width,this.canvas.height)*o.size;
    const footprint=Math.max(1,model.w/Math.max(renderedWidth,1));
    const signature=[o.bevel,o.depth,o.reflectionSoftness,o.size,footprint.toFixed(3)].join('|');
    if(model.materialSignature===signature)return;
    model.materialSignature=signature;model.lastShaded=-100;
    const bevel=Math.min(.047*o.bevel,.098*o.depth*.90)*o.size,halfDepth=.098*o.depth*o.size;
    const softness=clamp(o.reflectionSoftness),spread=1+softness*1.5,power=6-softness*3;
    model.softness=softness;
    // First calculate the reflected directions and the intersection of each
    // reflected ray with the real, finite studio-light plane.
    for(let k=0;k<model.indexes.length;k++){
      const d=model.geometry[k*5]*o.size,dx=model.geometry[k*5+1],dy=model.geometry[k*5+2];
      const inside=Math.min(d,0),exp=Math.exp(inside*20/o.size);
      const dome=.024*o.size*(1-exp),shoulder=clamp(d+bevel,0,bevel*.9999);
      const arc=Math.sqrt(Math.max(1e-9,bevel*bevel-shoulder*shoulder));
      const z=halfDepth+dome-bevel+arc;
      const slope=(d<0?-.48*exp:0)-(d>-bevel?shoulder/arc:0);
      let nx=-slope*dx,ny=-slope*dy,nz=1;
      let length=Math.hypot(nx,ny,nz);nx/=length;ny/=length;nz/=length;
      const px=model.geometry[k*5+3]*o.size,py=model.geometry[k*5+4]*o.size;
      let vx=px,vy=py,vz=z-7;
      length=Math.hypot(vx,vy,vz);vx/=length;vy/=length;vz/=length;
      const dot=vx*nx+vy*ny+vz*nz,rx=vx-2*dot*nx,ry=vy-2*dot*ny,rz=vz-2*dot*nz;
      model.reflectedY[k]=ry;
      model.fresnel[k]=.72+.28*Math.pow(1-Math.max(-dot,0),5);
      model.hasPlane[k]=rz>.015?1:0;
      if(rz>.015){
        const travel=(3.5-z)/rz;
        model.hitX[k]=px+rx*travel;model.hitY[k]=py+ry*travel;
      }else{model.hitX[k]=100;model.hitY[k]=100;}
    }
    // Local derivatives measure the pixel footprint in reflected-light space.
    // Integrating narrow highlights over that area removes dotted specular
    // aliases while preserving their energy and the exact silhouette.
    const variance=(field,k)=>{
      const at=model.indexes[k]/4,center=field[k],x=at%model.w;
      const left=x>0?model.lookup[at-1]:-1,right=x+1<model.w?model.lookup[at+1]:-1;
      const up=at>=model.w?model.lookup[at-model.w]:-1,down=at+model.w<model.lookup.length?model.lookup[at+model.w]:-1;
      const dx=left>=0&&right>=0?(field[right]-field[left])*.5:right>=0?field[right]-center:left>=0?center-field[left]:0;
      const dy=up>=0&&down>=0?(field[down]-field[up])*.5:down>=0?field[down]-center:up>=0?center-field[up]:0;
      return (dx*dx+dy*dy)*footprint*footprint;
    };
    for(let k=0;k<model.indexes.length;k++){
      const ry=model.reflectedY[k],directionVariance=variance(model.reflectedY,k);
      const sky=ease(-.12-.06*softness,.64+.08*softness,ry);
      let red=.025+(.33-.025)*sky,green=.027+(.51-.027)*sky,blue=.033+(.76-.033)*sky;
      const skyPanel=reflectedGaussian(ry-.53,.32+.10*softness,directionVariance)*.72;
      red+=.64*skyPanel;green+=.74*skyPanel;blue+=.90*skyPanel;
      const horizon=1-.86*reflectedGaussian(ry+.07,.09+.07*softness,directionVariance);
      red*=horizon;green*=horizon;blue*=horizon;
      let vertical=0;
      const xVariance=variance(model.hitX,k),yVariance=variance(model.hitY,k);
      model.sweepVariance[k]=xVariance;
      if(model.hasPlane[k]){
        const x=model.hitX[k],y=model.hitY[k];
        const upper=reflectedPanel(y-2.05,1.7+.25*softness,power,yVariance)*reflectedPanel(x,7,power+2,xVariance)*1.55;
        red+=.77*upper;green+=.88*upper;blue+=upper;
        const line=reflectedGaussian(y-.32,.095*spread,yVariance)*reflectedPanel(x,5,power+2,xVariance)*.85;
        red+=.91*line;green+=.95*line;blue+=line;
        const lower=reflectedGaussian(y+1.42,.25*spread,yVariance)*.65;
        red+=.85*lower;green+=.82*lower;blue+=.79*lower;
        const left=reflectedGaussian(x+4.4,.36*spread,xVariance)*.95,right=reflectedGaussian(x-4.8,.5*spread,xVariance)*.75;
        red+=.7*left+.93*right;green+=.80*left+.94*right;blue+=.97*left+right;
        vertical=reflectedPanel(y,4,power,yVariance);
      }
      const fresnel=model.fresnel[k];
      model.base[k*3]=red*fresnel;model.base[k*3+1]=green*fresnel;model.base[k*3+2]=blue*fresnel;
      model.sweepWeight[k]=vertical*fresnel;
    }
  }
  shade(model,t,o){
    this.material(model,o);
    const lightingTime=Math.min(t,7.8),signature=[o.metalExposure,o.sweepWidth,o.sweepBrightness,o.dissolveDuration,o.diffusion].join('|');
    if(signature===model.shadeSignature&&Math.abs(lightingTime-model.lastShaded)<1/45)return;
    model.shadeSignature=signature;model.lastShaded=lightingTime;
    const handoffEnd=3.78+1.35*o.dissolveDuration;
    const ambient=(.055+.30*ease(3.92,Math.min(5.25,handoffEnd),t)+.645*ease(5,7.15,t))*o.metalExposure;
    const sweepX=-6+12*ease(4.45,7.40,t);
    const sweepOn=ease(4.25,4.70,t)*(1-ease(7.30,7.75,t))*4.4*o.sweepBrightness;
    const width=.47*o.sweepWidth*(1+model.softness*.5);
    const bridge=ease(3.92,4.22,t)*(1-ease(handoffEnd-.10,handoffEnd+.80,t));
    const bridgeX=-3.5+7*ease(3.92,handoffEnd+.35,t),bridgeWidth=2.15+.35*o.diffusion;
    const data=model.pixels.data,bright=model.glowPixels.data;
    for(let k=0;k<model.indexes.length;k++){
      const i=model.indexes[k],sweep=reflectedGaussian(model.hitX[k]-sweepX,width,model.sweepVariance[k])*model.sweepWeight[k]*sweepOn;
      const fill=reflectedGaussian(model.hitX[k]-bridgeX,bridgeWidth,model.sweepVariance[k])*model.sweepWeight[k]*.38*bridge;
      const r=tone((model.base[k*3]+.92*sweep+.55*fill)*ambient),g=tone((model.base[k*3+1]+.96*sweep+.68*fill)*ambient),b=tone((model.base[k*3+2]+sweep+.92*fill)*ambient);
      data[i]=r;data[i+1]=g;data[i+2]=b;
      bright[i]=r;bright[i+1]=g;bright[i+2]=b;bright[i+3]=Math.round(clamp((Math.max(r,g,b)-190)/65)*data[i+3]);
    }
    model.bodyContext.putImageData(model.pixels,0,0);model.glowContext.putImageData(model.glowPixels,0,0);
  }
  radial(radius,stops){
    const gradient=this.ctx.createRadialGradient(0,0,0,0,0,Math.max(radius,.1));
    for(const [at,color]of stops)gradient.addColorStop(at,color);
    this.ctx.fillStyle=gradient;this.ctx.fillRect(-radius,-radius,radius*2,radius*2);
  }
  atmosphere(t,s,o,clock,tint){
    const ctx=this.ctx,envelope=ease(.55,1.85,t)*(1-ease(4.05,5.85,t));
    if(envelope<.001||o.lightIntensity<=0)return;
    const energy=envelope*o.lightIntensity,radius=o.lightRadius;
    const bloom=1-Math.exp(-energy*o.glow*o.lightBloom*.25);
    ctx.save();ctx.globalCompositeOperation='lighter';
    if(bloom>0){
      ctx.globalAlpha=bloom;
      const spread=.65+.35*o.bloomRadius;
      this.radial(s*.46*radius*spread,[[0,colour(tint,.65,.95)],[.15,colour(tint,.28,.59)],[.37,colour(tint,0,.28)],[.66,colour(tint,0,.065)],[1,colour(tint,0,0)]]);
      this.radial(s*.65*radius*spread,[[0,colour(tint,0,.12)],[.28,colour(tint,0,.045)],[1,colour(tint,0,0)]]);
    }
    ctx.globalAlpha=clamp(Math.pow(envelope,.65));
    ctx.save();ctx.rotate(-clock*TAU*o.lightRotation);
    for(let i=0;i<46;i++){
      const angle=i*TAU/46+Math.sin(i*17.17)*.095;
      const fan=.30+.70*Math.pow(.5+.5*Math.cos(angle-.45),3);
      const intensity=(1-Math.exp(-o.lightIntensity*o.rayStrength*.6))*fan;
      if(intensity<.001)continue;
      const length=s*(.25+.43*(.5+.5*Math.sin(i*12.3)))*o.rayLength*radius;
      const variation=.55+.45*(.5+.5*Math.sin(i*7.31));
      ctx.save();ctx.rotate(angle);ctx.globalAlpha*=intensity;
      const gradient=ctx.createLinearGradient(0,0,length,0);
      gradient.addColorStop(0,colour(tint,.35,0));gradient.addColorStop(.10,colour(tint,.35,.78*variation));
      gradient.addColorStop(.34,colour(tint,.08,.33*variation));gradient.addColorStop(.70,colour(tint,0,.09*variation));gradient.addColorStop(1,colour(tint,0,0));
      ctx.fillStyle=gradient;
      const width=length*(.003+.007*(.5+.5*Math.sin(i*19.1)));
      ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(length,-width);ctx.lineTo(length,width);ctx.closePath();ctx.fill();
      ctx.globalAlpha*=.45;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(length,-width*.32);ctx.lineTo(length,width*.32);ctx.closePath();ctx.fill();ctx.restore();
    }
    ctx.restore();ctx.globalAlpha=clamp(energy);
    this.radial(s*.012*radius,[[0,colour(tint,.94,1)],[.09,colour(tint,.8,.9)],[.38,colour(tint,.1,.18)],[1,colour(tint,0,0)]]);
    ctx.restore();
  }
  starPath(rx,ry,thin=.22){
    const ctx=this.ctx,power=2/clamp(thin,.12,.65);ctx.beginPath();
    for(let i=0;i<=192;i++){
      const angle=i*TAU/192,c=Math.cos(angle),s=Math.sin(angle);
      const x=Math.sign(c)*Math.pow(Math.abs(c),power)*rx,y=Math.sign(s)*Math.pow(Math.abs(s),power)*ry;
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.closePath();
  }
  star(t,s,o,tint){
    const show=ease(1.5,2.18,t),dissolve=ease(3.78,3.78+1.35*o.dissolveDuration,t),remaining=1-dissolve;
    if(show<.001||remaining<.0001)return;
    const ctx=this.ctx,reach=(.012+.243*ease(1.55,4.12,t)+.14*ease(4.03,4.61,t))*s*o.starSize*(1+.18*dissolve*o.diffusion);
    const aspect=Math.sqrt(o.starAspect),rx=reach/aspect,ry=reach*aspect;
    const brightness=1-Math.exp(-o.starBrightness*1.6);
    const bloom=(1-Math.exp(-o.glow*o.starBloom*o.starBrightness*.23))*Math.pow(remaining,.72)/(1+1.8*dissolve*o.diffusion);
    const diffuseBlend=ease(0,.22,dissolve);
    ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=show;
    if(bloom>0){
      ctx.save();ctx.globalAlpha*=bloom;
      this.radial(reach*(1.30+.65*o.bloomRadius)+.28*s*dissolve*o.diffusion,[[0,colour(tint,.55,.65)],[.23,colour(tint,.25,.26)],[.57,colour(tint,0,.065)],[1,colour(tint,0,0)]]);ctx.restore();
    }
    ctx.rotate(.42-o.spin*Math.PI*2.5*(.82*ease(1.65,4.52,t)+.18*dissolve));
    // Separate the sharp needle from its soft bloom. Master bloom at zero keeps
    // a true thin flare rather than removing the star's long diffraction rays.
    for(let axis=0;axis<4;axis++){
      ctx.save();ctx.rotate(axis*Math.PI/2);
      const axisScale=axis%2?aspect:1/aspect;
      const length=reach*2.5*o.streakLength*axisScale;
      const sharp=ctx.createLinearGradient(0,0,length,0);
      sharp.addColorStop(0,colour(tint,.98,brightness));sharp.addColorStop(.2,colour(tint,.72,brightness*.65));
      sharp.addColorStop(.52,colour(tint,.2,brightness*.22));sharp.addColorStop(1,colour(tint,0,0));
      ctx.save();ctx.globalAlpha*=Math.pow(remaining,1.15);
      ctx.fillStyle=sharp;
      const width=Math.max(.65,reach*.0035);
      ctx.beginPath();ctx.moveTo(0,-width);ctx.lineTo(length,0);ctx.lineTo(0,width);ctx.closePath();ctx.fill();
      ctx.restore();
      if(bloom>0){
        ctx.save();ctx.globalAlpha*=bloom;
        const spread=reach*.025*o.bloomRadius*(1+7*dissolve*o.diffusion);
        // Preserve the approved tight flare before the handoff. Its widening
        // emission then acquires soft falloff across the ray, without cut-out
        // triangular side edges.
        if(diffuseBlend<1){
          ctx.save();ctx.globalAlpha*=1-diffuseBlend;
          const soft=ctx.createLinearGradient(0,0,length,0);
          soft.addColorStop(0,colour(tint,.45,.65));soft.addColorStop(.25,colour(tint,.15,.28));soft.addColorStop(1,colour(tint,0,0));
          ctx.fillStyle=soft;
          ctx.beginPath();ctx.moveTo(0,-spread);ctx.lineTo(length,0);ctx.lineTo(0,spread);ctx.closePath();ctx.fill();ctx.restore();
        }
        if(diffuseBlend>0){
          ctx.save();ctx.globalAlpha*=diffuseBlend;
          ctx.scale(length,Math.max(1,spread*1.6));
          const mist=ctx.createRadialGradient(0,0,0,0,0,1);
          mist.addColorStop(0,colour(tint,.45,.65));mist.addColorStop(.18,colour(tint,.25,.49));
          mist.addColorStop(.42,colour(tint,.10,.21));mist.addColorStop(.72,colour(tint,0,.035));mist.addColorStop(1,colour(tint,0,0));
          ctx.fillStyle=mist;ctx.fillRect(0,-1,1,2);ctx.restore();
        }
        ctx.restore();
      }
      ctx.restore();
    }
    const sharpBloomCopies=1-ease(0,.12,dissolve);
    if(bloom>0&&sharpBloomCopies>0){
      ctx.save();ctx.globalAlpha*=bloom*sharpBloomCopies;
      ctx.shadowColor=colour(tint,.35,.9);ctx.shadowBlur=Math.min(120,reach*.18*o.bloomRadius*(1+3*dissolve*o.diffusion));
      this.starPath(rx,ry,o.starThinness);ctx.fillStyle=colour(tint,.65,.65);ctx.fill();
      ctx.shadowBlur=Math.min(65,reach*.055*o.bloomRadius*(1+3*dissolve*o.diffusion));ctx.fill();ctx.restore();
    }
    ctx.save();ctx.globalAlpha*=Math.pow(remaining,1.7);
    this.starPath(rx,ry,o.starThinness);
    const body=tone(1.45*o.starBrightness);ctx.fillStyle=`rgb(${body},${body},${body})`;ctx.fill();
    ctx.globalAlpha*=Math.pow(remaining,.5);
    this.radial(Math.max(1,reach*.07),[[0,'rgba(255,255,255,1)'],[.14,colour(tint,.9,.9)],[.48,colour(tint,.5,.2)],[1,colour(tint,0,0)]]);
    ctx.restore();
    ctx.restore();
  }
  glint(x,y,s,amount,o,tint,size=1){
    amount*=o.glintStrength;
    if(amount<.002)return;
    s*=size;
    const ctx=this.ctx;ctx.save();ctx.translate(x,y);ctx.globalCompositeOperation='lighter';ctx.globalAlpha*=clamp(amount);
    if(o.glow>0){
      ctx.save();ctx.globalAlpha*=1-Math.exp(-o.glow*.5);
      this.radial(s*.022*o.bloomRadius,[[0,colour(tint,.5,.8)],[.12,colour(tint,.1,.3)],[1,colour(tint,0,0)]]);ctx.restore();
    }
    ctx.shadowColor=colour(tint,.3,.8);ctx.shadowBlur=s*.005*o.bloomRadius*o.glow;
    this.starPath(s*.027,s*.022,.24);ctx.fillStyle='#f8fcff';ctx.fill();ctx.restore();
  }
  render(time,options={},pointer=[0,0],reduced=false,clock=time,glints=null){
    if(this.destroyed)return;
    const o={...DEFAULT_OPTIONS,...options},tint=rgb(o.lightTint);
    const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height,s=Math.min(w,h);
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';ctx.shadowBlur=0;
    ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);ctx.save();ctx.translate(w/2,h/2);
    const t=reduced?8.5:time;
    if(reduced)ctx.globalAlpha=ease(0,.6,time);else this.atmosphere(t,s,o,clock,tint);
    if(t>3.92){
      const model=o.trademark?this.models.full:this.models.compact;
      if(model){
        this.shade(model,t,o);
        const width=4.65/5.8*s*o.size,height=width*model.h/model.w,settle=1-ease(4.1,7.7,t);
        const yaw=-o.logoTilt*Math.PI/180*settle+(reduced?0:pointer[0]*.06),pitch=.10*settle-(reduced?0:pointer[1]*.035);
        ctx.save();ctx.globalAlpha*=ease(3.92,3.92+.70*o.dissolveDuration,t);ctx.rotate(-.015*settle);
        ctx.transform(Math.cos(yaw),Math.sin(yaw)*.025,Math.sin(pitch)*.12,Math.cos(pitch),0,0);
        ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
        const dx=-Math.sin(yaw)*s*.033*o.depth,dy=Math.sin(pitch)*s*.033*o.depth;
        if(Math.abs(dx)+Math.abs(dy)>.1)for(let layer=6;layer>0;layer--)ctx.drawImage(model.side,-width/2+dx*layer/6,-height/2+dy*layer/6,width,height);
        ctx.drawImage(model.body,-width/2,-height/2,width,height);
        if(o.glow>0&&'filter'in ctx){
          ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha*=1-Math.exp(-o.glow*.13);
          ctx.filter=`blur(${Math.max(2,s*.006*o.bloomRadius)}px)`;ctx.drawImage(model.glow,-width/2,-height/2,width,height);ctx.restore();
        }
        // The shared schedule contains actual contour anchors. Draw them in
        // the logo's own transformed coordinate system so no sparkle floats.
        if(!reduced&&glints){
          const scale=s/5.8*o.size;
          for(let i=0;i<Math.min(48,glints.length);i+=4){
            if(glints[i+2]>.0001)this.glint(glints[i]*scale,-glints[i+1]*scale,s,glints[i+2],o,tint,glints[i+3]*o.size);
          }
        }
        ctx.restore();
      }
    }
    if(!reduced){
      this.star(t,s,o,tint);
    }
    ctx.restore();
  }
  resize(){/* The owner sets the drawing buffer dimensions. */}
  destroy(){
    if(this.destroyed)return;this.destroyed=true;
    for(const cancel of this.pending)cancel();this.pending.clear();
    for(const model of Object.values(this.models)){model.body.width=0;model.glow.width=0;model.side.width=0;}
    this.models={};
  }
}
