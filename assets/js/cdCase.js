// assets/js/cdCase.js
// A clear CD jewel case rendered with three.js — no 3D models, just procedural
// geometry and a couple of small shader patches:
//   • clear plastic: fresnel-driven alpha so faces stay glassy and edges catch light
//   • disc data side: a diffraction-grating term that throws CD rainbows
//
// Usage:
//   const stage = new CDStage(containerEl);
//   await stage.setAlbum({ id, coverArt, albumTitle, artist });
//   stage.addEventListener('disctap', ...)   // tapped the disc while the case is open
//   stage.addEventListener('openchange', e => e.detail.open)
//   stage.setOpen(true); stage.setSpinning(true);

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Dimensions (1 unit ≈ 1 cm — a real jewel case is 14.2 × 12.5 × 1.0 cm)
// ---------------------------------------------------------------------------
const W = 14.2;
const H = 12.5;
const DISC_R = 6.0;
const HOLE_R = 0.75;
const DISC_X = 0.35;          // disc centre sits a little right of the case centre (hinge on the left)
const DISC_Z = 0.42;          // disc mid-plane height inside the tray
const DISC_T = 0.12;          // disc thickness
const HINGE_Z = 0.62;         // hinge axis height
const FLOOR_GAP = 0.7;        // case floats a bit above the "table" so the shadow reads
const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = t => t * t * t;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = t => {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function rbox(w, h, d, x, y, z, r = 0.07, seg = 2) {
  const rr = Math.max(0.005, Math.min(r, w / 2 - 0.004, h / 2 - 0.004, d / 2 - 0.004));
  const g = new RoundedBoxGeometry(w, h, d, seg, rr);
  g.translate(x, y, z);
  return g;
}

// Axis-aligned bar between two points (thickness `width`, z range z0..z1)
function bar(x0, y0, x1, y1, width, z0, z1, r = 0.08) {
  const horizontal = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  const len = horizontal ? Math.abs(x1 - x0) : Math.abs(y1 - y0);
  const w = horizontal ? len + width : width;
  const h = horizontal ? width : len + width;
  return rbox(w, h, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, r);
}

// Small block placed on a circle, oriented tangentially
function radialBlock(cx, cy, radius, angle, tangential, radial, z0, z1) {
  const g = rbox(radial, tangential, z1 - z0, 0, 0, (z0 + z1) / 2, 0.06);
  g.rotateZ(angle);
  g.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, 0);
  return g;
}

function cylY(x, y0, y1, z, r) {
  const g = new THREE.CylinderGeometry(r, r, Math.abs(y1 - y0), 20, 1);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

function ring(cx, cy, z, radius, tube) {
  const g = new THREE.TorusGeometry(radius, tube, 10, 96);
  g.translate(cx, cy, z);
  return g;
}

function merge(parts) {
  // mergeGeometries needs matching attribute sets; strip everything but position/normal/uv
  const clean = parts.map(g => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) {
      if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    }
    n.clearGroups();
    return n;
  });
  const merged = mergeGeometries(clean, false);
  clean.forEach(g => g.dispose());
  parts.forEach(g => g.dispose());
  return merged;
}

