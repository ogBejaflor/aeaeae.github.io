// Deterministic edge highlights. Coordinates come from the continuous logo
// contours and are inset until the decoded numerical SDF is -1 source pixel.
// No random state, raster sparkle sprites, or frame-history dependencies.

const WORLD_WIDTH = 4.65;
const PADDING = 40;
const SOURCE_HEIGHT = 313;

// Original full-logo crop coordinates, y down. For the compact artwork only
// the exclamation shifts 100 source pixels left; its shape stays identical.
// The `source` points were checked against the v2 RG16 distance textures.
export const EDGE_GLINT_ANCHOR_SOURCE = Object.freeze({
  'ae-top-left':       Object.freeze({ shape: 'ae', source: Object.freeze([110.00138, .26759]) }),
  'ae-top-right':      Object.freeze({ shape: 'ae', source: Object.freeze([268.00227, .33685]) }),
  'ae-left-cap':       Object.freeze({ shape: 'ae', source: Object.freeze([6.57087, 77.94410]) }),
  'ae-bottom-left':    Object.freeze({ shape: 'ae', source: Object.freeze([87.04475, 230.83410]) }),
  'ae-bottom-right':   Object.freeze({ shape: 'ae', source: Object.freeze([269.99556, 231.61722]) }),
  'note-tip':          Object.freeze({ shape: 'note', source: Object.freeze([455.01182, .90414]) }),
  'note-flag':         Object.freeze({ shape: 'note', source: Object.freeze([517.87083, 129.01852]) }),
  'note-bottom':       Object.freeze({ shape: 'note', source: Object.freeze([410.09057, 231.34261]) }),
  'trademark-t':       Object.freeze({ shape: 'trademark', source: Object.freeze([535.00700, .98723]) }),
  'trademark-m':       Object.freeze({ shape: 'trademark', source: Object.freeze([664.96469, 1.01383]) }),
  'exclamation-tip':   Object.freeze({ shape: 'exclamation-stem', source: Object.freeze([705.00000, .50096]) }),
  'exclamation-dot':   Object.freeze({ shape: 'exclamation-dot', source: Object.freeze([711.00000, 114.49904]) })
});

function makeAnchors(compact) {
  const width = compact ? 695 : 795;
  const anchors = {};
  for (const [name, anchor] of Object.entries(EDGE_GLINT_ANCHOR_SOURCE)) {
    if (compact && anchor.shape === 'trademark') continue;
    const x = anchor.source[0] - (compact && name.startsWith('exclamation-') ? 100 : 0);
    const y = anchor.source[1];
    // Texture texel centres refer to sourcePixel + .5. This is the same
    // coordinate convention used by the SDF sampler and the shader's camera.
    anchors[name] = Object.freeze([
      (x + PADDING + .5 - width / 2) * WORLD_WIDTH / width,
      (SOURCE_HEIGHT / 2 - y - PADDING - .5) * WORLD_WIDTH / width
    ]);
  }
  return Object.freeze(anchors);
}

export const EDGE_GLINT_ANCHORS = Object.freeze({
  compact: makeAnchors(true),
  full: makeAnchors(false)
});

export const EDGE_GLINT_METADATA = Object.freeze({
  slots: 12,
  componentsPerSlot: 4,
  coordinateSystem: 'logo-local, y-up, unscaled',
  worldTextureWidth: WORLD_WIDTH,
  insetSourcePixels: 1,
  sourceTextureWidthCompact: 695,
  sourceTextureWidthFull: 795,
  sourceTextureHeight: SOURCE_HEIGHT,
  clock: 'canonical scene seconds, 0 to 9.2',
  defaultAddedAccents: 9,
  maximumAddedAccents: 12,
  sizeConvention: '1 preserves the renderer\'s existing tiny-glint core and streak dimensions',
  globalStrengthAppliedHere: false,
  finishFade: Object.freeze([8.8, 9.15])
});

