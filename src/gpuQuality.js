/**
 * GPU quality tiering — keep the globe usable on integrated and software
 * renderers.
 *
 * The problem this solves is not "the app is slow", it is "the app is slow on
 * the wrong GPU". A photorealistic 3D globe at 4x MSAA and full resolution is
 * a discrete-GPU workload. Measured on an i5-11400H laptop at 1920x945 with
 * the scene parked:
 *
 *   | renderer                  | msaa | scale | FPS  | median frame |
 *   |---------------------------|------|-------|------|--------------|
 *   | Intel UHD (as shipped)    |    4 |   1.0 |  7.0 |     114.4 ms |
 *   | Intel UHD                 |    1 |   1.0 | 10.5 |      87.4 ms |
 *   | Intel UHD                 |    1 |   0.7 | 14.7 |      67.5 ms |
 *   | Intel UHD                 |    1 |   0.5 | 16.2 |      59.4 ms |
 *   | RTX 2050 (as shipped)     |    4 |   1.0 | 80.0 |       7.1 ms |
 *
 * Two things follow from that table. First, the render settings are worth
 * roughly 2x on a weak part — real, and the difference between "unusable" and
 * "navigable". Second, they are NOT the main lever: the discrete GPU is worth
 * 11x, and no amount of quality reduction closes that gap. So this module
 * degrades quality AND reports the renderer it found, because on a hybrid
 * laptop the actionable fix is an OS-level GPU assignment, not a smaller
 * framebuffer. `src/main.js` requests `powerPreference: 'high-performance'`,
 * but that is a hint Chrome on Windows was measured to ignore.
 *
 * Classification is a substring match on the WebGL `UNMASKED_RENDERER_WEBGL`
 * string. That string is vendor-formatted and unstable across drivers, so the
 * matching is deliberately coarse and the result is always overridable — a
 * wrong guess must never be something a user cannot undo. Apple Silicon is
 * explicitly NOT treated as integrated: it shares memory with the CPU but
 * renders in the discrete performance class.
 *
 * @module gpuQuality
 */

/** localStorage key holding a persisted tier override. */
export const QUALITY_OVERRIDE_KEY = 'godsEyeView.gpuQuality.v1';

/** Quality settings applied per tier. `null` means "leave Cesium's default". */
export const QUALITY_TIERS = Object.freeze({
  discrete: Object.freeze({ msaaSamples: null, resolutionScale: null }),
  unknown: Object.freeze({ msaaSamples: null, resolutionScale: null }),
  integrated: Object.freeze({ msaaSamples: 1, resolutionScale: 0.7 }),
  software: Object.freeze({ msaaSamples: 1, resolutionScale: 0.5 }),
});

/** Renderer substrings that indicate a CPU/software rasterizer. */
const SOFTWARE_MARKERS = Object.freeze([
  'swiftshader',
  'llvmpipe',
  'softpipe',
  'microsoft basic render',
  'basic render driver',
  'mesa offscreen',
]);

/** Renderer substrings that indicate an integrated/shared-memory GPU. */
const INTEGRATED_MARKERS = Object.freeze([
  'intel(r) hd graphics',
  'intel(r) uhd graphics',
  'intel hd graphics',
  'intel uhd graphics',
  'hd graphics',
  'uhd graphics',
  'intel(r) iris',
  'intel iris',
  'radeon(tm) vega',
  'radeon vega',
  'radeon(tm) graphics',
  'amd radeon(tm) r',
  'mali',
  'adreno',
  'powervr',
  'videocore',
]);

/** Renderer substrings that indicate a discrete or discrete-class GPU. */
const DISCRETE_MARKERS = Object.freeze([
  'nvidia',
  'geforce',
  'quadro',
  'rtx',
  'gtx',
  'radeon rx',
  'radeon pro',
  'firepro',
  'apple m',
  'arc(tm) a',
  'intel(r) arc',
]);

/**
 * Classify a WebGL renderer string into a quality tier.
 *
 * Order matters: software markers win outright, then discrete, then
 * integrated. Discrete is checked BEFORE integrated because hybrid strings
 * routinely name both parts (an ANGLE string can carry the vendor of one and
 * the adapter of another), and misreading a real discrete GPU as integrated
 * would silently halve the resolution of a machine that never needed it.
 *
 * @param {string} renderer Raw `UNMASKED_RENDERER_WEBGL` value.
 * @returns {{ tier: 'software'|'integrated'|'discrete'|'unknown', renderer: string, matched: string|null }}
 */
export function classifyRenderer(renderer) {
  const raw = String(renderer ?? '').trim();
  const text = raw.toLowerCase();
  if (!text) return { tier: 'unknown', renderer: raw, matched: null };

  for (const marker of SOFTWARE_MARKERS) {
    if (text.includes(marker)) return { tier: 'software', renderer: raw, matched: marker };
  }
  for (const marker of DISCRETE_MARKERS) {
    if (text.includes(marker)) return { tier: 'discrete', renderer: raw, matched: marker };
  }
  for (const marker of INTEGRATED_MARKERS) {
    if (text.includes(marker)) return { tier: 'integrated', renderer: raw, matched: marker };
  }
  return { tier: 'unknown', renderer: raw, matched: null };
}

/**
 * Quality settings for a tier. Unrecognized tiers fall back to `unknown`,
 * which changes nothing — an unreadable renderer string must not cost a
 * capable machine any pixels.
 * @param {string} tier
 * @returns {{ msaaSamples: number|null, resolutionScale: number|null }}
 */