// Bottom shell: back plate + tray rails + hub + hinge knuckles.
function buildBaseGeometry() {
  const plate = [rbox(W, H, 0.12, 0, 0, 0.06, 0.06)];

  const rails = [];
  const zb = 0.12, zt = 0.6, zLow = 0.3;
  const ow = 0.34;
  const xL = -W / 2 + 0.95, xR = W / 2 - 0.22;
  const yT = H / 2 - 0.22, yB = -H / 2 + 0.22;

  // top / bottom outer rails — the middle run is a low ledge where the disc edge passes
  for (const y of [yT, yB]) {
    rails.push(bar(xL, y, -2.3, y, ow, zb, zt));
    rails.push(bar(-1.75, y, 2.45, y, ow, zb, zLow));
    rails.push(bar(3.0, y, xR, y, ow, zb, zt));
  }
  // right rail, three runs with notches
  rails.push(bar(xR, yB, xR, -1.75, ow, zb, zt));
  rails.push(bar(xR, -1.2, xR, 1.2, ow, zb, zt));
  rails.push(bar(xR, 1.75, xR, yT, ow, zb, zt));
  // left rail, split around the thumb loop
  rails.push(bar(xL, yB, xL, -1.65, ow, zb, zt));
  rails.push(bar(xL, 1.65, xL, yT, ow, zb, zt));
  // thumb loop (low, sits under the disc edge)
  const lx = xL + 1.1;
  rails.push(bar(xL, 1.65, lx, 1.65, 0.24, zb, zLow));
  rails.push(bar(xL, -1.65, lx, -1.65, 0.24, zb, zLow));
  rails.push(bar(lx, -1.65, lx, 1.65, 0.24, zb, zLow));

  // second, thinner rail just inside the outer frame (the "double line" look)
  const iw = 0.12, ins = 0.5;
  rails.push(bar(xR - ins, yB + 1.2, xR - ins, -2.2, iw, zb, zt - 0.12));
  rails.push(bar(xR - ins, 2.2, xR - ins, yT - 1.2, iw, zb, zt - 0.12));
  rails.push(bar(xL + ins, yB + 1.2, xL + ins, -2.6, iw, zb, zt - 0.12));
  rails.push(bar(xL + ins, 2.6, xL + ins, yT - 1.2, iw, zb, zt - 0.12));

  // corner L brackets (outside the disc circle)
  const bx = DISC_X + 5.9, bxl = DISC_X - 5.9 - 0.05;
  const by = 5.33, len = 1.45;
  for (const sy of [1, -1]) {
    rails.push(bar(bx - len, sy * by, bx, sy * by, 0.2, zb, zt));
    rails.push(bar(bx, sy * by, bx, sy * (by - len), 0.2, zb, zt));
    rails.push(bar(bxl + len, sy * by, bxl, sy * by, 0.2, zb, zt));
    rails.push(bar(bxl, sy * by, bxl, sy * (by - len), 0.2, zb, zt));
  }

  // disc seat ledge + clip tabs around the rim
  rails.push(ring(DISC_X, 0, DISC_Z - 0.12, DISC_R + 0.02, 0.05));
  for (const deg of [0, 36, -36, 144, -144, 180]) {
    const a = THREE.MathUtils.degToRad(deg);
    rails.push(radialBlock(DISC_X, 0, DISC_R + 0.14, a, 0.55, 0.22, zb, DISC_Z + 0.1));
  }

  // hub: boss the disc rests on, rosette teeth through the hole, ring on top
  {
    const g = new THREE.CylinderGeometry(1.45, 1.55, DISC_Z - DISC_T / 2 - zb, 48, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(DISC_X, 0, (zb + DISC_Z - DISC_T / 2) / 2);
    rails.push(g);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    rails.push(radialBlock(DISC_X, 0, 0.52, a, 0.2, 0.34, DISC_Z - 0.1, DISC_Z + 0.22));
  }
  rails.push(ring(DISC_X, 0, DISC_Z + 0.2, 0.36, 0.06));
  rails.push(ring(DISC_X, 0, DISC_Z + 0.17, 0.72, 0.045));

  // hinge knuckles on the base
  rails.push(cylY(-W / 2 + 0.2, -H / 2 + 0.6, -H / 2 + 1.9, HINGE_Z, 0.17));
  rails.push(cylY(-W / 2 + 0.2, H / 2 - 1.9, H / 2 - 0.6, HINGE_Z, 0.17));

  return { plate: merge(plate), rails: merge(rails) };
}

// Lid, built relative to its hinge pivot at (-W/2, 0, HINGE_Z)
function buildLidGeometry() {
  const plate = [rbox(W - 0.06, H, 0.12, W / 2 + 0.03, 0, 0.36, 0.06)];
  const rim = [];
  const z0 = 0.02, z1 = 0.32;
  rim.push(bar(0.35, H / 2 - 0.06, W - 0.06, H / 2 - 0.06, 0.1, z0, z1, 0.04));
  rim.push(bar(0.35, -H / 2 + 0.06, W - 0.06, -H / 2 + 0.06, 0.1, z0, z1, 0.04));
  rim.push(bar(W - 0.06, -H / 2 + 0.06, W - 0.06, H / 2 - 0.06, 0.1, z0, z1, 0.04));
  // booklet tabs
  for (const sy of [1, -1]) {
    rim.push(rbox(0.9, 0.34, 0.08, W - 1.6, sy * (H / 2 - 0.3), 0.27, 0.04));
    rim.push(rbox(0.9, 0.34, 0.08, 1.6, sy * (H / 2 - 0.3), 0.27, 0.04));
  }
  // lid knuckles
  rim.push(cylY(0.2, -H / 2 + 2.05, -1.0, 0, 0.16));
  rim.push(cylY(0.2, 1.0, H / 2 - 2.05, 0, 0.16));
  return { plate: merge(plate), rim: merge(rim) };
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

// Clear plastic. Transmission in three.js can't see other transmissive objects
// through itself (lid over tray would hide the rails), so instead: low base
// alpha, alpha rising with fresnel + specular so edges and glints read.
//
// Output is premultiplied: a faint body tint that thickens toward grazing
// angles (acrylic edges go grey), plus reflections added on top un-dimmed,
// so faces stay crystal clear but still catch glints.
function makePlastic({
  opacity = 0.03,      // body coverage when seen face-on
  edge = 0.7,          // extra coverage at grazing angles
  power = 2.2,         // how quickly coverage rises toward the edge
  body = 0x6f737a,     // colour seen through thick/grazing plastic
  spec = 1.0,          // reflection strength
  coat = 1,            // clearcoat layer
  irid = 0.45,         // thin-film rainbow sheen
  side = THREE.DoubleSide,
} = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x000000,   // no diffuse — clear plastic only reflects and tints
    roughness: 0.06,
    metalness: 0,
    clearcoat: coat,
    clearcoatRoughness: 0.05,
    iridescence: irid,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [180, 460],
    envMapIntensity: 1.0,
    transparent: true,
    opacity,
    depthWrite: false,
    side,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const bodyCol = new THREE.Color(body);
  m.onBeforeCompile = shader => {
    shader.uniforms.uEdge = { value: edge };
    shader.uniforms.uPow = { value: power };
    shader.uniforms.uBody = { value: bodyCol };
    shader.uniforms.uSpec = { value: spec };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uEdge;\nuniform float uPow;\nuniform vec3 uBody;\nuniform float uSpec;'
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 vDir = normalize( vViewPosition );
          float ndv = clamp( abs( dot( normalize( normal ), vDir ) ), 0.0, 1.0 );
          float fres = pow( 1.0 - ndv, uPow );
          float a = clamp( opacity + fres * uEdge, 0.0, 0.92 );
          // outgoingLight holds only reflections (diffuse colour is black)
          gl_FragColor = vec4( uBody * a + outgoingLight * uSpec, a );
        }`
      );
  };
  m.customProgramCacheKey = () => 'ae-plastic';
  return m;
}

// Shared GLSL for the CD diffraction rainbow.
const DIFFRACTION_GLSL = /* glsl */ `
  varying vec3 vRadialV;
  varying vec3 vTanV;
  uniform float uGain;

  vec3 bump3y( vec3 x, vec3 yoffset ) {
    vec3 y = 1.0 - x * x;
    return clamp( y - yoffset, 0.0, 1.0 );
  }
  // Zucconi's 6-bump spectral approximation
  vec3 spectral( float w ) {
    float x = clamp( ( w - 400.0 ) / 300.0, 0.0, 1.0 );
    const vec3 c1 = vec3( 3.54585104, 2.93225262, 2.41593945 );
    const vec3 x1 = vec3( 0.69549072, 0.49228336, 0.27699880 );
    const vec3 y1 = vec3( 0.02312639, 0.15225084, 0.52607955 );
    const vec3 c2 = vec3( 3.90307140, 3.21182957, 3.96587128 );
    const vec3 x2 = vec3( 0.11748627, 0.86755042, 0.66077860 );
    const vec3 y2 = vec3( 0.84897130, 0.88445281, 0.73949448 );
    float inRange = smoothstep( 390.0, 420.0, w ) * ( 1.0 - smoothstep( 680.0, 720.0, w ) );
    return ( bump3y( c1 * ( x - x1 ), y1 ) + bump3y( c2 * ( x - x2 ), y2 ) ) * inRange;
  }
  // Tracks are concentric circles, so the grating repeats along the radial axis.
  vec3 grating( vec3 L, vec3 V, vec3 N, vec3 R, vec3 T ) {
    vec3 h = L + V;
    float u = abs( dot( R, h ) );
    float along = dot( T, h );
    float w = exp( -along * along * 22.0 );
    float facing = clamp( dot( N, L ), 0.0, 1.0 ) * clamp( dot( N, V ), 0.0, 1.0 );
    vec3 col = vec3( 0.0 );
    const float d = 1600.0; // track pitch in nm
    for ( int n = 1; n <= 3; n++ ) {
      col += spectral( d * u / float( n ) ) / float( n );
    }
    return col * w * facing;
  }
`;

function addDiffraction(material, gain) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uGain = { value: gain };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRadialV;\nvarying vec3 vTanV;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec2 pr = position.xy;
          float lr = max( length( pr ), 1e-4 );
          vRadialV = normalize( ( modelViewMatrix * vec4( pr / lr, 0.0, 0.0 ) ).xyz );
          vTanV = normalize( ( modelViewMatrix * vec4( -pr.y / lr, pr.x / lr, 0.0, 0.0 ) ).xyz );
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DIFFRACTION_GLSL)
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 Vv = normalize( vViewPosition );
          vec3 Nn = normalize( normal );
          vec3 Rr = normalize( vRadialV );
          vec3 Tt = normalize( vTanV );
          vec3 L1 = normalize( ( viewMatrix * vec4( normalize( vec3( -0.45, 0.75, 0.55 ) ), 0.0 ) ).xyz );
          vec3 L2 = normalize( ( viewMatrix * vec4( normalize( vec3( 0.75, -0.3, 0.6 ) ), 0.0 ) ).xyz );
          vec3 L3 = normalize( ( viewMatrix * vec4( normalize( vec3( 0.1, 0.35, 1.0 ) ), 0.0 ) ).xyz );
          vec3 dif = grating( L1, Vv, Nn, Rr, Tt ) * 1.0
                   + grating( L2, Vv, Nn, Rr, Tt ) * 0.7
                   + grating( L3, Vv, Nn, Rr, Tt ) * 0.5;
          outgoingLight += dif * uGain;
        }
        #include <opaque_fragment>`
      );
  };
  material.customProgramCacheKey = () => 'ae-diffraction';
  return material;
}

