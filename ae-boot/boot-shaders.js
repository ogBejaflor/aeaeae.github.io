// Original, procedural WebGL shaders. No generated imagery or prerecorded footage.
export const vertexShader = `
attribute vec2 position;
varying vec2 vUv;
void main(){vUv=position*.5+.5;gl_Position=vec4(position,0.,1.);}
`;

export const sceneShader = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform sampler2D uLogo;
uniform vec2 uTextureSize;
uniform float uSdfScale;
uniform float uTime;
uniform float uClock;
uniform float uGlow;
uniform float uBloomRadius;
uniform float uLightIntensity;
uniform float uLightBloom;
uniform float uLightRadius;
uniform float uLightRotation;
uniform float uRayLength;
uniform float uRayStrength;
uniform vec3 uLightTint;
uniform float uStarSize;
uniform float uStarThinness;
uniform float uStarAspect;
uniform float uSpin;
uniform float uStarBloom;
uniform float uStarBrightness;
uniform float uStreakLength;
uniform float uDissolveDuration;
uniform float uDiffusion;
uniform float uSize;
uniform float uBevel;
uniform float uDepth;
uniform float uMetalExposure;
uniform float uReflectionSoftness;
uniform float uLogoTilt;
uniform float uSweepWidth;
uniform float uSweepBrightness;
uniform float uGlintStrength;
uniform vec4 uGlints[12];
uniform float uReduced;
uniform vec2 uPointer;
const float PI=3.141592653589793;

float ease(float a,float b,float t){float x=clamp((t-a)/(b-a),0.,1.);return x*x*x*(x*(x*6.-15.)+10.);}
mat2 rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,-s,0.,s,c);}
mat3 ry(float a){float c=cos(a),s=sin(a);return mat3(c,0.,s,0.,1.,0.,-s,0.,c);}
mat3 rz(float a){float c=cos(a),s=sin(a);return mat3(c,-s,0.,s,c,0.,0.,0.,1.);}
float gauss(float x,float w){return exp(-x*x/max(w*w,.00000001));}
float handoffEnd(){return 3.78+1.35*uDissolveDuration;}
mat3 logoPose(float t){
  float settle=1.-ease(4.1,7.7,t);
  float yaw=-uLogoTilt*PI/180.*settle+(uReduced>.5?0.:uPointer.x*.06);
  float pitch=.10*settle-(uReduced>.5?0.:uPointer.y*.035);
  return rz(.015*settle)*rx(pitch)*ry(yaw);
}
float reflectionWidth(float coordinate,float width){
#ifdef GL_OES_standard_derivatives
  vec2 footprint=vec2(dFdx(coordinate),dFdy(coordinate));
  // Convolve with a pixel's variance, not an arbitrary material blur. This
  // integrates reflections narrower than a screen pixel without losing energy.
  float variance=dot(footprint,footprint);
  // A silhouette's inactive helper lane can have an undefined derivative.
  // Reject nonfinite lanes before they enter lighting and tone mapping.
  if(!(variance>=0.&&variance<100000000.))return width;
  float filtered=sqrt(width*width+variance/6.);
  return filtered>=width?filtered:width;
#else
  return width;
#endif
}
float reflectedGaussian(float coordinate,float width){
  float filtered=reflectionWidth(coordinate,width);
  return gauss(coordinate,filtered)*width/filtered;
}
float reflectedPanel(float coordinate,float width,float power){
  float filtered=reflectionWidth(coordinate,width);
  return exp(-pow(abs(coordinate/filtered),power))*width/filtered;
}