export function qualityForTier(tier) {
  return QUALITY_TIERS[tier] ?? QUALITY_TIERS.unknown;
}

/**
 * Read the unmasked renderer string from a live WebGL context.
 * Returns '' when the context or the debug extension is unavailable —
 * headless and privacy-hardened browsers both withhold it.
 * @param {WebGLRenderingContext|WebGL2RenderingContext|null} gl
 * @returns {string}
 */
export function readRendererString(gl) {
  if (!gl || typeof gl.getExtension !== 'function') return '';
  try {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const unmasked = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      if (unmasked) return String(unmasked);
    }
    return String(gl.getParameter(gl.RENDERER) ?? '');
  } catch {
    return '';
  }
}

/**
 * Resolve an explicit user override, in precedence order: URL `?gpu=` wins
 * over the persisted choice, so a shared link or a one-off test never has to
 * fight a stored value. Accepts any tier name plus 'auto' (clear).
 * @param {{ search?: string, storage?: Storage|null }} [sources]
 * @returns {string|null} tier name, 'auto', or null when unset
 */
export function readQualityOverride({ search = '', storage = null } = {}) {
  const valid = new Set([...Object.keys(QUALITY_TIERS), 'auto']);
  try {
    const fromUrl = new URLSearchParams(search).get('gpu');
    if (fromUrl && valid.has(fromUrl.toLowerCase())) return fromUrl.toLowerCase();
  } catch {
    // malformed query string — fall through to storage
  }
  try {
    const stored = storage?.getItem?.(QUALITY_OVERRIDE_KEY);
    if (stored && valid.has(stored.toLowerCase())) return stored.toLowerCase();
  } catch {
    // storage can throw in private-mode / partitioned contexts
  }
  return null;
}

/**
 * Decide the tier to apply, folding an override over the detected tier.
 * @param {string} detectedTier
 * @param {string|null} override
 * @returns {{ tier: string, source: 'auto'|'override' }}
 */
export function resolveTier(detectedTier, override) {
  if (override && override !== 'auto' && override in QUALITY_TIERS) {
    return { tier: override, source: 'override' };
  }
  return { tier: detectedTier, source: 'auto' };
}

/**
 * Detect the GPU tier and apply the matching quality settings to a viewer.
 *
 * Applies nothing for the discrete/unknown tiers, so a capable machine renders
 * byte-identically to the pre-tiering build. Never throws: a viewer that does
 * not expose a WebGL context still yields a usable (unknown-tier) decision.
 *
 * @param {object} viewer Cesium viewer.
 * @param {object} [options]
 * @param {string} [options.rendererOverride] Bypass GL probing (tests).
 * @param {string} [options.search] Query string, defaults to `location.search`.
 * @param {Storage|null} [options.storage] Defaults to `localStorage`.
 * @returns {{ tier: string, source: string, renderer: string, matched: string|null, applied: object }}
 */
export function applyGpuQuality(viewer, options = {}) {
  const scene = viewer?.scene ?? null;
  const gl = scene?.context?._gl ?? null;
  const renderer = options.rendererOverride ?? readRendererString(gl);
  const detected = classifyRenderer(renderer);

  const search = options.search
    ?? (typeof location !== 'undefined' ? location.search : '');
  const storage = options.storage !== undefined
    ? options.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null);

  const override = readQualityOverride({ search, storage });
  const { tier, source } = resolveTier(detected.tier, override);
  const quality = qualityForTier(tier);
  const applied = { msaaSamples: null, resolutionScale: null };

  if (scene && quality.msaaSamples !== null) {
    scene.msaaSamples = quality.msaaSamples;
    applied.msaaSamples = quality.msaaSamples;
  }
  if (viewer && quality.resolutionScale !== null) {
    viewer.resolutionScale = quality.resolutionScale;
    applied.resolutionScale = quality.resolutionScale;
  }

  return { tier, source, renderer: detected.renderer, matched: detected.matched, applied };
}

/**
 * Human-readable console advice for a decision. Hybrid laptops are the case
 * worth spending a warning on: the user has a fast GPU already installed and
 * the browser simply is not using it, which no in-app setting can fix.
 * @param {{ tier: string, source: string, renderer: string, applied: object }} decision
 * @returns {{ level: 'info'|'warn', message: string }}
 */
export function describeQualityDecision(decision) {
  const { tier, source, renderer, applied } = decision;
  const label = renderer || 'unknown renderer';
  if (tier === 'discrete' || tier === 'unknown') {
    return { level: 'info', message: `[GPUQuality] ${label} — full quality (tier: ${tier}).` };
  }
  const parts = [];
  if (applied.msaaSamples !== null) parts.push(`MSAA ${applied.msaaSamples}x`);
  if (applied.resolutionScale !== null) parts.push(`resolution ${applied.resolutionScale}x`);
  const reduced = parts.length ? parts.join(', ') : 'no changes';
  const how = source === 'override' ? 'forced by override' : 'auto-detected';
  return {
    level: 'warn',
    message: `[GPUQuality] ${label} — ${tier} GPU ${how}; reduced to ${reduced}. `
      + 'On a laptop with a discrete GPU, assign your browser to it '
      + '(Windows: Settings > Display > Graphics; macOS: disable Automatic Graphics Switching) '
      + 'for a far larger gain. Override with ?gpu=discrete to keep full quality.',
  };
}