function makeDataSide() {
  return addDiffraction(
    new THREE.MeshPhysicalMaterial({
      color: 0x8e96a1,
      metalness: 1,
      roughness: 0.16,
      clearcoat: 0.5,
      clearcoatRoughness: 0.08,
      envMapIntensity: 0.75,
    }),
    1.7
  );
}

function makeMirrorRing() {
  return addDiffraction(
    new THREE.MeshPhysicalMaterial({
      color: 0xb9c0c9,
      metalness: 1,
      roughness: 0.1,
      envMapIntensity: 0.9,
    }),
    1.2
  );
}

// ---------------------------------------------------------------------------
// Cover textures
// ---------------------------------------------------------------------------
const textureCache = new Map();

function fallbackCanvas(album, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#7fc8ff');
  grad.addColorStop(0.5, '#f6c6ff');
  grad.addColorStop(1, '#fff6b8');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(20,40,90,0.85)';
  g.textAlign = 'center';
  g.font = `bold ${size * 0.075}px Arial, sans-serif`;
  g.fillText(album?.albumTitle || 'æ', size / 2, size * 0.36);
  g.font = `${size * 0.05}px Arial, sans-serif`;
  g.fillText(album?.artist || '', size / 2, size * 0.7);
  return c;
}

function loadCoverTexture(album, renderer) {
  const key = album?.coverArt || `fallback:${album?.id}`;
  if (textureCache.has(key)) return textureCache.get(key);

  const size = 1024;
  const promise = new Promise(resolve => {
    const finish = canvas => {
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      resolve(tex);
    };
    if (!album?.coverArt) return finish(fallbackCanvas(album, size));

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      // downscale (covers can be ~4000px) and centre-crop to square
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      finish(c);
    };
    img.onerror = () => finish(fallbackCanvas(album, size));
    img.src = album.coverArt;
  });
  textureCache.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Studio environment: soft sky gradient, a few softboxes, a couple of dark