// [time, anchor, peak amount, half-width at multiplier 1, size multiplier,
//  density rank]. A second anchor name is used only for the full TM artwork.
// Lower ranks are spread across the ending, so reducing density does not
// simply truncate its last moments. Rank 0 stays useful at Inspect Logo 8.35s.
const EARLY = Object.freeze([
  Object.freeze([5.32, 'ae-top-left',     .85, .170, 1.00]),
  Object.freeze([6.33, 'note-tip',        .80, .185,  .95]),
  Object.freeze([7.05, 'exclamation-tip', .65, .180,  .82])
]);
const LATE = Object.freeze([
  Object.freeze([7.32, 'ae-top-right',    .64, .185,  .94, 1]),
  Object.freeze([7.49, 'note-flag',       .57, .190,  .80, 5]),
  Object.freeze([7.67, 'ae-bottom-left',  .57, .205,  .90, 7]),
  Object.freeze([7.85, 'note-tip',        .62, .185,  .88, 3, 'trademark-t']),
  Object.freeze([8.03, 'ae-left-cap',     .60, .200,  .86, 8]),
  Object.freeze([8.19, 'note-bottom',     .54, .210,  .87, 4]),
  Object.freeze([8.35, 'ae-top-right',    .82, .220, 1.04, 0]),
  Object.freeze([8.58, 'exclamation-dot', .56, .195,  .78, 6]),
  Object.freeze([8.84, 'ae-bottom-right', .62, .220,  .92, 2]),
  // Above default density, reuse the same uniform slots for three additional
  // accents. At this stage the earlier accents have already faded away.
  Object.freeze([7.75, 'exclamation-tip', .44, .180,  .74, 9]),
  Object.freeze([8.29, 'ae-bottom-right', .43, .190,  .79, 10, 'trademark-m']),
  Object.freeze([8.72, 'note-tip',        .48, .205,  .84, 11])
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
function ease(a, b, value) {
  const x = clamp((value - a) / (b - a), 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}
function densityWeight(rank, density) {
  const threshold = rank < 9 ? (rank + 1) / 9 : 1 + (rank - 8) / 3;
  return ease(threshold - (rank < 9 ? .10 : .20), threshold, density);
}
function pulse(t, event, duration) {
  const offset = (t - event[0]) / (event[3] * duration);
  // The explicit tiny-tail cutoff keeps vacant slots exactly vacant while
  // remaining far below a visible discontinuity. Half-width means half peak.
  if (Math.abs(offset) > 4.1) return 0;
  return event[2] * Math.exp(-Math.LN2 * offset * offset);
}

/**
 * Return twelve packed vec4 records: [localX, localY, amount, sizeMultiplier].
 * `t` is canonical scene time, independent of real playback duration.
 * The renderer scales x/y by logo size, projects the actual rounded surface,
 * and applies options.glintStrength exactly once. Reduced-motion renderers
 * skip the glints; a literal reducedMotion:true also returns a zero buffer.
 */
export function getEdgeGlints(t, options = {}) {
  const packed = new Float32Array(48);
  t = Number(t);
  if (!Number.isFinite(t) || t <= 0 || t >= 9.15 || options.reducedMotion === true) return packed;
  const duration = clamp(numberOr(options.glintDuration, 1.2), .6, 2);
  const density = clamp(numberOr(options.endGlints, 1), 0, 2);
  const full = options.trademark === true;
  const anchors = full ? EDGE_GLINT_ANCHORS.full : EDGE_GLINT_ANCHORS.compact;
  const finish = 1 - ease(8.8, 9.15, t);
  const candidates = [];
  let order = 0;
  const add = (event, weight) => {
    const amount = pulse(t, event, duration) * weight * finish;
    const eventOrder = order++;
    if (amount < .00005) return;
    const anchor = anchors[full && event[6] ? event[6] : event[1]];
    candidates.push({ anchor, amount, size: event[4], order: eventOrder });
  };
  for (const event of EARLY) add(event, 1);
  if (density > 0) for (const event of LATE) add(event, densityWeight(event[5], density));
  // A fixed-size uniform buffer supports denser settings without persistent
  // particle slots. Reordering is visually neutral because the light is summed.
  candidates.sort((a, b) => b.amount - a.amount || a.order - b.order);
  for (let i = 0; i < Math.min(12, candidates.length); i++) {
    const event = candidates[i], base = i * 4;
    packed[base] = event.anchor[0];
    packed[base + 1] = event.anchor[1];
    packed[base + 2] = event.amount;
    packed[base + 3] = event.size;
  }
  return packed;
}
