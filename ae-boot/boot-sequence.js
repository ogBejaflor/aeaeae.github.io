import { vertexShader, sceneShader, bloomShader, compositeShader } from './boot-shaders.js';
import { BASE_DURATION, sanitizeOptions, sceneTime, colorVector } from './boot-options.js';
import { getEdgeGlints } from './boot-glints.js';

const localAsset = name => new URL(`./assets/${name}`, import.meta.url).href;

/** Drop-in, dependency-free boot overlay. All drawing is procedural WebGL. */
export class AEBootSequence extends EventTarget {
  constructor(container, options = {}) {
    super();
    this.container = container;
    this.options = sanitizeOptions(options);
    this.time = 0;
    this.playing = false;
    this.completed = false;
    this.destroyed = false;
    this.pointer = [0, 0];
    this.targetPointer = [0, 0];
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ae-boot-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.container.append(this.canvas);
    this.gl = this.canvas.getContext('webgl', { alpha: false, antialias: false,
      depth: false, stencil: false, powerPreference: 'high-performance' });
    this.container.dataset.renderer = this.gl ? 'webgl' : 'unavailable';
    this.abort = new AbortController();
    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(container);
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.useFallback('WebGL context was lost.');
    }, { signal: this.abort.signal });
    document.addEventListener('visibilitychange', () => {
      this.lastFrame = performance.now();
      if (!document.hidden && !this.raf) this.raf = requestAnimationFrame(this.frame);
    }, { signal: this.abort.signal });
    this.ready = this.initialize();
  }

  get duration() { return this.options.duration; }
  get currentTime() { return this.time / BASE_DURATION * this.duration; }
  get reduced() {
    return this.options.reducedMotion === 'auto' ? this.motionQuery.matches : !!this.options.reducedMotion;
  }

  async initialize() {
    if (!this.gl) { await this.useFallback('WebGL is unavailable.'); return this; }
    try {
      const gl = this.gl;
      this.derivatives=!!gl.getExtension('OES_standard_derivatives');
      this.scene = this.program(sceneShader);
      this.blur = this.program(bloomShader);
      this.composite = this.program(compositeShader);
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const [compact, full] = await Promise.all([
        this.loadTexture(localAsset('logo-compact-sdf.png')),
        this.loadTexture(localAsset('logo-sdf-with-tm.png'))
      ]);
      if (this.destroyed) { gl.deleteTexture(compact.texture); gl.deleteTexture(full.texture); return this; }
      this.logos = { compact, full };
      this.resize();
      this.render();
      this.dispatchEvent(new CustomEvent('ready'));
    } catch (error) {
      if (this.destroyed) return this;
      console.warn('æ boot fallback:', error.message);
      await this.useFallback(error.message);
    }
    return this;
  }

  program(fragment) {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(log);
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexShader);
    const pixel = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    gl.attachShader(program, vertex); gl.attachShader(program, pixel); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(pixel);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return { program, position: gl.getAttribLocation(program, 'position'), uniforms: {} };
  }

  loadTexture(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const gl = this.gl;
        // Power-on can be skipped while the logo images are still loading.
        // Settle the preload without touching a released WebGL context.
        if (this.destroyed || !gl) {
          reject(new Error('Logo texture loading was cancelled.'));
          return;
        }
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        this.textureParameters();
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        resolve({ texture, width: image.width, height: image.height });
      };
      image.onerror = () => reject(new Error('The logo texture could not be loaded.'));
      image.src = url;
    });
  }

  textureParameters() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  target(width, height) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.textureParameters();
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete drawing buffer.');
    return { texture, fbo, width, height };
  }

  resize() {
    if (this.destroyed) return;
    const bounds = this.container.getBoundingClientRect();
    // Render above CSS resolution even on a 1× screen: narrow chrome edges
    // need subpixel coverage before the browser resolves the canvas.
    const profiles={balanced:[1,2100000],high:[2,8400000],ultra:[3,12000000]};
    const [densityLimit,gpuPixelLimit]=profiles[this.options.quality];
    const pixelLimit=this.canvasRenderer?Math.min(gpuPixelLimit,3400000):gpuPixelLimit;
    const density = Math.min(densityLimit,Math.sqrt(pixelLimit / Math.max(bounds.width * bounds.height,1)));
    const width = Math.max(1, Math.round(bounds.width * density));
    const height = Math.max(1, Math.round(bounds.height * density));
    if (this.canvas.width === width && this.canvas.height === height && (this.targets||this.canvasRenderer)) return;
    this.canvas.width = width; this.canvas.height = height;
    if (this.canvasRenderer) { this.render(); return; }
    if (!this.gl || !this.logos || this.fallback) return;
    const gl = this.gl;
    this.targets?.forEach(t => { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.fbo); });
    const w = Math.max(1, Math.floor(width / 4)), h = Math.max(1, Math.floor(height / 4));
    this.targets = [this.target(width,height), this.target(w,h), this.target(w,h)];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.render();
  }

  bind(program, target = null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);
    gl.viewport(0,0,target?.width ?? this.canvas.width,target?.height ?? this.canvas.height);
    gl.useProgram(program.program);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.enableVertexAttribArray(program.position);
    gl.vertexAttribPointer(program.position,2,gl.FLOAT,false,0,0);
  }

  uniform(program, name, value, kind = '1f') {
    const gl = this.gl;
    if (!(name in program.uniforms)) program.uniforms[name] = gl.getUniformLocation(program.program, name);
    const location = program.uniforms[name];
    if (kind === '2f') gl.uniform2f(location, value[0], value[1]);
    else if (kind === '3f') gl.uniform3f(location, value[0], value[1], value[2]);
    else if (kind === '4fv') gl.uniform4fv(location, value);
    else if (kind === '1i') gl.uniform1i(location, value);
    else gl.uniform1f(location, value);
  }

  texture(texture, unit = 0) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,texture);
  }

  render() {
    const renderedTime=this.reduced?this.time:sceneTime(this.time/BASE_DURATION,this.options);
    const glints=getEdgeGlints(renderedTime,this.options);
    if (this.canvasRenderer && !this.destroyed) {
      this.canvasRenderer.render(renderedTime,this.options,this.pointer,this.reduced,this.currentTime,glints);
      return;
    }
    if (this.destroyed || this.fallback || !this.targets || !this.logos) return;
    const gl=this.gl, [scene, a, b]=this.targets;
    const logo=this.options.trademark ? this.logos.full : this.logos.compact;
    this.bind(this.scene,scene);
    this.texture(logo.texture);
    this.uniform(this.scene,'uLogo',0,'1i');
    this.uniform(this.scene,'uResolution',[scene.width,scene.height],'2f');
    this.uniform(this.scene,'uTextureSize',[logo.width,logo.height],'2f');
    this.uniform(this.scene,'uTime',renderedTime);
    this.uniform(this.scene,'uClock',this.currentTime);
    this.uniform(this.scene,'uSdfScale',logo.width/(this.options.trademark?795:695));
    this.uniform(this.scene,'uGlow',this.options.glow);
    this.uniform(this.scene,'uSize',this.options.size);
    this.uniform(this.scene,'uSpin',this.options.spin);
    this.uniform(this.scene,'uReduced',this.reduced ? 1 : 0);
    this.uniform(this.scene,'uPointer',this.pointer,'2f');
    this.uniform(this.scene,'uGlints[0]',glints,'4fv');
    for(const key of ['bloomRadius','lightIntensity','lightBloom','lightRadius','lightRotation','rayLength','rayStrength',
      'starSize','starThinness','starAspect','starBloom','starBrightness','streakLength','dissolveDuration','diffusion',
      'bevel','depth','metalExposure','reflectionSoftness','logoTilt','sweepWidth','sweepBrightness','glintStrength']){
      this.uniform(this.scene,'u'+key[0].toUpperCase()+key.slice(1),this.options[key]);
    }
    this.uniform(this.scene,'uLightTint',colorVector(this.options.lightTint),'3f');
    gl.drawArrays(gl.TRIANGLES,0,6);
    this.bind(this.blur,a); this.texture(scene.texture);
    this.uniform(this.blur,'uImage',0,'1i');
    this.uniform(this.blur,'uThreshold',.76);
    this.uniform(this.blur,'uStep',[2.2*this.options.bloomRadius/a.width,0],'2f');
    gl.drawArrays(gl.TRIANGLES,0,6);
    this.bind(this.blur,b); this.texture(a.texture);
    this.uniform(this.blur,'uThreshold',-.23);
    this.uniform(this.blur,'uStep',[0,2.2*this.options.bloomRadius/b.height],'2f');
    gl.drawArrays(gl.TRIANGLES,0,6);
    this.bind(this.composite); this.texture(scene.texture,0); this.texture(b.texture,1);
    this.uniform(this.composite,'uImage',0,'1i');
    this.uniform(this.composite,'uBloom',1,'1i');
    this.uniform(this.composite,'uGlow',this.options.glow);
    gl.drawArrays(gl.TRIANGLES,0,6);
  }

  async play({ restart = true } = {}) {
    await this.ready;
    if (this.destroyed) return;
    clearTimeout(this.fallbackTimer);
    if (restart) { this.time=0; this.completed=false; this.pointer=[0,0]; this.targetPointer=[0,0]; }
    this.container.hidden = false;
    this.container.style.opacity = '';
    this.playing = true;
    this.lastFrame = performance.now();
    this.dispatchEvent(new CustomEvent('play'));
    if (this.fallback) {
      this.fallback.style.opacity='0';
      requestAnimationFrame(() => { if (this.fallback) this.fallback.style.opacity='1'; });
      this.fallbackTimer=setTimeout(() => this.finish(),700);
      return;
    }
    if (!this.raf) this.raf=requestAnimationFrame(this.frame);
  }

  pause() {
    this.playing=false;
    clearTimeout(this.fallbackTimer);
    this.dispatchEvent(new CustomEvent('pause'));
  }

  seek(seconds) {
    this.time=Math.min(BASE_DURATION,Math.max(0,seconds/this.duration*BASE_DURATION));
    this.lastFrame=performance.now();
    this.completed=this.time>=BASE_DURATION;
    this.render(); this.tick();
  }

  setOptions(options) {
    const previousQuality=this.options.quality;
    this.options=sanitizeOptions({...this.options,...options});
    if(previousQuality!==this.options.quality)this.resize();
    this.render(); this.tick();
  }

  setPointer(x,y) {
    if (this.reduced || !this.completed) return;
    this.targetPointer=[x,y];
    if (!this.raf) {this.lastFrame=performance.now(); this.raf=requestAnimationFrame(this.frame);}
  }

  tick() {
    this.dispatchEvent(new CustomEvent('timeupdate',{detail:{time:this.currentTime,progress:this.time/BASE_DURATION}}));
  }

  frame(now) {
    this.raf=0;
    if (this.destroyed || this.fallback || document.hidden) return;
    // Track elapsed time, not frame count: slow software rendering must not
    // stretch a nine-second boot into a much longer loading screen.
    const elapsed=Math.max(0,(now-this.lastFrame)/1000);
    this.lastFrame=now;
    if (this.playing) {
      this.time=Math.min(BASE_DURATION,this.time+elapsed*BASE_DURATION/this.duration);
      if (this.reduced && this.time>.7) this.time=BASE_DURATION;
    }
    this.pointer[0]+=(this.targetPointer[0]-this.pointer[0])*.075;
    this.pointer[1]+=(this.targetPointer[1]-this.pointer[1])*.075;
    this.render();
    if (this.playing) this.tick();
    if (this.playing && this.time>=BASE_DURATION) this.finish();
    const moving=Math.abs(this.pointer[0]-this.targetPointer[0])+Math.abs(this.pointer[1]-this.targetPointer[1])>.001;
    if (this.playing || moving) this.raf=requestAnimationFrame(this.frame);
  }

  finish() {
    if (this.destroyed || (this.completed && !this.playing)) return;
    clearTimeout(this.fallbackTimer);
    this.playing=false; this.completed=true; this.time=BASE_DURATION;
    this.render(); this.tick();
    this.dispatchEvent(new CustomEvent('complete'));
    window.dispatchEvent(new CustomEvent('ae:boot-complete'));
    if(this.options.endBehavior==='dismiss') this.dismiss();
  }

  skip() { this.finish(); }

  async dismiss() {
    if (this.container.animate && !this.reduced) {
      const animation=this.container.animate([{opacity:1},{opacity:0}],{duration:650,fill:'forwards',easing:'ease-out'});
      try { await animation.finished; } catch {}
    }
    this.container.hidden=true;
    this.dispatchEvent(new CustomEvent('dismiss'));
    this.destroy();
  }

  async useFallback(reason) {
    if (this.destroyed || this.fallback || this.canvasRenderer || this.fallbackPending) return;
    this.fallbackPending=true;
    cancelAnimationFrame(this.raf); this.raf=0;
    this.container.dataset.rendererReason=reason;
    this.releaseGL();
    try {
      const { CanvasBootRenderer } = await import('./canvas-renderer.js');
      if (this.destroyed) return;
      const canvas=document.createElement('canvas');
      canvas.className='ae-boot-canvas'; canvas.setAttribute('aria-hidden','true');
      this.canvas.replaceWith(canvas); this.canvas=canvas;
      const renderer=new CanvasBootRenderer(canvas);
      await renderer.init();
      if (this.destroyed) { renderer.destroy(); return; }
      this.canvasRenderer=renderer;
      this.container.dataset.renderer='canvas2d';
      this.resize(); this.render();
      this.dispatchEvent(new CustomEvent('ready'));
      if (this.playing) { this.lastFrame=performance.now(); this.raf=requestAnimationFrame(this.frame); }
      return;
    } catch (error) { console.warn('æ Canvas fallback:',error.message); }
    this.canvas.style.display='none';
    this.container.dataset.renderer='static';
    const image=document.createElement('img');
    image.src=localAsset('logo-compact.svg'); image.alt='æ music label';
    image.className='ae-boot-fallback';
    this.container.append(image); this.fallback=image;
    this.dispatchEvent(new CustomEvent('fallback',{detail:{reason}}));
    if(this.playing) this.fallbackTimer=setTimeout(()=>this.finish(),700);
  }

  releaseGL() {
    const gl=this.gl;
    if(gl){
      this.targets?.forEach(t=>{gl.deleteTexture(t.texture);gl.deleteFramebuffer(t.fbo);});
      if(this.logos)Object.values(this.logos).forEach(t=>gl.deleteTexture(t.texture));
      [this.scene,this.blur,this.composite].filter(Boolean).forEach(p=>gl.deleteProgram(p.program));
      if(this.quad)gl.deleteBuffer(this.quad);
    }
    this.gl=null;this.targets=null;this.logos=null;
    this.scene=null;this.blur=null;this.composite=null;this.quad=null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed=true; this.playing=false;
    cancelAnimationFrame(this.raf); clearTimeout(this.fallbackTimer);
    this.observer.disconnect(); this.abort.abort();
    this.canvasRenderer?.destroy();
    this.releaseGL();
    this.canvas.remove(); this.fallback?.remove();
  }
}