// flags. Kept in a modest brightness range so clear plastic glints instead
// of blowing out, and the dark flags give the acrylic edges definition.
// ---------------------------------------------------------------------------
function buildStudioEnv() {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0xffffff) },
        mid: { value: new THREE.Color(0xeceef1) },
        bottom: { value: new THREE.Color(0x8b8f96) },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vDir;
        void main(){ float y = vDir.y;
          vec3 c = y > 0.0 ? mix(mid, top, smoothstep(0.0, 0.7, y)) : mix(mid, bottom, smoothstep(0.0, 0.8, -y));
          gl_FragColor = vec4(c * 0.85, 1.0); }`,
    })
  );
  env.add(sky);

  const box = (w, h, color, intensity, pos, look) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
    );
    m.position.set(...pos);
    m.lookAt(...look);
    env.add(m);
  };
  // softboxes
  box(30, 10, 0xffffff, 2.4, [-18, 22, 22], [0, 0, 0]);
  box(8, 36, 0xffffff, 1.8, [34, 4, 14], [0, 0, 0]);
  box(40, 6, 0xffffff, 1.4, [0, -10, 40], [0, 0, 0]);
  // dark flags (give the clear edges something to reflect)
  box(14, 40, 0x1b1c1f, 1, [-36, 0, 6], [0, 0, 0]);
  box(30, 10, 0x2a2b2f, 1, [10, -26, 20], [0, 0, 0]);
  box(16, 16, 0x222326, 1, [20, 24, -10], [0, 0, 0]);
  return env;
}

// ---------------------------------------------------------------------------
// Background shadow texture (soft blob, cheap and always smooth)
// ---------------------------------------------------------------------------
function makeShadowTexture(blur = 18, inset = 56) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.filter = `blur(${blur}px)`;
  g.fillStyle = 'rgba(12,14,18,1)';
  g.beginPath();
  g.roundRect(inset, inset, 256 - inset * 2, 256 - inset * 2, 14);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------
export class CDStage extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.reduceMotion = prefersReducedMotion();

    // --- renderer -----------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'aep-canvas';
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('role', 'button');
    this.canvas.setAttribute('aria-label', 'CD case. Press Enter to open or close, Space to play.');
    container.prepend(this.canvas);

    // --- scene --------------------------------------------------------------
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const studio = buildStudioEnv();
    this.envRT = pmrem.fromScene(studio, 0.02);
    studio.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 1.0;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(26, 1, 1, 400);
    this.camera.position.set(0, 0, 60);

    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-8, 12, 20);
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xe6e7ea, 0.35));

    // soft shadow card on the "table"
    this.shadowTex = makeShadowTexture();
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.6, H * 1.6),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false })
    );
    this.scene.add(this.shadow);
    this.shadowLid = this.shadow.clone();
    this.shadowLid.material = this.shadow.material.clone();
    this.scene.add(this.shadowLid);
    // tight contact shadow right under the tray — what makes it feel like it's sitting there
    this.contactTex = makeShadowTexture(7, 30);
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.08, H * 1.08),
      new THREE.MeshBasicMaterial({ map: this.contactTex, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false })
    );
    this.scene.add(this.contact);

    // --- case ---------------------------------------------------------------
    this.root = new THREE.Group();      // swaps/entrance move this
    this.tilt = new THREE.Group();      // drag + idle rotation
    this.spread = new THREE.Group();    // shifts right as the lid opens so the pair stays centred
    this.root.add(this.tilt);
    this.tilt.add(this.spread);
    this.scene.add(this.root);

    const caseGroup = new THREE.Group();
    caseGroup.position.set(0, 0, -0.55); // rotate around the case's middle, not its back
    this.spread.add(caseGroup);
    this.caseGroup = caseGroup;

    const plateMat = makePlastic({ opacity: 0.02, edge: 0.6, power: 3.0, body: 0x70747b, spec: 0.3, coat: 0, irid: 0, side: THREE.FrontSide });
    const railMat = makePlastic({ opacity: 0.24, edge: 0.88, power: 1.35, body: 0x5a5e66, spec: 0.95, irid: 0.12 });
    const lidPlateMat = makePlastic({ opacity: 0.012, edge: 0.6, power: 2.6, body: 0x70747b, spec: 0.15, coat: 0, irid: 0 });
    this.materials = [plateMat, railMat, lidPlateMat];

    const base = buildBaseGeometry();
    this.basePlate = new THREE.Mesh(base.plate, plateMat);
    this.baseRails = new THREE.Mesh(base.rails, railMat);
    this.basePlate.renderOrder = 1;
    this.baseRails.renderOrder = 2;
    caseGroup.add(this.basePlate, this.baseRails);

    this.lidPivot = new THREE.Group();
    this.lidPivot.position.set(-W / 2, 0, HINGE_Z);
    const lid = buildLidGeometry();
    this.lidPlate = new THREE.Mesh(lid.plate, lidPlateMat);
    this.lidRim = new THREE.Mesh(lid.rim, railMat);
    this.lidPlate.renderOrder = 4;
    this.lidRim.renderOrder = 3;
    this.lidPivot.add(this.lidPlate, this.lidRim);
    caseGroup.add(this.lidPivot);

    // --- disc ---------------------------------------------------------------
    this.disc = new THREE.Group();
    this.disc.position.set(DISC_X, 0, DISC_Z);
    caseGroup.add(this.disc);

    const seg = 160;
    const PRINT_IN = 1.95;
    const top = DISC_T / 2, bot = -DISC_T / 2;

    // printed label: cover shown at its true colours (emissive) + a glossy coat on top
    this.artMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1a1a,
      emissive: 0xffffff,
      emissiveIntensity: 0.92,
      roughness: 0.38,
      metalness: 0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.12,
      envMapIntensity: 0.6,
    });
    const art = new THREE.Mesh(new THREE.RingGeometry(PRINT_IN, DISC_R - 0.06, seg, 1), this.artMat);
    art.position.z = top + 0.001;

    const mirrorMat = makeMirrorRing();
    const mirror = new THREE.Mesh(new THREE.RingGeometry(1.55, PRINT_IN, seg, 1), mirrorMat);
    mirror.position.z = top;
    const rim = new THREE.Mesh(new THREE.RingGeometry(DISC_R - 0.06, DISC_R, seg, 1), mirrorMat);
    rim.position.z = top;

    const clearMat = makePlastic({ opacity: 0.05, edge: 0.55, power: 1.8, body: 0x8a8e95, spec: 0.6, coat: 0, irid: 0 });
    const hubClear = new THREE.Mesh(new THREE.RingGeometry(HOLE_R, 1.55, 64, 1), clearMat);
    hubClear.position.z = top;
    hubClear.renderOrder = 2;

    const dataMat = makeDataSide();
    const dataGeo = new THREE.RingGeometry(1.55, DISC_R, seg, 1);
    dataGeo.rotateY(Math.PI);
    const data = new THREE.Mesh(dataGeo, dataMat);
    data.position.z = bot;

    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xd6dbe2, metalness: 0.7, roughness: 0.3 });
    const edgeGeo = new THREE.CylinderGeometry(DISC_R, DISC_R, DISC_T, seg, 1, true);
    edgeGeo.rotateX(Math.PI / 2);
    const edge = new THREE.Mesh(edgeGeo, edgeMat);

    this.disc.add(art, mirror, rim, hubClear, data, edge);
    this.discParts = [art, mirror, rim, data, edge, hubClear];
    this.materials.push(this.artMat, mirrorMat, clearMat, dataMat, edgeMat);

    // --- state --------------------------------------------------------------
    this.state = {
      open: false,
      openP: 0,            // 0 closed … 1 fully open (linear, eased when applied)
      spinning: false,
      spinSpeed: 0,
      discAngle: 0,
      rot: { x: 0, y: 0 },   // user drag offset
      vel: { x: 0, y: 0 },
      dragging: false,
      swap: null,          // { phase: 'out'|'wait'|'in', t, ready, apply }
      hasAlbum: false,
      // hover wobble: tilt toward the cursor on a loose (underdamped) spring
      hover: { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 },
      flourish: null,      // { t } — the full turn the case does when it opens
      discBoost: 0,        // extra disc spin (rad/s) that decays — the whirl on open
    };
    this.rest = { x: -0.2, y: 0.22 };
    this.clock = new THREE.Clock();
    this.fit = { dist: 60, worldPerPx: 0.05, viewH: 20 };

    this._bindPointer();
    this._bindKeys();

    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(container);
    this._resize();

    this.root.visible = false;
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  // ---------------------------------------------------------------- public API
  get isOpen() { return this.state.open; }

  setOpen(open) {
    open = !!open;
    if (this.state.open === open) return;
    this.state.open = open;
    const s = this.state;
    if (!this.reduceMotion) {
      if (open) {
        s.flourish = { t: 0 };
        s.discBoost = TAU * 2.6;
      } else {
        // closing: a little shudder as the lid snaps shut
        s.hover.vy -= 2.2;
        s.hover.vx += 1.2;
        s.discBoost = Math.max(s.discBoost, TAU * 0.6);
      }
    }
    this.dispatchEvent(new CustomEvent('openchange', { detail: { open } }));
  }

  toggleOpen() { this.setOpen(!this.state.open); }

  setSpinning(on) { this.state.spinning = !!on; }

  /** Show an album. First call drops the case in; later calls swap cases. */
  async setAlbum(album) {
    const texPromise = loadCoverTexture(album, this.renderer);
    const apply = tex => {
      this.artMat.map = tex;
      this.artMat.emissiveMap = tex;
      this.artMat.needsUpdate = true;
      this.state.discAngle = 0;
    };

    if (!this.state.hasAlbum) {
      this.state.hasAlbum = true;
      const tex = await texPromise;
      apply(tex);
      this.root.visible = true;
      this.state.swap = { phase: 'in', t: 0 };
      return;
    }

    // swap: slide current case out, change the disc, drop the new case in
    const swap = { phase: 'out', t: 0, ready: false, tex: null };
    this.state.swap = swap;
    texPromise.then(tex => { swap.tex = tex; swap.ready = true; });
    swap.apply = () => {
      apply(swap.tex);
      this.state.openP = 0;
      if (this.state.open) {
        this.state.open = false;
        this.dispatchEvent(new CustomEvent('openchange', { detail: { open: false } }));
      }
    };
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this.resizeObserver.disconnect();
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.materials.forEach(m => m.dispose());
    this.shadowTex.dispose();
    this.shadow.material.dispose();
    this.contactTex.dispose();
    this.contact.material.dispose();
    this.shadowLid.material.dispose();
    this.envRT.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---------------------------------------------------------------- internals
  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._size = { w, h };
  }

  // Frame the case (wider when open) inside the area above the picker.
  _frame(openE) {
    if (!this._size) return;
    const { w, h } = this._size;
    const pickerShown = !!this.container.querySelector('.aep-picker:not([hidden])');
    const reserveBottom = Math.min(pickerShown ? 110 : 56, h * 0.22);
    const usableH = Math.max(80, h - reserveBottom - 16);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const needW = (W + W * openE) * lerp(1.12, 1.05, openE);
    const needH = H * 1.3;
    const dH = (needH / 2) / tanHalf * (h / usableH);
    const dW = (needW / 2) / (tanHalf * this.camera.aspect);
    const dist = Math.max(dH, dW);
    this.camera.position.set(0, 0, dist);
    this.camera.lookAt(0, 0, 0);
    const viewH = 2 * dist * tanHalf;
    this.fit.dist = dist;
    this.fit.viewH = viewH;
    this.fit.worldPerPx = viewH / h;
    // lift the case so it sits centred in the space above the picker
    this.fit.liftY = (reserveBottom / 2) * this.fit.worldPerPx;
  }

  _visible() {
    return this.container.isConnected && this.container.offsetParent !== null && !document.hidden;
  }

  _loop() {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    if (!this._visible() || !this._size) return;
    const s = this.state;
    const t = this.clock.elapsedTime;

    // lid
    // when opening, the lid waits for the spin to be nearly done, then swings quickly
    // when opening, the lid is flung open by the spin: it lets go while the case
    // is still turning (≈80% of the way round) and swings fast, easing as it lands
    const openDur = this.reduceMotion ? 0.25 : 0.55;
    const lidGo = s.open && (!s.flourish || easeOutCubic(clamp(s.flourish.t, 0, 1)) >= 0.8);
    s.openP = clamp(s.openP + (lidGo ? 1 : s.open ? 0 : -1) * dt / openDur, 0, 1);
    const lidTarget = s.open ? easeOutCubic(s.openP) : easeInOut(s.openP);
    // low-pass so reversing mid-swing never jumps
    s.openE = s.openE === undefined ? lidTarget : s.openE + (lidTarget - s.openE) * (1 - Math.exp(-28 * dt));
    const openE = s.openE;
    this.lidPivot.rotation.y = -Math.PI * openE;
    this.spread.position.x = (W / 2) * openE;

    // disc spin (eases up and down like a real drive)
    const target = s.spinning ? TAU * 0.55 : 0;
    const rate = s.spinning ? 1.6 : 1.1;
    s.spinSpeed += (target - s.spinSpeed) * (1 - Math.exp(-rate * dt));
    s.discBoost *= Math.exp(-1.3 * dt);
    if (s.discBoost < 0.01) s.discBoost = 0;
    s.discAngle -= (s.spinSpeed + s.discBoost) * dt;
    this.disc.rotation.z = s.discAngle;

    // hover wobble
    const h = s.hover;
    {
      const k = 55, c = 2 * Math.sqrt(k) * 0.26;
      const active = !s.dragging && !this.reduceMotion;
      const tx = active ? h.tx : 0, ty = active ? h.ty : 0;
      h.vx += (-k * (h.x - tx) - c * h.vx) * dt;
      h.vy += (-k * (h.y - ty) - c * h.vy) * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
    }

    // the turn on open: one full revolution, lifted toward you mid-spin
    let flourishY = 0, flourishLift = 0, flourishTip = 0;
    if (s.flourish) {
      s.flourish.t += dt / 0.75;
      const ft = clamp(s.flourish.t, 0, 1);
      flourishY = TAU * easeOutCubic(ft); // starts fast, eases into the opening
      flourishLift = Math.sin(Math.PI * ft) * 2.2;
      flourishTip = Math.sin(Math.PI * ft) * 0.18;
      if (s.flourish.t >= 1) {
        s.flourish = null;
        s.hover.vy += 1.4; // settle with a small overshoot
      }
    }

    // drag / inertia / spring back to rest (nearest full turn, so flips settle face-up)
    if (!s.dragging) {
      for (const axis of ['x', 'y']) {
        const goal = axis === 'y' ? Math.round(s.rot.y / TAU) * TAU : 0;
        const k = 14, c = 2 * Math.sqrt(k) * 0.75;
        s.vel[axis] += (-k * (s.rot[axis] - goal) - c * s.vel[axis]) * dt;
        s.rot[axis] += s.vel[axis] * dt;
      }
    }
    const idle = this.reduceMotion ? 0 : 1;
    this.tilt.rotation.x = this.rest.x + s.rot.x + h.x - flourishTip + Math.sin(t * 0.7) * 0.025 * idle;
    this.tilt.rotation.y = this.rest.y * (1 - openE * 0.6) + s.rot.y + h.y + flourishY + Math.sin(t * 0.45) * 0.04 * idle;
    this.tilt.rotation.z = h.y * -0.12;

    // framing follows the opening
    this._frame(openE);

    // swap / entrance
    let swapY = 0, swapRot = 0;
    const sw = s.swap;
    if (sw) {
      const travel = this.fit.viewH * 0.95;
      if (sw.phase === 'out') {
        sw.t += dt / (this.reduceMotion ? 0.15 : 0.38);
        const e = easeIn(clamp(sw.t, 0, 1));
        swapY = -travel * e;
        swapRot = 0.25 * e;
        if (sw.t >= 1) { sw.phase = 'wait'; sw.t = 0; }
      }
      if (sw.phase === 'wait') {
        swapY = -travel;
        if (sw.ready) { sw.apply(); sw.phase = 'in'; sw.t = 0; }
      }
      if (sw.phase === 'in') {
        sw.t += dt / (this.reduceMotion ? 0.2 : 0.7);
        const e = easeOutBack(clamp(sw.t, 0, 1));
        swapY = travel * (1 - e);
        swapRot = -0.18 * (1 - e);
        if (sw.t >= 1) s.swap = null;
      }
    }
    this.root.position.set(0, this.fit.liftY + swapY, FLOOR_GAP + flourishLift);
    this.root.rotation.z = swapRot;

    // shadow card follows the case footprint
    const shadowAlpha = sw ? clamp(1 - Math.abs(swapY) / (this.fit.viewH * 0.5), 0, 1) : 1;
    // one card under the tray, a fainter one under the (thin) lid once it lands
    const sy = this.fit.liftY + swapY - 1.2;
    // lifting toward the camera (the open spin) softens and spreads the shadow
    const liftK = 1 / (1 + flourishLift * 0.45);
    this.shadow.position.set(1.1 + this.spread.position.x + flourishLift * 0.5, sy - flourishLift * 0.5, 0);
    this.shadow.scale.setScalar(1 + flourishLift * 0.08);
    this.shadow.material.opacity = 0.24 * shadowAlpha * liftK;
    this.contact.position.set(0.35 + this.spread.position.x, sy + 0.75, 0.01);
    this.contact.material.opacity = 0.2 * shadowAlpha * Math.pow(liftK, 3);
    this.shadowLid.position.set(1.1 + this.spread.position.x - W, sy, 0);
    this.shadowLid.material.opacity = 0.1 * shadowAlpha * Math.pow(openE, 3);

    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- pointer
  _bindPointer() {
    const el = this.canvas;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;

    const pick = e => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hitsDisc = ray.intersectObjects(this.discParts, false);
      const hitsCase = ray.intersectObjects([this.basePlate, this.baseRails, this.lidPlate, this.lidRim], false);
      return { disc: hitsDisc[0] || null, case: hitsCase[0] || null };
    };

    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      down = { x: e.clientX, y: e.clientY, t: e.timeStamp, lx: e.clientX, ly: e.clientY, lt: performance.now(), moved: false };
      this.state.vel.x = this.state.vel.y = 0;
    });

    let lastHover = null;
    el.addEventListener('pointermove', e => {
      if (!down) {
        if (!this.state.hasAlbum) return;
        // lean toward the cursor; quick flicks add a bit of jiggle
        const r = el.getBoundingClientRect();
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
        const hv = this.state.hover;
        hv.ty = clamp(nx, -1, 1) * 0.24;
        hv.tx = clamp(ny, -1, 1) * 0.18;
        if (lastHover) {
          hv.vy += clamp((e.clientX - lastHover.x) * 0.012, -0.6, 0.6);
          hv.vx += clamp((e.clientY - lastHover.y) * 0.01, -0.5, 0.5);
        }
        lastHover = { x: e.clientX, y: e.clientY };
        // hover cursor
        const p = pick(e);
        const overDisc = p.disc && (this.state.openP > 0.6);
        el.style.cursor = overDisc ? 'pointer' : (p.case || p.disc) ? 'grab' : 'default';
        return;
      }
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 5) {
        down.moved = true;
        this.state.dragging = true;
        el.style.cursor = 'grabbing';
      }
      if (down.moved) {
        const now = performance.now();
        const mx = e.clientX - down.lx, my = e.clientY - down.ly;
        const dtm = Math.max(1, now - down.lt) / 1000;
        const s = this.state;
        s.rot.y += mx * 0.0105;
        s.rot.x = clamp(s.rot.x + my * 0.0085, -1.25, 1.25);
        s.vel.y = lerp(s.vel.y, (mx * 0.0105) / dtm, 0.5);
        s.vel.x = lerp(s.vel.x, (my * 0.0085) / dtm, 0.5);
        down.lx = e.clientX; down.ly = e.clientY; down.lt = now;
      }
    });

    const end = e => {
      if (!down) return;
      const wasTap = !down.moved && e.timeStamp - down.t < 600;
      this.state.dragging = false;
      el.style.cursor = 'grab';
      down = null;
      if (!wasTap || (this.state.swap && this.state.swap.phase !== 'in')) return;
      const p = pick(e);
      // Disc counts when the lid is out of the way (or the hit is on the disc before any plastic)
      const discFirst = p.disc && (!p.case || p.disc.distance <= p.case.distance);
      if (p.disc && (this.state.openP > 0.6 || discFirst && this.state.open)) {
        this.dispatchEvent(new CustomEvent('disctap'));
      } else if (p.case || p.disc) {
        this.toggleOpen();
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointerleave', () => {
      lastHover = null;
      this.state.hover.tx = 0;
      this.state.hover.ty = 0;
    });
    el.addEventListener('pointercancel', () => { down = null; this.state.dragging = false; });
  }

  _bindKeys() {
    this.canvas.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.toggleOpen(); }
      if (e.key === 'ArrowLeft') this.state.vel.y -= 2.5;
      if (e.key === 'ArrowRight') this.state.vel.y += 2.5;
      if (e.key === 'ArrowUp') this.state.vel.x -= 2;
      if (e.key === 'ArrowDown') this.state.vel.x += 2;
    });
  }
}
