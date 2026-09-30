// OWNER: render agent. Quality presets selected with ?q=low|med|high (default high).
const PRESETS = {
  low: {
    name: 'low',
    cascades: 2, shadowMapSize: 1024, shadowFar: 500, splits: [0.1, 30, 500], shadowTaps: 5,
    ao: false, aoHalfRes: true, aoQuality: 'Performance',
    cloudSteps: 10, cloudLightSteps: 2, envSize: 64,
    taa: true, bloomLevels: 5, dofTaps: 16, mbSamples: 6, sharpen: 0.25,
    charShadow: 0, ssr: false, shafts: false, shaftSteps: 0,
    ssgi: false, wet: false, // (lighting2 r1)
  },
  med: {
    name: 'med',
    cascades: 3, shadowMapSize: 2048, shadowFar: 900, splits: [0.1, 18, 90, 900], shadowTaps: 8,
    ao: true, aoHalfRes: true, aoQuality: 'Low',
    cloudSteps: 16, cloudLightSteps: 3, envSize: 128,
    taa: true, bloomLevels: 6, dofTaps: 22, mbSamples: 8, sharpen: 0.3,
    charShadow: 1024, ssr: true, ssrSteps: 20, shafts: true, shaftSteps: 12,
    ssgi: true, ssgiDirs: 4, ssgiSteps: 4, wet: true, // (lighting2 r1)
  },
  high: {
    name: 'high',
    // (foundation agent: a 5th, half-res cascade reaches 3 km so aerial views keep building / street-canyon shadows)
    cascades: 5, shadowMapSize: 2048, shadowFar: 3000, splits: [0.1, 14, 50, 200, 800, 3000], shadowTaps: 10,
    ao: true, aoHalfRes: false, aoQuality: 'Medium',
    cloudSteps: 22, cloudLightSteps: 3, envSize: 128,
    taa: true, bloomLevels: 6, dofTaps: 43, mbSamples: 10, sharpen: 0.35,
    charShadow: 2048, ssr: true, ssrSteps: 28, shafts: true, shaftSteps: 16,
    ssgi: true, ssgiDirs: 6, ssgiSteps: 4, wet: true, // (lighting2 r1) SSGI + wet-patch roughness
  },
};

// (GalStrike) GPU tier from the renderer string: dedicated GPUs high, mid-range / APUs med, integrated + mobile low
export function gpuTierFromName(name) {
  name = String(name || '').toLowerCase();
  if (/nvidia|geforce|quadro|radeon rx|radeon pro|arc\(tm\) a|intel\(r\) arc a/.test(name)) return 'high';
  // iPad / iPhone: Safari reports a generic "Apple GPU" (so does Safari on a Mac, told apart by having no touch points)
  if (/ipad|iphone/.test(name) || (/apple gpu/.test(name) && navigator.maxTouchPoints > 1)) return 'low';
  if (/apple m\d|radeon|iris xe|arc\(tm\) graphics/.test(name)) return 'med';
  if (/intel|uhd|hd graphics|iris|mali|adreno|powervr|swiftshader|llvmpipe|basic render/.test(name)) return 'low';
  return 'high';
}
export function gpuName(gl) {
  try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch (e) { return ''; }
}
// preset for a load without ?q: the player's manual choice if any, otherwise probe the GPU with a throwaway context
function bootPreset() {
  try {
    const s = JSON.parse(localStorage.getItem('spiderbench.save.v1') || 'null')?.settings;
    if (s?.qualityManual && PRESETS[s.quality]) return s.quality;
  } catch (e) { /* no storage */ }
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance' });
    if (!gl) return 'low';
    const t = gpuTierFromName(gpuName(gl)); gl.getExtension('WEBGL_lose_context')?.loseContext(); return t;
  } catch (e) { return 'high'; }
}

let _q = null;
export function getQuality() {
  if (_q) return _q;
  let name = 'high';
  try {
    const p = new URLSearchParams(location.search).get('q');
    if (p && PRESETS[p]) name = p;
    else if (p === 'medium') name = 'med';
    else name = bootPreset(); // (GalStrike) no ?q: saved manual choice, else the GPU tier (no second load on weak GPUs)
  } catch (e) { /* non-browser */ }
  _q = { ...PRESETS[name] };
  // (perf) ?perfoff disables the perf agent's culling / batching changes (A/B measurements with tools/perf_probe.mjs)
  try { _q.perf = !new URLSearchParams(location.search).has('perfoff'); } catch (e) { _q.perf = true; }
  // (perf r2) ?qset=ao:0,ssr:0,shadowMapSize:1024 overrides single preset fields (GPU ablation with tools/perf_probe.mjs)
  try {
    const qs = new URLSearchParams(location.search).get('qset');
    if (qs) for (const kv of qs.split(',')) { const [k, v] = kv.split(':'); if (k in _q) _q[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; }
  } catch (e) { /* non-browser */ }
  return _q;
}
