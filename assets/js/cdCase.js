// assets/js/cdCase.js
// Clear CD jewel cases rendered with three.js — no 3D models, just procedural
// geometry and a couple of small shader patches:
//   • clear plastic: fresnel-driven alpha so faces stay glassy and edges catch light
//   • disc data side: a diffraction-grating term that throws CD rainbows
//
// CDStage shows an artist's albums as a row of cases you slide between; the
// centred case opens with a full spin while the lid flies open.

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
        top: { value: new THREE.Color(0x3a3c42) },
        mid: { value: new THREE.Color(0x17181b) },
        bottom: { value: new THREE.Color(0x08080a) },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vDir;
        void main(){ float y = vDir.y;
          vec3 c = y > 0.0 ? mix(mid, top, smoothstep(0.0, 0.7, y)) : mix(mid, bottom, smoothstep(0.0, 0.8, -y));
          gl_FragColor = vec4(c, 1.0); }`,
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
  box(30, 10, 0xffffff, 3.2, [-18, 22, 22], [0, 0, 0]);
  box(8, 36, 0xffffff, 2.4, [34, 4, 14], [0, 0, 0]);
  box(40, 6, 0xdfe3ea, 0.9, [0, -10, 40], [0, 0, 0]);
  // dark flags (give the clear edges something to reflect)
  box(14, 40, 0x000000, 1, [-36, 0, 6], [0, 0, 0]);
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
  g.fillStyle = 'rgba(0,0,0,1)';
  g.beginPath();
  g.roundRect(inset, inset, 256 - inset * 2, 256 - inset * 2, 14);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// One jewel case (an album). Geometry and most materials are shared; each case
// owns its printed-disc material, its shadow cards and its animation state.
// ---------------------------------------------------------------------------
const SPACING = W * 1.32;   // distance between neighbouring cases in the row

class CaseItem {
  constructor(shared, album, index) {
    this.album = album;
    this.index = index;

    // root: placed by the row layout · tilt: hover/drag/spin · spread: shifts as the lid opens
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.spread = new THREE.Group();
    this.root.add(this.tilt);
    this.tilt.add(this.spread);

    const caseGroup = new THREE.Group();
    caseGroup.position.set(0, 0, -0.55);
    this.spread.add(caseGroup);

    this.basePlate = new THREE.Mesh(shared.geo.basePlate, shared.mat.plate);
    this.baseRails = new THREE.Mesh(shared.geo.baseRails, shared.mat.rail);
    this.basePlate.renderOrder = 1;
    this.baseRails.renderOrder = 2;
    caseGroup.add(this.basePlate, this.baseRails);

    this.lidPivot = new THREE.Group();
    this.lidPivot.position.set(-W / 2, 0, HINGE_Z);
    this.lidPlate = new THREE.Mesh(shared.geo.lidPlate, shared.mat.lidPlate);
    this.lidRim = new THREE.Mesh(shared.geo.lidRim, shared.mat.rail);
    this.lidPlate.renderOrder = 4;
    this.lidRim.renderOrder = 3;
    this.lidPivot.add(this.lidPlate, this.lidRim);
    caseGroup.add(this.lidPivot);

    // disc
    this.disc = new THREE.Group();
    this.disc.position.set(DISC_X, 0, DISC_Z);
    caseGroup.add(this.disc);
    const top = DISC_T / 2, bot = -DISC_T / 2;
    this.artMat = shared.mat.art.clone();
    const art = new THREE.Mesh(shared.geo.art, this.artMat);
    art.position.z = top + 0.001;
    const mirror = new THREE.Mesh(shared.geo.mirror, shared.mat.mirror);
    mirror.position.z = top;
    const rim = new THREE.Mesh(shared.geo.rim, shared.mat.mirror);
    rim.position.z = top;
    const hubClear = new THREE.Mesh(shared.geo.hubClear, shared.mat.clear);
    hubClear.position.z = top;
    hubClear.renderOrder = 2;
    const data = new THREE.Mesh(shared.geo.data, shared.mat.data);
    data.position.z = bot;
    const edge = new THREE.Mesh(shared.geo.edge, shared.mat.edge);
    this.disc.add(art, mirror, rim, hubClear, data, edge);
    this.discParts = [art, mirror, rim, data, edge, hubClear];
    this.caseParts = [this.basePlate, this.baseRails, this.lidPlate, this.lidRim];

    // shadow cards live on the "floor", outside the tilt
    this.shadows = new THREE.Group();
    const card = (tex, w, h, opacity) => new THREE.Mesh(
      shared.geo.unitPlane,
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, toneMapped: false })
    );
    this.shadow = card(shared.shadowTex, 1, 1, 0.24);
    this.shadow.scale.set(W * 1.6, H * 1.6, 1);
    this.shadowLid = card(shared.shadowTex, 1, 1, 0);
    this.shadowLid.scale.set(W * 1.6, H * 1.6, 1);
    this.contact = card(shared.contactTex, 1, 1, 0.2);
    this.contact.scale.set(W * 1.08, H * 1.08, 1);
    this.contact.position.z = 0.01;
    this.shadows.add(this.shadow, this.shadowLid, this.contact);

    this.s = {
      open: false, openP: 0, openE: 0,
      spinning: false, spinSpeed: 0, discAngle: 0, discBoost: 0,
      rot: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, dragging: false,
      hover: { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 },
      flourish: null,
      pop: 0, popT: 0, popDir: 1, popDelay: 0,   // pop-in / pop-out
      lay: { x: index * SPACING, sc: 1, ry: 0, z: 0 }, // smoothed layout
    };
  }

  setTexture(tex) {
    this.artMat.map = tex;
    this.artMat.emissiveMap = tex;
    this.artMat.needsUpdate = true;
  }

  setOpen(open, reduceMotion) {
    const s = this.s;
    if (s.open === open) return;
    s.open = open;
    if (!reduceMotion) {
      // full turn — one way to open, back the other way to close; the lid follows from it
      s.flourish = { t: 0, dir: open ? -1 : 1 };
      s.discBoost = open ? TAU * 2.6 : Math.max(s.discBoost, TAU * 1.2);
    }
  }

  // Per-frame animation. `lay` is the target layout from the row; returns the eased open amount.
  update(dt, t, lay, opts) {
    const s = this.s;
    const rm = opts.reduceMotion;

    // pop in / out
    if (s.popDelay > 0) s.popDelay -= dt;
    else s.popT = clamp(s.popT + s.popDir * dt / (s.popDir > 0 ? (rm ? 0.2 : 0.65) : (rm ? 0.12 : 0.28)), 0, 1);
    const popScale = s.popDir > 0 ? easeOutBack(s.popT) : easeInOut(s.popT);

    // layout smoothing (critically-damped-ish follow)
    const f = 1 - Math.exp(-(opts.snap ? 60 : 9) * dt);
    for (const k of ['x', 'sc', 'ry', 'z']) s.lay[k] += (lay[k] - s.lay[k]) * f;

    // lid (flung by the spin, both ways)
    const openDur = rm ? 0.25 : 0.55;
    const held = s.flourish && easeOutCubic(clamp(s.flourish.t, 0, 1)) < 0.8;
    s.openP = clamp(s.openP + (held ? 0 : s.open ? 1 : -1) * dt / openDur, 0, 1);
    const lidTarget = s.open ? easeOutCubic(s.openP) : 1 - easeOutCubic(1 - s.openP);
    s.openE += (lidTarget - s.openE) * (1 - Math.exp(-28 * dt));
    const openE = s.openE;
    this.lidPivot.rotation.y = -Math.PI * openE;
    this.spread.position.x = (W / 2) * openE;

    // disc
    const spinTarget = s.spinning ? TAU * 0.55 : 0;
    s.spinSpeed += (spinTarget - s.spinSpeed) * (1 - Math.exp(-(s.spinning ? 1.6 : 1.1) * dt));
    s.discBoost *= Math.exp(-1.3 * dt);
    if (s.discBoost < 0.01) s.discBoost = 0;
    s.discAngle -= (s.spinSpeed + s.discBoost) * dt;
    this.disc.rotation.z = s.discAngle;

    // hover wobble (loose spring)
    const h = s.hover;
    {
      const k = 55, c = 2 * Math.sqrt(k) * 0.26;
      const on = opts.hoverable && !s.dragging && !rm;
      h.vx += (-k * (h.x - (on ? h.tx : 0)) - c * h.vx) * dt;
      h.vy += (-k * (h.y - (on ? h.ty : 0)) - c * h.vy) * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
    }

    // the spin
    let fy = 0, lift = 0, tip = 0;
    if (s.flourish) {
      s.flourish.t += dt / 0.75;
      const ft = clamp(s.flourish.t, 0, 1);
      fy = s.flourish.dir * TAU * easeOutCubic(ft);
      lift = Math.sin(Math.PI * ft) * 2.2;
      tip = Math.sin(Math.PI * ft) * 0.18;
      if (s.flourish.t >= 1) {
        h.vy += 1.4 * s.flourish.dir;
        s.flourish = null;
      }
    }

    // drag spring back (nearest full turn)
    if (!s.dragging) {
      for (const axis of ['x', 'y']) {
        const goal = axis === 'y' ? Math.round(s.rot.y / TAU) * TAU : 0;
        const k = 14, c = 2 * Math.sqrt(k) * 0.75;
        s.vel[axis] += (-k * (s.rot[axis] - goal) - c * s.vel[axis]) * dt;
        s.rot[axis] += s.vel[axis] * dt;
      }
    }

    const idle = rm ? 0 : 1;
    const phase = this.index * 1.7;
    this.tilt.rotation.x = opts.restX + s.rot.x + h.x - tip + Math.sin(t * 0.7 + phase) * 0.025 * idle;
    this.tilt.rotation.y = opts.restY * (1 - openE * 0.6) + s.rot.y + h.y + fy + s.lay.ry
      + Math.sin(t * 0.45 + phase) * 0.04 * idle;
    this.tilt.rotation.z = h.y * -0.12;

    // pop-in rises from below
    const rise = s.popDir > 0 ? (1 - clamp(s.popT * 1.6, 0, 1)) * -4 : 0;
    const scale = Math.max(0.0001, s.lay.sc * popScale);
    this.root.position.set(s.lay.x, rise, FLOOR_GAP + lift + s.lay.z);
    this.root.scale.setScalar(scale);
    this.root.visible = scale > 0.002;

    // shadows
    const liftK = 1 / (1 + lift * 0.45);
    const sv = clamp(popScale, 0, 1) * (rise < -0.5 ? 0.3 : 1);
    this.shadows.position.set(s.lay.x, rise - 1.2 * scale, 0);
    this.shadows.scale.setScalar(scale);
    const spreadX = this.spread.position.x;
    this.shadow.position.set(1.1 + spreadX + lift * 0.5, -lift * 0.5, 0);
    this.shadow.material.opacity = 0.55 * sv * liftK;
    this.shadowLid.position.set(1.1 + spreadX - W, 0, 0);
    this.shadowLid.material.opacity = 0.25 * sv * Math.pow(openE, 3);
    this.contact.position.set(0.35 + spreadX, 0.75, 0.01);
    this.contact.material.opacity = 0.6 * sv * Math.pow(liftK, 3);
    this.shadows.visible = this.root.visible;

    return openE;
  }

  dispose(scene) {
    this.root.parent?.remove(this.root);
    this.shadows.parent?.remove(this.shadows);
    this.artMat.dispose();
    this.shadow.material.dispose();
    this.shadowLid.material.dispose();
    this.contact.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// The stage: a row of cases. Slide between them; the centred one can be
// opened (it spins, the lid flies open) while a side panel slides in.
//
//   stage.setAlbums(albums, focusIndex)   → pops the cases up
//   stage.clear()                         → pops them away (Promise)
//   stage.focusTo(i) / next() / prev()
//   stage.open() / close()                → open or close the centred case
//   stage.setPanelInset(px)               → keep the open case clear of a side panel
//   stage.setSpinningAlbum(albumId|null)
// Events: 'focuschange' {index} · 'openchange' {index, open} · 'disctap' {index}
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
    this.renderer.autoClear = false; // shadows render in their own pass first
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'aep-canvas';
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('role', 'listbox');
    this.canvas.setAttribute('aria-label', 'Albums. Left and right to browse, Enter to open, Escape to close.');
    container.prepend(this.canvas);

    // --- scene --------------------------------------------------------------
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const studio = buildStudioEnv();
    this.envRT = pmrem.fromScene(studio, 0.02);
    studio.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(26, 1, 1, 600);
    this.camera.position.set(0, 0, 60);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-8, 12, 20);
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1b1e, 0.25));

    this.row = new THREE.Group();
    this.scene.add(this.row);
    // Shadows live in a separate scene drawn underneath, so a case tilting
    // toward you can never dip "below the floor" and get shadowed over.
    this.shadowScene = new THREE.Scene();
    this.shadowRow = new THREE.Group();
    this.shadowScene.add(this.shadowRow);

    // --- shared geometry + materials ----------------------------------------
    const base = buildBaseGeometry();
    const lid = buildLidGeometry();
    const seg = 160, PRINT_IN = 1.95;
    const dataGeo = new THREE.RingGeometry(1.55, DISC_R, seg, 1);
    dataGeo.rotateY(Math.PI);
    const edgeGeo = new THREE.CylinderGeometry(DISC_R, DISC_R, DISC_T, seg, 1, true);
    edgeGeo.rotateX(Math.PI / 2);
    this.shared = {
      geo: {
        basePlate: base.plate, baseRails: base.rails,
        lidPlate: lid.plate, lidRim: lid.rim,
        art: new THREE.RingGeometry(PRINT_IN, DISC_R - 0.06, seg, 1),
        mirror: new THREE.RingGeometry(1.55, PRINT_IN, seg, 1),
        rim: new THREE.RingGeometry(DISC_R - 0.06, DISC_R, seg, 1),
        hubClear: new THREE.RingGeometry(HOLE_R, 1.55, 64, 1),
        data: dataGeo,
        edge: edgeGeo,
        unitPlane: new THREE.PlaneGeometry(1, 1),
      },
      mat: {
        plate: makePlastic({ opacity: 0.015, edge: 0.35, power: 3.0, body: 0x878d96, spec: 0.5, coat: 0, irid: 0, side: THREE.FrontSide }),
        rail: makePlastic({ opacity: 0.08, edge: 0.5, power: 1.8, body: 0x8a9099, spec: 1.1, irid: 0.18 }),
        lidPlate: makePlastic({ opacity: 0.01, edge: 0.5, power: 2.6, body: 0x9aa0a9, spec: 0.35, coat: 0, irid: 0 }),
        clear: makePlastic({ opacity: 0.05, edge: 0.5, power: 1.8, body: 0xa3a9b2, spec: 0.8, coat: 0, irid: 0 }),
        // printed label: cover at its true colours (emissive) + a glossy coat
        art: new THREE.MeshPhysicalMaterial({
          color: 0x1a1a1a, emissive: 0xffffff, emissiveIntensity: 1.0,
          roughness: 0.38, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.6,
        }),
        mirror: makeMirrorRing(),
        data: makeDataSide(),
        edge: new THREE.MeshStandardMaterial({ color: 0xd6dbe2, metalness: 0.7, roughness: 0.3 }),
      },
      shadowTex: makeShadowTexture(),
      contactTex: makeShadowTexture(7, 30),
    };

    // --- state --------------------------------------------------------------
    this.items = [];
    this.focus = 0;
    this.scroll = 0;          // fractional index under the centre
    this.scrollVel = 0;
    this.openIndex = -1;
    this.openAmt = 0;         // 0 browsing … 1 a case is open (smoothed)
    this.panelInset = 0;
    this.panelSide = 'right';
    this.panelOn = false;
    this.panelAmt = 0;
    this.spinningId = null;
    this.active = false;
    this.rest = { x: -0.2, y: 0.22 };
    this.clock = new THREE.Clock();
    this.fit = { worldPerPx: 0.05, viewH: 20, liftY: 0 };

    this._bindPointer();
    this._bindKeys();
    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(container);
    this._resize();

    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  // ---------------------------------------------------------------- public API
  get count() { return this.items.length; }
  get isOpen() { return this.openIndex >= 0; }

  /** Replace the row with these albums; they pop up around `focusIndex`. */
  async setAlbums(albums, focusIndex = 0) {
    const token = (this._token = (this._token || 0) + 1);
    if (this.items.length) await this.clear(true);
    if (token !== this._token) return;
    this.active = true;
    this.openIndex = -1;
    this.focus = clamp(focusIndex, 0, Math.max(0, albums.length - 1));
    this.scroll = this.focus;
    this.scrollVel = 0;
    this.items = albums.map((album, i) => {
      const it = new CaseItem(this.shared, album, i);
      it.s.lay = { ...this._layoutFor(i), sc: this._layoutFor(i).sc };
      it.s.popDelay = (this.reduceMotion ? 0 : 0.07) * Math.abs(i - this.focus);
      it.s.spinning = album.id === this.spinningId;
      this.row.add(it.root);
      this.shadowRow.add(it.shadows);
      it.root.visible = false;
      it.shadows.visible = false;
      loadCoverTexture(album, this.renderer).then(tex => it.setTexture(tex));
      return it;
    });
    this._emitFocus();
  }

  /** Pop every case away. Resolves when they're gone. */
  clear(keepActive = false) {
    if (!this.items.length) { if (!keepActive) this.active = false; return Promise.resolve(); }
    if (this.openIndex >= 0) this._setOpenIndex(-1);
    const leaving = this.items;
    this.items = [];
    leaving.forEach((it, i) => { it.s.popDir = -1; it.s.popT = Math.min(it.s.popT, 1); it.s.popDelay = 0.03 * Math.abs(i - this.focus); });
    this._leaving = (this._leaving || []).concat(leaving);
    return new Promise(resolve => {
      const check = () => {
        if (leaving.every(it => it.s.popT <= 0 && it.s.popDelay <= 0)) {
          leaving.forEach(it => it.dispose(this.scene));
          this._leaving = this._leaving.filter(it => !leaving.includes(it));
          if (!keepActive && !this.items.length) this.active = false;
          resolve();
        } else requestAnimationFrame(check);
      };
      check();
    });
  }

  focusTo(i) {
    if (!this.items.length) return;
    i = clamp(Math.round(i), 0, this.items.length - 1);
    if (this.openIndex >= 0 && i !== this.openIndex) this._setOpenIndex(-1);
    if (i !== this.focus) {
      this.focus = i;
      this._emitFocus();
    }
  }
  next() { this.focusTo(this.focus + 1); }
  prev() { this.focusTo(this.focus - 1); }

  open() { if (this.items.length) this._setOpenIndex(this.focus); }
  close() { this._setOpenIndex(-1); }

  /** Keep the open case clear of a panel on the right (or, in narrow windows, the bottom). */
  setPanelInset(px, side = 'right') {
    if (px) { this.panelInset = Math.max(0, px); this.panelSide = side; }
    this.panelOn = !!px;
  }

  setSpinningAlbum(id) {
    this.spinningId = id;
    this.items.forEach(it => { it.s.spinning = !!id && it.album.id === id; });
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this.resizeObserver.disconnect();
    [...this.items, ...(this._leaving || [])].forEach(it => it.dispose(this.scene));
    Object.values(this.shared.geo).forEach(g => g.dispose());
    Object.values(this.shared.mat).forEach(m => m.dispose());
    this.shared.shadowTex.dispose();
    this.shared.contactTex.dispose();
    this.envRT.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---------------------------------------------------------------- internals
  _emitFocus() {
    this.dispatchEvent(new CustomEvent('focuschange', { detail: { index: this.focus } }));
  }

  _setOpenIndex(i) {
    const prev = this.openIndex;
    if (prev === i) return;
    if (prev >= 0 && this.items[prev]) {
      this.items[prev].setOpen(false, this.reduceMotion);
      this.dispatchEvent(new CustomEvent('openchange', { detail: { index: prev, open: false } }));
    }
    this.openIndex = i;
    if (i >= 0 && this.items[i]) {
      if (this.focus !== i) { this.focus = i; this._emitFocus(); }
      this.items[i].setOpen(true, this.reduceMotion);
      this.dispatchEvent(new CustomEvent('openchange', { detail: { index: i, open: true } }));
    }
  }

  // Target layout for case i: a gentle cover-flow while browsing; when a case
  // is open, its neighbours slide out of the way and shrink to nothing.
  _layoutFor(i) {
    const off = i - this.scroll;
    const a = Math.min(Math.abs(off), 1.4);
    let x = off * SPACING - Math.sign(off) * a * W * 0.12;
    let sc = lerp(1, 0.74, Math.min(a, 1));
    const ry = -clamp(off, -1, 1) * 0.42;
    const z = -a * 2.4;
    if (this.openIndex >= 0 && i !== this.openIndex) {
      x += Math.sign(i - this.openIndex) * SPACING * 1.2 * this.openAmt;
      sc *= 1 - this.openAmt;
    }
    return { x, sc, ry: ry * (1 - this.openAmt * (i === this.openIndex ? 1 : 0)), z };
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._size = { w, h };
  }

  _frame(openE) {
    const { w, h } = this._size;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const right = this.panelSide === 'right' ? this.panelAmt * this.panelInset : 0;
    const bottomPanel = this.panelSide === 'bottom' ? this.panelAmt * this.panelInset : 0;
    const reserveTop = 56;
    const reserveBottom = Math.max(Math.min(120, h * 0.24) * (1 - this.openAmt) + 24 * this.openAmt, bottomPanel);
    const usableH = Math.max(80, h - reserveTop - reserveBottom);
    const usableW = Math.max(120, w - right);
    // browsing frames one case with its neighbours peeking in; open frames case + lid
    const needH = H * lerp(1.32, 1.3, this.openAmt);
    const needW = lerp(W * 1.25, (W + W * openE) * 1.06, this.openAmt);
    const dH = (needH / 2) / tanHalf * (h / usableH);
    const dW = (needW / 2) / (tanHalf * this.camera.aspect) * (w / usableW);
    const dist = Math.max(dH, dW);
    this.camera.position.set(0, 0, dist);
    this.camera.lookAt(0, 0, 0);
    const viewH = 2 * dist * tanHalf;
    this.fit.viewH = viewH;
    this.fit.worldPerPx = viewH / h;
    this.fit.liftY = ((reserveBottom - reserveTop) / 2) * this.fit.worldPerPx;
    this.fit.shiftX = -(right / 2) * this.fit.worldPerPx;
  }

  _visible() {
    return this.container.isConnected && this.container.offsetParent !== null && !document.hidden;
  }

  _loop() {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 1 / 15);
    if (!this._visible() || !this._size) return;
    const busy = this.active || (this._leaving && this._leaving.length);
    if (!busy) return;
    const t = this.clock.elapsedTime;

    // scroll toward focus (unless the user is dragging the row)
    if (!this._rowDrag) {
      const k = 40, c = 2 * Math.sqrt(k) * 0.9;
      this.scrollVel += (-k * (this.scroll - this.focus) - c * this.scrollVel) * dt;
      this.scroll += this.scrollVel * dt;
    }
    const openT = this.openIndex >= 0 ? 1 : 0;
    this.openAmt += (openT - this.openAmt) * (1 - Math.exp(-7 * dt));
    this.panelAmt += ((this.panelOn ? 1 : 0) - this.panelAmt) * (1 - Math.exp(-7 * dt));

    // framing follows the open case's lid
    const openItem = this.items[this.openIndex] || this.items[this._lastOpen] || null;
    if (this.openIndex >= 0) this._lastOpen = this.openIndex;
    const openE = openItem ? openItem.s.openE : 0;
    this._frame(openE);
    this.row.position.set(this.fit.shiftX, this.fit.liftY, 0);
    this.shadowRow.position.copy(this.row.position);

    const opts = { reduceMotion: this.reduceMotion, restX: this.rest.x, restY: this.rest.y, snap: false };
    this.items.forEach((it, i) => {
      const lay = this._layoutFor(i);
      it.update(dt, t, lay, { ...opts, hoverable: i === this.focus });
    });
    (this._leaving || []).forEach(it => it.update(dt, t, it.s.lay, { ...opts, hoverable: false }));

    this.renderer.clear();
    this.renderer.render(this.shadowScene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- pointer
  _pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    ray.setFromCamera(ndc, this.camera);
    let best = null;
    this.items.forEach((it, i) => {
      if (!it.root.visible || it.root.scale.x < 0.1) return;
      const d = ray.intersectObjects(it.discParts, false)[0];
      const c = ray.intersectObjects(it.caseParts, false)[0];
      const hit = d && c ? (d.distance < c.distance ? d : c) : (d || c);
      if (hit && (!best || hit.distance < best.dist)) best = { index: i, dist: hit.distance, disc: !!d, discFirst: !!d && (!c || d.distance <= c.distance) };
    });
    return best;
  }

  _bindPointer() {
    const el = this.canvas;
    let down = null;
    let lastHover = null;

    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      const openItem = this.items[this.openIndex];
      down = {
        x: e.clientX, y: e.clientY, t: e.timeStamp, lx: e.clientX, ly: e.clientY, lt: performance.now(),
        moved: false, mode: openItem ? 'turn' : 'row', startScroll: this.scroll, vx: 0,
      };
      if (openItem) { openItem.s.vel.x = openItem.s.vel.y = 0; }
    });

    el.addEventListener('pointermove', e => {
      const focusItem = this.items[this.focus];
      if (!down) {
        if (!focusItem) return;
        const r = el.getBoundingClientRect();
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
        const hv = focusItem.s.hover;
        hv.ty = clamp(nx, -1, 1) * 0.24;
        hv.tx = clamp(ny, -1, 1) * 0.18;
        if (lastHover) {
          hv.vy += clamp((e.clientX - lastHover.x) * 0.012, -0.6, 0.6);
          hv.vx += clamp((e.clientY - lastHover.y) * 0.01, -0.5, 0.5);
        }
        lastHover = { x: e.clientX, y: e.clientY };
        const p = this._pick(e);
        const openItem = this.items[this.openIndex];
        el.style.cursor = !p ? 'default'
          : (openItem && p.index === this.openIndex && p.disc && openItem.s.openP > 0.6) ? 'pointer'
          : (this.openIndex < 0) ? 'pointer' : 'grab';
        return;
      }
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 6) {
        down.moved = true;
        el.style.cursor = 'grabbing';
        if (down.mode === 'turn') this.items[this.openIndex].s.dragging = true;
        else this._rowDrag = true;
      }
      if (!down.moved) return;
      const now = performance.now();
      const mx = e.clientX - down.lx, my = e.clientY - down.ly;
      const dtm = Math.max(1, now - down.lt) / 1000;
      if (down.mode === 'turn') {
        const s = this.items[this.openIndex].s;
        s.rot.y += mx * 0.0105;
        s.rot.x = clamp(s.rot.x + my * 0.0085, -1.25, 1.25);
        s.vel.y = lerp(s.vel.y, (mx * 0.0105) / dtm, 0.5);
        s.vel.x = lerp(s.vel.x, (my * 0.0085) / dtm, 0.5);
      } else {
        const pxPerCase = SPACING / this.fit.worldPerPx;
        const n = this.items.length;
        let sc = down.startScroll - dx / pxPerCase;
        // rubber-band past the ends
        if (sc < 0) sc = sc * 0.35;
        if (sc > n - 1) sc = n - 1 + (sc - (n - 1)) * 0.35;
        this.scroll = sc;
        down.vx = lerp(down.vx, -(mx / pxPerCase) / dtm, 0.4);
        // the focused case swings a little with the drag
        const fi = this.items[this.focus];
        if (fi) fi.s.hover.vy += clamp(mx * 0.01, -0.4, 0.4);
      }
      down.lx = e.clientX; down.ly = e.clientY; down.lt = now;
    });

    const end = e => {
      if (!down) return;
      const d = down;
      down = null;
      el.style.cursor = 'grab';
      if (d.mode === 'turn' && this.items[this.openIndex]) this.items[this.openIndex].s.dragging = false;
      if (this._rowDrag) {
        this._rowDrag = false;
        this.scrollVel = d.vx;
        this.focusTo(Math.round(this.scroll + d.vx * 0.18));
        return;
      }
      const wasTap = !d.moved && e.timeStamp - d.t < 600;
      if (!wasTap) return;
      const p = this._pick(e);
      if (!p) return;
      if (this.openIndex >= 0) {
        const it = this.items[this.openIndex];
        if (p.index !== this.openIndex) return;
        if (p.disc && (it.s.openP > 0.6 || p.discFirst)) this.dispatchEvent(new CustomEvent('disctap', { detail: { index: p.index } }));
        else this.close();
      } else if (p.index !== this.focus) {
        this.focusTo(p.index);
      } else {
        this.open();
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => {
      if (down && down.mode === 'turn' && this.items[this.openIndex]) this.items[this.openIndex].s.dragging = false;
      if (this._rowDrag) { this._rowDrag = false; this.focusTo(Math.round(this.scroll)); }
      down = null;
    });
    el.addEventListener('pointerleave', () => {
      lastHover = null;
      this.items.forEach(it => { it.s.hover.tx = 0; it.s.hover.ty = 0; });
    });

    // wheel / trackpad: step through the row
    let acc = 0, lastStep = 0;
    el.addEventListener('wheel', e => {
      if (this.openIndex >= 0 || this.items.length < 2) return;
      e.preventDefault();
      acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const now = performance.now();
      if (Math.abs(acc) > 40 && now - lastStep > 160) {
        this.focusTo(this.focus + Math.sign(acc));
        acc = 0;
        lastStep = now;
      }
    }, { passive: false });
  }

  _bindKeys() {
    this.canvas.addEventListener('keydown', e => {
      const open = this.openIndex >= 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (open) this.items[this.openIndex].s.vel.y += 2.5 * dir;
        else this.focusTo(this.focus + dir);
      }
      if (e.key === 'Enter') { e.preventDefault(); open ? this.close() : this.open(); }
      if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); this.close(); }
    });
  }
}
