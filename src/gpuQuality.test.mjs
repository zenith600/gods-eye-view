import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRenderer,
  qualityForTier,
  readRendererString,
  readQualityOverride,
  resolveTier,
  applyGpuQuality,
  describeQualityDecision,
  QUALITY_TIERS,
  QUALITY_OVERRIDE_KEY,
} from './gpuQuality.js';

/** Minimal viewer double: only the surfaces applyGpuQuality writes through. */
function makeViewer(gl = null) {
  const scene = { msaaSamples: 4, context: { _gl: gl } };
  return { scene, resolutionScale: 1 };
}

/** Storage double that can also simulate a throwing (private-mode) store. */
function makeStorage(values = {}, { throws = false } = {}) {
  return {
    getItem(key) {
      if (throws) throw new Error('storage unavailable');
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
  };
}

// ── classification ─────────────────────────────────────────────────────────

test('classifies the measured Intel UHD hybrid-laptop string as integrated', () => {
  const result = classifyRenderer(
    'ANGLE (Intel, Intel(R) UHD Graphics (0x00009A68) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  );
  assert.equal(result.tier, 'integrated');
  assert.equal(result.matched, 'intel(r) uhd graphics');
});

test('classifies the measured RTX 2050 string as discrete', () => {
  const result = classifyRenderer(
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 2050 (0x000025AD) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  );
  assert.equal(result.tier, 'discrete');
});

test('classifies SwiftShader as software', () => {
  const result = classifyRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)');
  assert.equal(result.tier, 'software');
  assert.equal(result.matched, 'swiftshader');
});

test('classifies llvmpipe and the Microsoft Basic Render Driver as software', () => {
  assert.equal(classifyRenderer('llvmpipe (LLVM 15.0.7, 256 bits)').tier, 'software');
  assert.equal(classifyRenderer('Microsoft Basic Render Driver').tier, 'software');
});

test('Apple Silicon is discrete-class, never integrated', () => {
  assert.equal(classifyRenderer('ANGLE (Apple, Apple M5, OpenGL 4.1)').tier, 'discrete');
});

test('discrete markers win over integrated ones in a hybrid string', () => {
  // ANGLE strings can name an Intel vendor alongside a discrete adapter.
  // Reading that as integrated would halve resolution on a capable machine.
  const result = classifyRenderer('ANGLE (Intel, NVIDIA GeForce RTX 4070, D3D11)');
  assert.equal(result.tier, 'discrete');
});

test('software markers win over discrete ones', () => {
  const result = classifyRenderer('ANGLE (NVIDIA, SwiftShader Device, D3D11)');
  assert.equal(result.tier, 'software');
});

test('unreadable renderer strings classify as unknown, not as weak', () => {
  for (const value of ['', '   ', null, undefined]) {
    const result = classifyRenderer(value);
    assert.equal(result.tier, 'unknown');
    assert.equal(result.matched, null);
  }
});

test('classification is case-insensitive', () => {
  assert.equal(classifyRenderer('INTEL(R) UHD GRAPHICS 630').tier, 'integrated');
});

// ── tier settings ──────────────────────────────────────────────────────────

test('discrete and unknown tiers change nothing', () => {
  for (const tier of ['discrete', 'unknown']) {
    const quality = qualityForTier(tier);
    assert.equal(quality.msaaSamples, null);
    assert.equal(quality.resolutionScale, null);
  }
});

test('integrated and software tiers drop MSAA and resolution', () => {
  assert.deepEqual(qualityForTier('integrated'), { msaaSamples: 1, resolutionScale: 0.7 });
  assert.deepEqual(qualityForTier('software'), { msaaSamples: 1, resolutionScale: 0.5 });
});

test('software degrades at least as far as integrated', () => {
  const soft = qualityForTier('software');
  const integrated = qualityForTier('integrated');
  assert.ok(soft.resolutionScale <= integrated.resolutionScale);
});

test('an unrecognized tier name falls back to leaving quality alone', () => {
  assert.deepEqual(qualityForTier('nonsense'), QUALITY_TIERS.unknown);
});

// ── renderer probing ───────────────────────────────────────────────────────

test('readRendererString prefers the unmasked debug string', () => {
  const gl = {
    getExtension: (name) => (name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 37446 } : null),
    getParameter: (p) => (p === 37446 ? 'NVIDIA GeForce RTX 2050' : 'masked'),
    RENDERER: 7937,
  };
  assert.equal(readRendererString(gl), 'NVIDIA GeForce RTX 2050');
});

test('readRendererString falls back to gl.RENDERER without the debug extension', () => {
  const gl = { getExtension: () => null, getParameter: (p) => (p === 7937 ? 'WebKit WebGL' : null), RENDERER: 7937 };
  assert.equal(readRendererString(gl), 'WebKit WebGL');
});