float decodedDistance(vec2 uv){
  vec2 rg=texture2D(uLogo,uv).rg;
  return ((dot(rg,vec2(65280.,255.))/65535.)-.5)*128.;
}
float filteredDistance(vec2 uv){
  // Decode integer texels before interpolation. The two channels are a single
  // numerical value, never independently filtered or interpreted as colour.
  vec2 pixel=uv*uTextureSize-.5,base=floor(pixel),f=fract(pixel);
  vec2 stepSize=1./uTextureSize,p=(base+.5)*stepSize;
  float a=decodedDistance(p),b=decodedDistance(p+vec2(stepSize.x,0.));
  float c=decodedDistance(p+vec2(0.,stepSize.y)),d=decodedDistance(p+stepSize);
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
vec2 logoDimensions(){return vec2(4.65,4.65*uTextureSize.y/uTextureSize.x)*uSize;}
float distance2D(vec2 p){
  vec2 size=logoDimensions(),uv=p/size+.5;
  vec2 outside=max(abs(p)-size*.5,vec2(0.));
  if(max(abs(uv.x-.5),abs(uv.y-.5))>.499)return length(outside)+.025;
  return filteredDistance(uv)*size.x*max(uSdfScale,1.)/uTextureSize.x;
}
float bevelRadius(){return min(.047*uBevel,.098*uDepth*.90)*uSize;}
float domeHeight(float d){return .024*uSize*(1.-exp(min(d,0.)*20./uSize));}
float frontSurfaceHeight(vec2 p){
  float d=distance2D(p),bevel=bevelRadius();
  float shoulder=clamp(d+bevel,0.,bevel*.9999);
  return .098*uDepth*uSize+domeHeight(d)-bevel+sqrt(max(0.,bevel*bevel-shoulder*shoulder));
}
float logoDistance(vec3 p){
  float d=distance2D(p.xy),bevel=bevelRadius();
  vec2 w=vec2(d+bevel,abs(p.z)-(.098*uDepth*uSize+domeHeight(d)-bevel));
  return min(max(w.x,w.y),0.)+length(max(w,0.))-bevel;
}
vec3 objectNormal(vec3 p){
  // Differentiate the rounded extrusion analytically. Only its underlying
  // smooth, continuously fitted two-dimensional distance field is sampled.
  float d=distance2D(p.xy),bevel=bevelRadius();
  float h=4.65*uSize/uTextureSize.x*2.;
  vec2 gradient=vec2(distance2D(p.xy+vec2(h,0.))-distance2D(p.xy-vec2(h,0.)),
                     distance2D(p.xy+vec2(0.,h))-distance2D(p.xy-vec2(0.,h)))/(2.*h);
  vec2 w=vec2(d+bevel,abs(p.z)-(.098*uDepth*uSize+domeHeight(d)-bevel));
  vec2 positive=max(w,0.);
  vec2 partial=length(positive)>.0000001?normalize(positive):(w.x>w.y?vec2(1.,0.):vec2(0.,1.));
  float domeSlope=d<0.?-.48*exp(d*20./uSize):0.;
  return normalize(vec3((partial.x-partial.y*domeSlope)*gradient,partial.y*sign(p.z)));
}

vec3 chrome(vec3 p,vec3 n,vec3 rd,float t){
  vec3 r=reflect(rd,n);
  float softness=clamp(uReflectionSoftness,0.,1.);
  float spread=1.+softness*1.5;
  float sky=ease(-.12-.06*softness,.64+.08*softness,r.y);
  vec3 env=mix(vec3(.025,.027,.033),vec3(.33,.51,.76),sky);
  env+=vec3(.64,.74,.90)*reflectedGaussian(r.y-.53,.32+.10*softness)*.72;
  env*=1.-.86*reflectedGaussian(r.y+.07,.09+.07*softness);
  if(r.z>.015){
    vec3 hit=p+r*((3.5-p.z)/r.z);
    float power=mix(6.,3.,softness);
    float upper=reflectedPanel(hit.y-2.05,1.7+.25*softness,power);
    float upperWidth=reflectedPanel(hit.x,7.,power+2.);
    env+=vec3(.77,.88,1.)*upper*upperWidth*1.55;
    env+=vec3(.91,.95,1.)*reflectedGaussian(hit.y-.32,.095*spread)*reflectedPanel(hit.x,5.,power+2.)*.85;
    env+=vec3(.85,.82,.79)*reflectedGaussian(hit.y+1.42,.25*spread)*.65;
    env+=vec3(.7,.80,.97)*reflectedGaussian(hit.x+4.4,.36*spread)*.95;
    env+=vec3(.93,.94,1.)*reflectedGaussian(hit.x-4.8,.5*spread)*.75;
    float sweepX=mix(-6.,6.,ease(4.45,7.40,t));
    float sweep=reflectedGaussian(hit.x-sweepX,.47*uSweepWidth*(1.+softness*.5))*reflectedPanel(hit.y,4.,power);
    float sweepOn=ease(4.25,4.70,t)*(1.-ease(7.30,7.75,t));
    env+=vec3(.92,.96,1.)*sweep*4.4*sweepOn*uSweepBrightness;
    // A broad reflected fill keeps moving while the flare disperses. It hands
    // light to the metal before the narrower studio sweep reaches the letters.
    float bridge=ease(3.92,4.22,t)*(1.-ease(handoffEnd()-.10,handoffEnd()+.80,t));
    float bridgeX=mix(-3.5,3.5,ease(3.92,handoffEnd()+.35,t));
    float fill=reflectedGaussian(hit.x-bridgeX,2.15+.35*uDiffusion)*reflectedPanel(hit.y,4.,power);
    env+=vec3(.55,.68,.92)*fill*.38*bridge;
  }
  float ambient=.055+.30*ease(3.92,min(5.25,handoffEnd()),t)+.645*ease(5.0,7.15,t);
  float fresnel=.72+.28*pow(1.-max(dot(n,-rd),0.),5.);
  return env*ambient*fresnel*uMetalExposure;
}

vec3 background(vec2 q,float t){
  float birth=ease(.55,1.85,t),departure=1.-ease(4.05,5.85,t);
  float energy=birth*departure*uLightIntensity;
  if(energy<.00001)return vec3(0.);
  float radius=max(uLightRadius,.05);
  vec2 p=q/radius;
  float r=length(p);
  // Rotate the complete asymmetric fan in real seconds, independently of the
  // duration remapping. A stronger sector makes its motion easy to see.
  float a=atan(p.y,p.x)-uClock*2.*PI*uLightRotation;
  float fan=.30+.70*pow(.5+.5*cos(a-.45),3.);
  float rays=pow(max(0.,sin(a*13.+.4)),16.);
  rays+=.45*pow(max(0.,sin(a*23.+1.2)),24.);
  rays+=.25*pow(max(0.,sin(a*37.-.7)),32.);
  float shaft=rays*fan*exp(-r*4.8/max(uRayLength,.1))*ease(.006,.045,r)*.25*uRayStrength;
  float broad=.10*exp(-r*r/(.016+.010*uBloomRadius));
  float mist=.020*exp(-r*5./max(.5,uBloomRadius));
  vec3 tint=mix(uLightTint,vec3(1.),.12);
  vec3 c=tint*(shaft+(broad+mist)*uGlow*uLightBloom)*energy;
  c+=mix(uLightTint,vec3(1.),.65)*gauss(r,.0038)*energy*1.2;
  return c;
}

vec3 star(vec2 q,float t){
  float show=ease(1.50,2.18,t),dissolve=ease(3.78,handoffEnd(),t);
  if(show<.001||dissolve>.9999)return vec3(0.);
  float reach=(mix(.012,.255,ease(1.55,4.12,t))+.14*ease(4.03,4.61,t))*uStarSize;
  reach*=1.+.18*dissolve*uDiffusion;
  // Reserve part of the selected rotation for the handoff. The core is never
  // held still while it is bright, and the total selected turn count is kept.
  float turn=.82*ease(1.65,4.52,t)+.18*dissolve;
  float angle=-.42+uSpin*PI*2.5*turn;
  vec2 p=rot(angle)*q;
  float aspect=max(uStarAspect,.1);
  p/=vec2(inversesqrt(aspect),sqrt(aspect));
  float thin=clamp(uStarThinness,.12,.65);
  vec2 ap=abs(p)/max(reach,.001);
  float f=pow(ap.x,thin)+pow(ap.y,thin)-1.;
  float pixel=1./min(uResolution.x,uResolution.y);
  float aa=1.6*pixel/max(reach,.015);
  float body=1.-smoothstep(-aa,aa,f);
  float lengthScale=reach*1.4*max(uStreakLength,.1);
  float needle=gauss(p.x,max(pixel*.44,reach*.0025))*exp(-abs(p.y)/lengthScale);
  needle+=gauss(p.y,max(pixel*.44,reach*.0025))*exp(-abs(p.x)/lengthScale);
  float core=gauss(length(q),max(pixel*.8,reach*.018));
  float bloomWidth=reach*.018*max(uBloomRadius,.1)*(1.+7.*dissolve*uDiffusion);
  float narrowGlow=gauss(p.x,bloomWidth)*exp(-abs(p.y)/(lengthScale*.8));
  narrowGlow+=gauss(p.y,bloomWidth)*exp(-abs(p.x)/(lengthScale*.8));
  float halo=gauss(length(q),reach*(.48+.32*uBloomRadius)+.12*dissolve*uDiffusion);
  vec3 tint=mix(uLightTint,vec3(1.),.32);
  float remaining=1.-dissolve;
  vec3 c=vec3(1.)*(body*1.45*pow(remaining,1.7)+needle*.95*pow(remaining,1.15)+core*1.25*pow(remaining,2.2))*uStarBrightness;
  float spreadingEnergy=pow(remaining,.72)/(1.+1.8*dissolve*uDiffusion);
  c+=tint*(narrowGlow*.14+halo*(.055+.045*sin(PI*dissolve)))*uStarBloom*uGlow*spreadingEnergy;
  return c*show;
}

vec3 tinyGlint(vec2 q,vec2 at,float amount,float size){
  vec2 p=(q-at)/max(size,.05);
  float core=gauss(length(p),.0022);
  float ray=gauss(p.x,.0009)*exp(-abs(p.y)/.025)+gauss(p.y,.0009)*exp(-abs(p.x)/.031);
  float halo=gauss(length(p),.018*uBloomRadius)*.12;
  return mix(uLightTint,vec3(1.),.30)*(core+ray*.6+halo*uGlow)*amount*uGlintStrength;
}

void main(){
  float t=uReduced>.5?8.5:uTime;
  vec2 q=(vUv-.5)*uResolution/min(uResolution.x,uResolution.y);
  vec3 c=background(q,t);
  if(t>3.92){
    float reveal=ease(3.92,3.92+.70*uDissolveDuration,t);
    mat3 worldToLocal=logoPose(t);
    vec3 ro=vec3(0.,0.,7.),rd=normalize(vec3(q*5.8,-7.));
    vec3 lro=worldToLocal*ro,lrd=worldToLocal*rd;
    vec3 bounds=vec3(logoDimensions()*.5,.098*uDepth*uSize+.03*uSize);
    vec3 inv=1./(lrd+vec3(.00000001));
    vec3 a=(-bounds-lro)*inv,b=(bounds-lro)*inv;
    vec3 near3=min(a,b),far3=max(a,b);
    float start=max(0.,max(near3.x,max(near3.y,near3.z)));
    float end=min(far3.x,min(far3.y,far3.z));
    if(end>=start){
      float travel=start;
      bool hit=false;
      vec3 lp=vec3(0.);
      for(int i=0;i<100;i++){
        lp=lro+lrd*travel;
        float d=logoDistance(lp);
        if(d<.00014*uSize){hit=true;break;}
        travel+=max(d*.74,.000035*uSize);
        if(travel>end+.001)break;
      }
      if(hit){
        // Resolve the actual surface rather than shading the variable stopping
        // shell of sphere tracing, which creates speckled chrome highlights.
        for(int j=0;j<3;j++){
          lp=lro+lrd*travel;
          float d=logoDistance(lp),h=.00025*uSize;
          float derivative=(logoDistance(lp+lrd*h)-logoDistance(lp-lrd*h))/(2.*h);
          if(abs(derivative)>.03)travel-=clamp(d/derivative,-.004*uSize,.004*uSize);
        }
        lp=lro+lrd*travel;
        vec3 ln=objectNormal(lp);
        vec3 n=normalize(vec3(dot(worldToLocal[0],ln),dot(worldToLocal[1],ln),dot(worldToLocal[2],ln)));
        vec3 p=ro+rd*travel;
        c=mix(c,chrome(p,n,rd,t),reveal);
      }
    }
  }
  c+=star(q,t);
  if(uReduced<.5){
    mat3 pose=logoPose(t);
    for(int g=0;g<12;g++){
      vec4 glint=uGlints[g];
      if(glint.z>.0001){
        vec3 local=vec3(glint.xy*uSize,0.);
        local.z=frontSurfaceHeight(local.xy);
        vec3 world=vec3(dot(pose[0],local),dot(pose[1],local),dot(pose[2],local));
        float perspective=7./(7.-world.z);
        vec2 at=world.xy*perspective/5.8;
        c+=tinyGlint(q,at,glint.z,glint.w*uSize*perspective);
      }
    }
  }
  c=max(c,vec3(0.));
  c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);
  float opacity=uReduced>.5?ease(0.,.6,uTime):1.;
  gl_FragColor=vec4(pow(clamp(c,0.,1.),vec3(1./2.2))*opacity,1.);
}
`;

export const bloomShader = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform vec2 uStep;
uniform float uThreshold;
vec3 pick(vec2 p){vec3 c=texture2D(uImage,p).rgb;return c*smoothstep(uThreshold,uThreshold+.22,max(c.r,max(c.g,c.b)));}
void main(){
 vec3 c=pick(vUv)*.227027;
 c+=(pick(vUv+uStep*1.384615)+pick(vUv-uStep*1.384615))*.316216;
 c+=(pick(vUv+uStep*3.230769)+pick(vUv-uStep*3.230769))*.070270;
 gl_FragColor=vec4(c,1.);
}
`;
export const compositeShader = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform sampler2D uBloom;
uniform float uGlow;
void main(){
 vec3 c=texture2D(uImage,vUv).rgb,b=texture2D(uBloom,vUv).rgb;
 gl_FragColor=vec4(clamp(c+b*.25*uGlow,0.,1.),1.);
}
`;