test('readRendererString survives a missing context or a throwing driver', () => {
  assert.equal(readRendererString(null), '');
  assert.equal(readRendererString({}), '');
  const hostile = { getExtension() { throw new Error('blocked'); } };
  assert.equal(readRendererString(hostile), '');
});

// ── overrides ──────────────────────────────────────────────────────────────

test('the URL parameter outranks a persisted override', () => {
  const storage = makeStorage({ [QUALITY_OVERRIDE_KEY]: 'software' });
  assert.equal(readQualityOverride({ search: '?gpu=discrete', storage }), 'discrete');
});

test('a persisted override applies when the URL says nothing', () => {
  const storage = makeStorage({ [QUALITY_OVERRIDE_KEY]: 'integrated' });
  assert.equal(readQualityOverride({ search: '', storage }), 'integrated');
});

test('unrecognized override values are ignored', () => {
  assert.equal(readQualityOverride({ search: '?gpu=turbo', storage: null }), null);
});

test('a throwing storage does not break override reading', () => {
  assert.equal(readQualityOverride({ search: '', storage: makeStorage({}, { throws: true }) }), null);
});

test('resolveTier honors a real override and ignores auto', () => {
  assert.deepEqual(resolveTier('integrated', 'discrete'), { tier: 'discrete', source: 'override' });
  assert.deepEqual(resolveTier('integrated', 'auto'), { tier: 'integrated', source: 'auto' });
  assert.deepEqual(resolveTier('integrated', null), { tier: 'integrated', source: 'auto' });
});

// ── application ────────────────────────────────────────────────────────────

test('an integrated GPU gets MSAA and resolution reduced on the viewer', () => {
  const viewer = makeViewer();
  const decision = applyGpuQuality(viewer, {
    rendererOverride: 'Intel(R) UHD Graphics',
    search: '',
    storage: null,
  });
  assert.equal(decision.tier, 'integrated');
  assert.equal(decision.source, 'auto');
  assert.equal(viewer.scene.msaaSamples, 1);
  assert.equal(viewer.resolutionScale, 0.7);
});

test('a discrete GPU is left byte-identical to the pre-tiering build', () => {
  const viewer = makeViewer();
  const decision = applyGpuQuality(viewer, {
    rendererOverride: 'NVIDIA GeForce RTX 2050',
    search: '',
    storage: null,
  });
  assert.equal(decision.tier, 'discrete');
  assert.equal(viewer.scene.msaaSamples, 4, 'MSAA must not be touched on a capable GPU');
  assert.equal(viewer.resolutionScale, 1, 'resolution must not be touched on a capable GPU');
  assert.deepEqual(decision.applied, { msaaSamples: null, resolutionScale: null });
});

test('?gpu=discrete keeps full quality on a detected integrated GPU', () => {
  const viewer = makeViewer();
  const decision = applyGpuQuality(viewer, {
    rendererOverride: 'Intel(R) UHD Graphics',
    search: '?gpu=discrete',
    storage: null,
  });
  assert.equal(decision.source, 'override');
  assert.equal(viewer.scene.msaaSamples, 4);
  assert.equal(viewer.resolutionScale, 1);
});

test('applyGpuQuality does not throw without a viewer or a GL context', () => {
  const decision = applyGpuQuality(null, { search: '', storage: null });
  assert.equal(decision.tier, 'unknown');
  assert.deepEqual(decision.applied, { msaaSamples: null, resolutionScale: null });
});

test('applyGpuQuality probes the live context when no override is supplied', () => {
  const gl = {
    getExtension: (name) => (name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 37446 } : null),
    getParameter: () => 'Intel(R) Iris(R) Xe Graphics',
    RENDERER: 7937,
  };
  const viewer = makeViewer(gl);
  const decision = applyGpuQuality(viewer, { search: '', storage: null });
  assert.equal(decision.tier, 'integrated');
  assert.equal(viewer.scene.msaaSamples, 1);
});

// ── reporting ──────────────────────────────────────────────────────────────

test('a weak tier warns and names the OS-level GPU fix', () => {
  const decision = applyGpuQuality(makeViewer(), {
    rendererOverride: 'Intel(R) UHD Graphics',
    search: '',
    storage: null,
  });
  const described = describeQualityDecision(decision);
  assert.equal(described.level, 'warn');
  assert.match(described.message, /MSAA 1x/);
  assert.match(described.message, /resolution 0\.7x/);
  assert.match(described.message, /Settings > Display > Graphics/);
});

test('a capable tier reports at info level without advice', () => {
  const decision = applyGpuQuality(makeViewer(), {
    rendererOverride: 'NVIDIA GeForce RTX 2050',
    search: '',
    storage: null,
  });
  const described = describeQualityDecision(decision);
  assert.equal(described.level, 'info');
  assert.match(described.message, /full quality/);
});
