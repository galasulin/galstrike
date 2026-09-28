// OWNER: render agent.
// createPipeline({renderer, scene, camera, lighting}) -> pipeline
//   pipeline.render(dt)                 render one frame to the screen
//   pipeline.setSize(w, h)              CSS pixels (pixel ratio applied internally)
//   pipeline.setFocus(dist)             depth-of-field focus distance in metres
//   pipeline.setAperture(px)            DoF blur radius (full-res px) of objects at infinity; 0 disables DoF
//   pipeline.setDof({focus, aperture, maxBlur})
//   pipeline.setAutoFocus(object3D|null) focus follows an object (e.g. the player) every frame
//   pipeline.setMotionBlur(strength, {cameraVelocity?: Vector3 m/s, angularVelocity?: Vector3 rad/s, maskDistance?})
//        strength 0..1 (0.5 ~ 180deg shutter). Real camera motion is used automatically; for static screenshot
//        cameras pass a synthetic cameraVelocity / angularVelocity. Pixels closer than maskDistance (defaults to
//        focus distance + 1.5 m) are kept sharp so the chase-cam character doesn't smear.
//   pipeline.grade                      live-editable grading params (exposure, saturation, lift/gamma/gain ...)
//   pipeline.resetHistory()             call on camera cuts (also auto-detected)
//   pipeline.timings()                  GPU ms per pass when ?prof=1
// Frame: scene(HDR, jittered) -> sky(1/2 res) -> AO(N8AO) -> composite(sky+aerial perspective) -> TAA ->
//        DoF -> motion blur -> bloom -> final(CA, sharpen, ACES, grade, vignette, dither) -> screen
import * as THREE from 'three';
import { N8AOPostPass } from 'n8ao';
import { FSPass, makeRT, GLSL_DEPTH, GLSL_COLOR, halton } from './common.js';
import { GLSL_SKY_COMMON } from './sky.js';
import { GpuProfiler } from './profiler.js';
import { createGlassMirror } from './glassmirror.js'; // (render r-refl) player / cars / peds mirrored in facade glass

export function createPipeline({ renderer, scene, camera, lighting }) {
  const Q = lighting.quality;
  const reversed = !!renderer.capabilities.reversedDepthBuffer;
  const params = new URLSearchParams(location.search);
  const prof = new GpuProfiler(renderer, params.has('prof'));
  // (perf) with ?prof=1, split 'scene+shadows' into 'shadows' (all CSM cascades) and 'scene' (main colour pass),
  // and count draw calls / triangles of the shadow passes separately (pipeline.stats.shadowCalls / shadowTris)
  const shadowStat = { calls: 0, triangles: 0, cCalls: 0, cTris: 0 };
  if (prof.enabled) {
    const sm = renderer.shadowMap, smRender = sm.render;
    sm.render = function (...a) {
      const c0 = renderer.info.render.calls, t0 = renderer.info.render.triangles, u0 = performance.now();
      prof.begin('shadows'); smRender.apply(this, a); prof.begin('scene');
      shadowStat.cCalls += renderer.info.render.calls - c0; shadowStat.cTris += renderer.info.render.triangles - t0;
      shadowStat.cCpu = (shadowStat.cCpu || 0) + performance.now() - u0;
    };
  }

  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = true;

  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  let W = size.x, H = size.y;

  // ---------------------------------------------------------------- targets
  const depthTex = new THREE.DepthTexture(W, H, reversed ? THREE.FloatType : THREE.UnsignedIntType);
  depthTex.format = THREE.DepthFormat;
  depthTex.minFilter = depthTex.magFilter = THREE.NearestFilter;
  const sceneRT = makeRT(W, H, { depthBuffer: true, depthTexture: depthTex });
  sceneRT.texture.minFilter = sceneRT.texture.magFilter = THREE.LinearFilter;
  const aoRT = makeRT(W, H);
  const skyRT = makeRT(W / 2, H / 2);
  const litRT = makeRT(W, H);
  const hist = [makeRT(W, H), makeRT(W, H)];
  const postA = makeRT(W, H), postB = makeRT(W, H);
  const dofHalfA = makeRT(W / 2, H / 2), dofHalfB = makeRT(W / 2, H / 2);
  const ssrRT = makeRT(W / 2, H / 2);       // rgb: (reflection - env) * confidence (signed, half float)
  const shaftRT = makeRT(W / 2, H / 2);     // rgb: sun in-scatter along the view ray (shadowed), a: linear depth
  const sunVisRT = makeRT(1, 1, { filter: THREE.NearestFilter }); // r: sun visibility (lens flare)
  // auto exposure: r = adapted log2 luminance (ping-pong 1x1), g = this frame's metered value
  const aeRT = [makeRT(1, 1, { filter: THREE.NearestFilter, type: THREE.FloatType }), makeRT(1, 1, { filter: THREE.NearestFilter, type: THREE.FloatType })];
  let aeIdx = 0;
  // character mask: depth of the player's meshes only (same jittered camera as the scene). TAA compares it with
  // the scene depth to find character pixels and reprojects those with the character's own rigid motion instead
  // of the camera motion (chase-cam swinging otherwise smears / ghosts the suit).
  const maskDepth = new THREE.DepthTexture(W, H, reversed ? THREE.FloatType : THREE.UnsignedIntType);
  maskDepth.format = THREE.DepthFormat; maskDepth.minFilter = maskDepth.magFilter = THREE.NearestFilter;
  const maskRT = makeRT(W, H, { depthBuffer: true, depthTexture: maskDepth, type: THREE.UnsignedByteType, filter: THREE.NearestFilter });
  const maskMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  const objPrev = new THREE.Matrix4(), objCur = new THREE.Matrix4(), objDelta = new THREE.Matrix4();
  let objHave = false;
  const bloomDown = [], bloomUp = [];
  function allocBloom() {
    bloomDown.forEach(r => r.dispose()); bloomUp.forEach(r => r.dispose());
    bloomDown.length = 0; bloomUp.length = 0;
    let w = W, h = H;
    for (let i = 0; i < Q.bloomLevels; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      bloomDown.push(makeRT(w, h)); bloomUp.push(makeRT(w, h));
    }
  }
  allocBloom();

  // ---------------------------------------------------------------- AO
  let ao = null;
  if (Q.ao) {
    ao = new N8AOPostPass(scene, camera, W, H);
    ao.autoDetectTransparency = false;
    ao.configuration.transparencyAware = false;
    ao.configuration.gammaCorrection = false;
    ao.configuration.halfRes = Q.aoHalfRes;
    ao.setQualityMode(Q.aoQuality);
    if (!Q.aoHalfRes) {
      // full res with few samples + spatial denoise (TAA integrates the per-frame noise). Same cost as half-res
      // Medium, but no light halo along silhouettes (N8AO's half-res upsample bleeds across depth edges).
      ao.configuration.aoSamples = 4; ao.configuration.denoiseSamples = 4; ao.configuration.denoiseRadius = 5;
    }
    // moderate radius: large radii + half-res upsampling leave bright halos around thin foreground objects
    ao.configuration.aoRadius = 3.0; // (lighting2 r3) 2.2 -> 3.0: building bases / awnings / props get a wider contact darkening (user)
    ao.configuration.distanceFalloff = 0.9;
    ao.configuration.intensity = 3.4; // (lighting2 r3) user: contact shadows should read dark // was // (lighting2 r1) 3.2 -> 2.5: N8AO multiplies the lit colour, deep crevices went black
    ao.configuration.color = new THREE.Color(0x0e0b09); // neutral-warm occlusion (blue AO read as cold shadows)
    ao.setDepthTexture(depthTex);
    ao.renderToScreen = false;
  }

  const sky = lighting.sky;
  const csm = lighting.csm;

  // ---------------------------------------------------------------- SSR (half res, screen-space ray march)
  // Surfaces encode their reflection weight in the scene alpha (see surface.js). Rays are marched in screen space
  // against the depth buffer; hits fetch the previous frame's resolved HDR image (reprojected), so reflections
  // include sky, fog and the character. Output is the DELTA to the environment-map reflection the material already
  // added, so misses cost nothing and hits replace env by the real scene (glass towers reflecting their neighbours).
  const ssrOn = !!Q.ssr && !params.has('nossr');
  // (render r-refl) planar mirror of the dynamic objects (player, cars, peds) for the facade glass next to the player
  // (glassmirror.js): the facade opts out of SSR, so this is what puts Spider-Man into windows / curtain walls
  const gmirror = Q.ssr ? createGlassMirror(renderer, scene) : null;
  const ssr = new FSPass({
    name: 'ssr',
    defines: { STEPS: Q.ssrSteps || 24, ENVMAP_TYPE_CUBE_UV: '', CUBEUV_TEXEL_WIDTH: 0.0013, CUBEUV_TEXEL_HEIGHT: 0.001953125, CUBEUV_MAX_MIP: '7.0' },
    uniforms: {
      uDepth: { value: depthTex }, uScene: { value: sceneRT.texture }, uPrev: { value: null }, envMap: { value: null },
      uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uReversed: { value: reversed ? 1 : 0 },
      uCamWorld: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
      uRes: { value: new THREE.Vector2(W, H) }, uFrame: { value: 0 }, uEnvI: { value: 1 }, uHavePrev: { value: 0 },
      uMaxDist: { value: 220 },
    },
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor;
uniform sampler2D uDepth, uScene, uPrev; uniform mat4 uProj, uCamWorld, uPrevViewProj; uniform vec2 uRes;
uniform float uFrame, uEnvI, uHavePrev, uMaxDist;
${GLSL_DEPTH}
#define saturate(a) clamp(a, 0.0, 1.0)
uniform sampler2D envMap;
${THREE.ShaderChunk.cube_uv_reflection_fragment}
float linZ(vec2 uv) { float d = texture(uDepth, uv).r; return isSky(d) ? 1e7 : -viewPosFromDepth(uv, d).z; }
vec3 vpos(vec2 uv) { return viewPosFromDepth(uv, texture(uDepth, uv).r); }
void main() {
  // pick one full-res pixel of the 2x2 block (rotating per frame; TAA integrates the rest)
  vec2 px = 1.0 / uRes;
  int k = int(uFrame) & 3;
  vec2 fp = floor(vUv * uRes * 0.5) * 2.0 + vec2(float(k & 1), float(k >> 1)) + 0.5;
  vec2 uv = fp * px;
  float w = texture(uScene, uv).a - 1.0;
  float d0 = texture(uDepth, uv).r;
  if (w < 0.01 || isSky(d0)) { fragColor = vec4(0.0); return; }
  vec3 P = viewPosFromDepth(uv, d0);
  // normal from depth: pick the smaller-difference neighbours on each axis (robust at silhouettes)
  vec3 pr = vpos(uv + vec2(px.x, 0.0)), pl = vpos(uv - vec2(px.x, 0.0));
  vec3 pu = vpos(uv + vec2(0.0, px.y)), pd = vpos(uv - vec2(0.0, px.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  vec3 V = normalize(P);
  if (dot(N, V) > 0.0) N = -N;
  vec3 R = reflect(V, N);
  vec3 Rw = normalize((uCamWorld * vec4(R, 0.0)).xyz);
  vec3 env = textureCubeUV(envMap, Rw, 0.04).rgb * uEnvI;
  // --- screen-space march (perspective-correct via 1/z interpolation)
  float len = uMaxDist;
  if (R.z > 0.0) len = min(len, (-P.z - 0.12) / R.z * 0.98); // don't cross the near plane
  vec3 E = P + R * len;
  vec4 h0 = uProj * vec4(P, 1.0), h1 = uProj * vec4(E, 1.0);
  float k0 = 1.0 / h0.w, k1 = 1.0 / h1.w;
  vec2 s0 = h0.xy * k0 * 0.5 + 0.5, s1 = h1.xy * k1 * 0.5 + 0.5;
  // clip the screen segment to the viewport
  vec2 dS = s1 - s0; float tMax = 1.0;
  if (s1.x > 1.0) tMax = min(tMax, (1.0 - s0.x) / dS.x); if (s1.x < 0.0) tMax = min(tMax, -s0.x / dS.x);
  if (s1.y > 1.0) tMax = min(tMax, (1.0 - s0.y) / dS.y); if (s1.y < 0.0) tMax = min(tMax, -s0.y / dS.y);
  float jit = ign(gl_FragCoord.xy + uFrame * 5.588);
  float hitT = -1.0; float tPrev = 0.0;
  // nonlinear step distribution (denser near the start)
  for (int i = 1; i <= STEPS; i++) {
    float f = (float(i) - 0.5 + jit) / float(STEPS);
    float t = tMax * f * f;
    vec2 s = s0 + dS * t;
    float rz = 1.0 / mix(k0, k1, t);        // ray view depth (positive)
    float sz = linZ(s);
    float dz = rz - sz;
    float thick = max(0.35, rz * 0.035) + abs(rz - 1.0 / mix(k0, k1, tPrev));
    if (dz > 0.02 && dz < thick) { hitT = t; break; }
    tPrev = t;
  }
  if (hitT < 0.0 || uHavePrev < 0.5) { fragColor = vec4(0.0); return; }
  // binary refinement
  float a = tPrev, b = hitT;
  for (int i = 0; i < 5; i++) {
    float m = 0.5 * (a + b); vec2 s = s0 + dS * m;
    float rz = 1.0 / mix(k0, k1, m);
    if (rz > linZ(s)) b = m; else a = m;
  }
  vec2 hs = s0 + dS * b;
  vec3 hv = vpos(hs);
  // --- hit validation
  float rzH = 1.0 / mix(k0, k1, b);
  if (abs(rzH - (-hv.z)) > max(0.35, rzH * 0.03)) { fragColor = vec4(0.0); return; }         // thickness at refined hit
  if (abs(dot(hv - P, N)) < 0.25 + 0.01 * length(hv - P)) { fragColor = vec4(0.0); return; } // self-plane (grazing streaks)
  vec2 hp = 1.0 / uRes;
  vec3 hx = vpos(hs + vec2(hp.x, 0.0)) - hv, hy = vpos(hs + vec2(0.0, hp.y)) - hv;
  vec3 NH = normalize(cross(hx, hy)); if (dot(NH, hv) > 0.0) NH = -NH;
  float facing = clamp(-dot(NH, R) * 4.0, 0.0, 1.0);                                         // back-facing hits invalid
  vec3 hw = (uCamWorld * vec4(hv, 1.0)).xyz;
  vec4 pc = uPrevViewProj * vec4(hw, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (pc.w <= 0.0 || any(lessThan(puv, vec2(0.002))) || any(greaterThan(puv, vec2(0.998)))) { fragColor = vec4(0.0); return; }
  if (length((puv - hs) * uRes) > 0.08 * uRes.x) { fragColor = vec4(0.0); return; }           // implausible reprojection
  vec3 hit = texture(uPrev, puv).rgb;
  // firefly / blow-out guard: never more than a few times brighter than the env reflection it replaces
  float le = dot(env, vec3(0.2126, 0.7152, 0.0722)), lh = dot(hit, vec3(0.2126, 0.7152, 0.0722));
  hit *= min(1.0, (le * 3.0 + 0.5) / max(lh, 1e-4));
  // confidence: screen edges, rays toward the camera, grazing incidence (depth normals unreliable), distance
  vec2 e = smoothstep(0.0, 0.1, hs) * smoothstep(1.0, 0.9, hs);
  float graze = smoothstep(0.02, 0.12, -dot(V, N));
  float conf = e.x * e.y * smoothstep(0.7, 0.2, R.z) * facing * graze * (1.0 - smoothstep(0.6, 1.0, b / max(tMax, 1e-4)) * step(0.999, tMax));
  fragColor = vec4((hit - env) * conf, conf);
}`,
  });

  // ---------------------------------------------------------------- volumetric sun shafts (half res)
  const NC = csm.N;
  const shaftsOn = !!Q.shafts && !params.has('noshafts');
  const shafts = new FSPass({
    name: 'shafts',
    defines: { STEPS: Q.shaftSteps || 12, NC },
    uniforms: {
      ...sky.skyUniforms,
      uDepth: { value: depthTex }, uProjInv: { value: new THREE.Matrix4() }, uReversed: { value: reversed ? 1 : 0 },
      uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uCamFwd: { value: new THREE.Vector3() },
      uSM0: { value: null }, uSM1: { value: null }, uSM2: { value: null }, uSM3: { value: null },
      uSMat: { value: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()] },
      uSplits: { value: new THREE.Vector4(1e9, 1e9, 1e9, 1e9) },
      uRes: { value: new THREE.Vector2(W, H) }, uFrame: { value: 0 },
      uDensity: { value: 0.0008 }, uHeightFall: { value: 1 / 70 }, uMaxT: { value: 180 }, uStrength: { value: 1 },
    },
    fragmentShader: /* glsl */`
precision highp float; precision highp sampler2DShadow; in vec2 vUv; out vec4 fragColor;
uniform sampler2D uDepth; uniform mat4 uCamWorld; uniform vec3 uCamPos, uCamFwd; uniform vec2 uRes; uniform float uFrame;
uniform sampler2DShadow uSM0, uSM1, uSM2, uSM3; uniform mat4 uSMat[4]; uniform vec4 uSplits;
uniform float uDensity, uHeightFall, uMaxT, uStrength;
${GLSL_DEPTH}
${GLSL_SKY_COMMON}
float vis(vec3 p, float vz) {
  vec4 sc;
  if (vz < uSplits.x) { sc = uSMat[0] * vec4(p, 1.0); return texture(uSM0, sc.xyz); }
#if NC > 1
  if (vz < uSplits.y) { sc = uSMat[1] * vec4(p, 1.0); return texture(uSM1, sc.xyz); }
#endif
#if NC > 2
  if (vz < uSplits.z) { sc = uSMat[2] * vec4(p, 1.0); return texture(uSM2, sc.xyz); }
#endif
#if NC > 3
  sc = uSMat[3] * vec4(p, 1.0);
  if (all(greaterThan(sc.xyz, vec3(0.0))) && all(lessThan(sc.xyz, vec3(1.0)))) return texture(uSM3, sc.xyz);
#endif
  return 1.0;
}
void main() {
  // nearest-depth of the 2x2 footprint keeps foreground silhouettes clean for the bilateral upsample
  vec2 px = 1.0 / uRes;
  float d = texture(uDepth, vUv).r;
  vec3 vd = viewDirFromUv(vUv);
  vec3 dir = normalize((uCamWorld * vec4(vd, 0.0)).xyz);
  float dist = isSky(d) ? 1e5 : length(viewPosFromDepth(vUv, d));
  float tEnd = min(dist, uMaxT);
  float cosF = max(dot(dir, uCamFwd), 1e-3);
  float jit = ign(gl_FragCoord.xy + uFrame * 7.137);
  float mu = dot(dir, uSunDir);
  float ph = phaseHG(mu, 0.62) * 0.8 + phaseHG(mu, -0.2) * 0.2;
  float acc = 0.0; float od = 0.0;
  float dt = tEnd / float(STEPS);
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + jit) * dt;
    vec3 p = uCamPos + dir * t;
    float sig = uDensity * exp(-max(p.y, 0.0) * uHeightFall);
    float v = vis(p, t * cosF);
    acc += v * sig * exp(-od) * dt;
    od += sig * dt;
  }
  vec3 L = uSunColor * ph * acc * uStrength;
  fragColor = vec4(L, isSky(d) ? 1e5 : dist);
}`,
  });

  // ---------------------------------------------------------------- SSGI (lighting2 r1: half-res screen-space one-bounce GI)
  // For one full-res pixel of each 2x2 block (rotating per frame, TAA integrates the rest): reconstruct the position and
  // depth normal, trace a few cosine-distributed rays in view space against the depth buffer, and on a hit gather the
  // PREVIOUS frame's lit radiance at that point (reprojected, from the quarter-res bloom chain = pre-filtered, cheap,
  // firefly-free). Without an albedo buffer the bounce is applied as a RATIO: out = E_gi / (E_sun * vis + E_amb), where
  // E_sun uses the real CSM visibility + N.L and E_amb the env irradiance, so composite does col *= 1 + ratio. Shaded
  // walls opposite a sunlit facade / street get the warm coloured bounce; sunlit pixels barely change.
  const ssgiOn = Q.ssgi !== false && !params.has('nossgi');
  const ssgiRT = makeRT(W / 2, H / 2);
  const ssgi = new FSPass({
    name: 'ssgi',
    defines: { DIRS: Q.ssgiDirs || 6, STEPS: Q.ssgiSteps || 4, NC, ENVMAP_TYPE_CUBE_UV: '', CUBEUV_TEXEL_WIDTH: 0.0013, CUBEUV_TEXEL_HEIGHT: 0.001953125, CUBEUV_MAX_MIP: '7.0' },
    uniforms: {
      ...sky.skyUniforms,
      uDepth: { value: depthTex }, uPrevRad: { value: null }, envMap: { value: null }, uEnvI: { value: 1 }, uAmbBounce: { value: new THREE.Vector3() },
      uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uReversed: { value: reversed ? 1 : 0 },
      uCamWorld: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
      uSM0: { value: null }, uSM1: { value: null }, uSM2: { value: null }, uSM3: { value: null },
      uSMat: { value: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()] },
      uSplits: { value: new THREE.Vector4(1e9, 1e9, 1e9, 1e9) },
      uRes: { value: new THREE.Vector2(W, H) }, uFrame: { value: 0 }, uHavePrev: { value: 0 }, uStrength: { value: 1 },
    },
    fragmentShader: /* glsl */`
precision highp float; precision highp sampler2DShadow; in vec2 vUv; out vec4 fragColor;
uniform sampler2D uDepth, uPrevRad; uniform mat4 uProj, uCamWorld, uPrevViewProj; uniform vec2 uRes;
uniform float uFrame, uEnvI, uHavePrev, uStrength; uniform vec3 uAmbBounce;
uniform sampler2DShadow uSM0, uSM1, uSM2, uSM3; uniform mat4 uSMat[4]; uniform vec4 uSplits;
${GLSL_DEPTH}
${GLSL_SKY_COMMON}
#define saturate(a) clamp(a, 0.0, 1.0)
uniform sampler2D envMap;
${THREE.ShaderChunk.cube_uv_reflection_fragment}
float linZ(vec2 uv) { float d = texture(uDepth, uv).r; return isSky(d) ? 1e7 : -viewPosFromDepth(uv, d).z; }
vec3 vpos(vec2 uv) { return viewPosFromDepth(uv, texture(uDepth, uv).r); }
float sunVis(vec3 p, float vz) {
  vec4 sc;
  if (vz < uSplits.x) { sc = uSMat[0] * vec4(p, 1.0); return texture(uSM0, sc.xyz); }
#if NC > 1
  if (vz < uSplits.y) { sc = uSMat[1] * vec4(p, 1.0); return texture(uSM1, sc.xyz); }
#endif
#if NC > 2
  if (vz < uSplits.z) { sc = uSMat[2] * vec4(p, 1.0); return texture(uSM2, sc.xyz); }
#endif
#if NC > 3
  sc = uSMat[3] * vec4(p, 1.0);
  if (all(greaterThan(sc.xyz, vec3(0.0))) && all(lessThan(sc.xyz, vec3(1.0)))) return texture(uSM3, sc.xyz);
#endif
  return 1.0;
}
void main() {
  vec2 px = 1.0 / uRes;
  int k = int(uFrame) & 3;
  vec2 fp = floor(vUv * uRes * 0.5) * 2.0 + vec2(float(k & 1), float(k >> 1)) + 0.5;
  vec2 uv = fp * px;
  float d0 = texture(uDepth, uv).r;
  if (isSky(d0) || uHavePrev < 0.5) { fragColor = vec4(0.0, 0.0, 0.0, 1e5); return; }
  vec3 P = viewPosFromDepth(uv, d0);
  float dist = length(P);
  if (dist > 1500.0) { fragColor = vec4(0.0, 0.0, 0.0, dist); return; }
  vec3 pr = vpos(uv + vec2(px.x, 0.0)), pl = vpos(uv - vec2(px.x, 0.0));
  vec3 pu = vpos(uv + vec2(0.0, px.y)), pd = vpos(uv - vec2(0.0, px.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, P) > 0.0) N = -N;
  // tangent frame
  vec3 T = normalize(abs(N.y) < 0.9 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0)));
  vec3 B = cross(N, T);
  float jit = ign(gl_FragCoord.xy + uFrame * 5.588);
  float jit2 = ign(gl_FragCoord.yx * 1.37 + uFrame * 3.17);
  float R = clamp(dist * 0.06, 4.0, 40.0); // gather radius (m): local bounce near, block-scale bounce far
  vec3 acc = vec3(0.0);
  for (int i = 0; i < DIRS; i++) {
    // cosine-weighted hemisphere (stratified spiral, rotated per pixel / frame)
    float u1 = (float(i) + jit) / float(DIRS);
    float phi = 6.2831853 * (float(i) * 0.618034 + jit2);
    float r = sqrt(u1);
    vec3 dir = T * (r * cos(phi)) + B * (r * sin(phi)) + N * sqrt(max(1.0 - u1, 0.0));
    for (int s = 1; s <= STEPS; s++) {
      float f = (float(s) - 0.5 * jit) / float(STEPS);
      float t = max(R * f * f, 0.25);
      vec3 S = P + N * 0.08 + dir * t;
      if (S.z > -0.1) break;
      vec4 h = uProj * vec4(S, 1.0);
      vec2 su = h.xy / h.w * 0.5 + 0.5;
      if (any(lessThan(su, vec2(0.0))) || any(greaterThan(su, vec2(1.0)))) break;
      float sz = linZ(su);
      float dz = -S.z - sz;
      if (dz > 0.05 && dz < max(1.5, t * 0.8)) {
        vec3 hv = vpos(su);
        vec3 hw = (uCamWorld * vec4(hv, 1.0)).xyz;
        vec4 pc = uPrevViewProj * vec4(hw, 1.0);
        vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
        if (pc.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)))) {
          vec3 L = texture(uPrevRad, puv).rgb;
          L *= min(1.0, 8.0 / max(dot(L, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
          acc += L;
        }
        break;
      }
    }
  }
  vec3 Egi = 3.14159265 * acc / float(DIRS);
  // irradiance this pixel already receives: sun (real shadow maps) + sky fill + the analytic bounce approximation
  vec3 Pw = (uCamWorld * vec4(P, 1.0)).xyz;
  vec3 Nw = normalize((uCamWorld * vec4(N, 0.0)).xyz);
  float ndl = max(dot(Nw, uSunDir), 0.0);
  float vis = ndl > 0.0 ? sunVis(Pw + Nw * 0.25 + uSunDir * 0.1, -P.z) : 0.0;
  vec3 Eamb = 3.14159265 * textureCubeUV(envMap, Nw, 1.0).rgb * uEnvI + uAmbBounce;
  float Ed = dot(uSunColor * ndl * vis + Eamb, vec3(0.2126, 0.7152, 0.0722));
  vec3 ratio = Egi * uStrength / max(Ed, 1e-3);
  ratio = min(ratio, vec3(1.6));
  fragColor = vec4(ratio, dist);
}`,
  });

  // ---------------------------------------------------------------- sun visibility (1x1) for lens effects
  const sunVis = new FSPass({
    name: 'sunVis',
    uniforms: { uDepth: { value: depthTex }, uSky: { value: skyRT.texture }, uSunUv: { value: new THREE.Vector2() }, uReversed: { value: reversed ? 1 : 0 },
      uProjInv: { value: new THREE.Matrix4() }, uAspect: { value: 1 } },
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor;
uniform sampler2D uDepth, uSky; uniform vec2 uSunUv; uniform float uAspect;
${GLSL_DEPTH}
void main() {
  float v = 0.0; float n = 0.0;
  for (int y = -4; y <= 4; y++) for (int x = -4; x <= 4; x++) {
    vec2 uv = uSunUv + vec2(float(x) / uAspect, float(y)) * 0.0022;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float s = isSky(texture(uDepth, uv).r) ? texture(uSky, uv).a : 0.0;
    v += s * inside; n += 1.0;
  }
  fragColor = vec4(v / n, 0.0, 0.0, 1.0);
}`,
  });

  // ---------------------------------------------------------------- composite (sky + aerial perspective)
  const composite = new FSPass({
    name: 'composite',
    uniforms: {
      ...sky.skyUniforms,
      uColor: { value: null }, uDepth: { value: depthTex }, uSky: { value: skyRT.texture },
      uProjInv: { value: new THREE.Matrix4() }, uReversed: { value: reversed ? 1 : 0 },
      uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uFogDensity: { value: 0 }, uFogFalloff: { value: 0 }, uFogSun: { value: 0 }, uFogTint: { value: new THREE.Color() },
      uFogStart: { value: 0 }, uPx: { value: new THREE.Vector2() },
      uSceneA: { value: sceneRT.texture }, uSSR: { value: ssrRT.texture }, uSSROn: { value: 0 },
      uShafts: { value: shaftRT.texture }, uShaftOn: { value: 0 }, uHalfPx: { value: new THREE.Vector2() },
      uCloudShadow: { value: 0.4 }, // (foundation agent) strength of the projected cloud shadows (0 = off)
      uGI: { value: ssgiRT.texture }, uGIOn: { value: 0 }, // (lighting2 r1) SSGI bounce ratio (half res, a = distance)
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonK: { value: 0 }, // (daynight) moon disc
    },
    fragmentShader: /* glsl */`
precision highp float;
precision highp sampler3D;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uColor, uDepth, uSky, uSceneA, uSSR, uShafts;
uniform sampler2D uGI; uniform float uGIOn; // (lighting2 r1) SSGI
uniform vec3 uMoonDir; uniform float uMoonK; // (daynight)
// (foundation agent) projected cloud shadows: the sky's cumulus coverage field sampled where the sun ray from a surface
// point crosses the cloud layer (same noise / coverage as sky.js cloudDensity, lower cloud band)
uniform sampler3D uNoise; uniform float uCloudCoverage, uCloudBottom, uCloudTop, uCloudShadow, uCloudScale; uniform vec3 uCloudOffset;
uniform mat4 uCamWorld; uniform vec3 uCamPos; uniform vec2 uPx, uHalfPx;
uniform float uFogDensity, uFogFalloff, uFogSun, uFogStart, uSSROn, uShaftOn; uniform vec3 uFogTint;
${GLSL_DEPTH}
${GLSL_SKY_COMMON}
vec3 fogColor(vec3 dir, float sunVis) {
  // (atmosphere r2) looking down from altitude the haze in-scatter picks up more of the blue sky above (not the pale
  // horizon), and it warms toward the sun (forward Mie)
  vec3 c = skyLUT(normalize(vec3(dir.x, max(dir.y * 0.3, 0.012) + 0.05 * clamp(-dir.y * 2.0, 0.0, 1.0), dir.z))) * uFogTint;
  float mu = dot(dir, uSunDir);
  c *= mix(vec3(1.0), vec3(1.1, 1.0, 0.86), smoothstep(0.2, 0.95, mu) * 0.6);
  c += uSunColor * phaseHG(mu, 0.7) * uFogSun * 0.05 * sunVis;
  return c;
}
float cloudShadowAt(vec3 wp) {
  if (uSunDir.y < 0.06 || uCloudShadow <= 0.0) return 0.0;
  vec3 p = wp * 0.001;
  float sh = 0.0;
  for (int k = 0; k < 2; k++) {
    float hf = k == 0 ? 0.08 : 0.22;
    float h = mix(uCloudBottom, uCloudTop, hf);
    float t = (h - p.y) / uSunDir.y;
    vec3 q = vec3(p.x + uSunDir.x * t, RG + h, p.z + uSunDir.z * t) + uCloudOffset;
    float wx = texture(uNoise, vec3(q.xz * 0.018, 0.31)).r;
    float wy = texture(uNoise, vec3(q.xz * 0.05 + 0.5, 0.71)).r;
    float cov = clamp(uCloudCoverage * (0.55 + 0.8 * smoothstep(0.1, 0.8, wx)) * (0.8 + 0.4 * wy), 0.0, 1.0);
    if (cov < 0.02) continue;
    vec4 nb = texture(uNoise, q * vec3(uCloudScale, 0.2, uCloudScale)); // (atmosphere r1) same shape as sky.js cloudDensity
    float base = clamp((nb.r + (1.0 - (nb.g * 0.625 + nb.b * 0.25 + nb.a * 0.125)) * 0.6) / (1.0 + (1.0 - (nb.g * 0.625 + nb.b * 0.25 + nb.a * 0.125)) * 0.6), 0.0, 1.0);
    float top = mix(0.35, 1.0, cov);
    float grad = smoothstep(0.0, 0.07, hf) * (1.0 - smoothstep(top * 0.4, top, hf));
    float d = (base * grad - (1.0 - cov)) / max(cov, 1e-3);
    sh = max(sh, smoothstep(0.0, 0.3, d));
  }
  return sh * uCloudShadow * smoothstep(0.06, 0.2, uSunDir.y);
}
// depth-aware upsample of a half-res buffer whose alpha holds linear distance
vec3 upsampleShafts(vec2 uv, float dist) {
  vec2 hp = uHalfPx; vec2 base = (floor(uv / hp - 0.5) + 0.5) * hp; vec2 f = (uv - base) / hp;
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 o = vec2(float(i), float(j));
    vec4 s = texture(uShafts, base + o * hp);
    float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float dw = 1.0 / (1e-3 + abs(s.a - dist) / max(dist, 1.0) * 20.0);
    float w = bw * dw + 1e-5;
    acc += s.rgb * w; ws += w;
  }
  return acc / ws;
}
// (lighting2 r1) depth-aware 3x3 blur-upsample of the half-res SSGI ratio (a = distance)
vec3 upsampleGI(vec2 uv, float dist) {
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 s = texture(uGI, uv + vec2(float(i), float(j)) * uHalfPx * 1.5);
    float w = exp(-abs(s.a - dist) / max(dist, 1.0) * 30.0) * (i == 0 && j == 0 ? 2.0 : 1.0) + 1e-5;
    acc += s.rgb * w; ws += w;
  }
  return acc / ws;
}
void main() {
  float d = texture(uDepth, vUv).r;
  vec3 vd = viewDirFromUv(vUv);
  vec3 dir = normalize((uCamWorld * vec4(vd, 0.0)).xyz);
  if (isSky(d)) {
    vec4 s = texture(uSky, vUv);
    vec3 c = s.rgb;
    // sun disk with limb darkening, occluded by clouds (s.a = cloud transmittance)
    float ct = dot(dir, uSunDir);
    float ang = acos(clamp(ct, -1.0, 1.0));
    float R = 0.0052;
    if (ang < R * 1.5) {
      float x = clamp(ang / R, 0.0, 1.0);
      float limb = 1.0 - 0.6 * (1.0 - sqrt(max(1.0 - x * x, 0.0)));
      float disk = 1.0 - smoothstep(0.85, 1.0, ang / R);
      c += uSunColor * 90.0 * limb * disk * s.a;
    }
    if (uMoonK > 0.0) { // (daynight) moon disc: mottled maria, soft halo (bloom picks it up at night exposure)
      float ma = acos(clamp(dot(dir, uMoonDir), -1.0, 1.0));
      float Rm = 0.0078;
      if (ma < Rm * 12.0) {
        vec3 mt = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + 1e-5); vec3 mb = cross(mt, uMoonDir);
        vec2 mq = vec2(dot(dir - uMoonDir, mt), dot(dir - uMoonDir, mb)) / Rm;
        float maria = 0.72 + 0.28 * smoothstep(0.1, 0.5, length(mq - vec2(0.3, 0.25))) * smoothstep(0.05, 0.35, length(mq + vec2(0.35, -0.1)));
        float mdisk = 1.0 - smoothstep(0.88, 1.0, ma / Rm);
        c += (vec3(0.9, 0.92, 1.0) * 1.8 * maria * mdisk + vec3(0.45, 0.55, 0.8) * 0.05 * exp(-ma / Rm * 0.9)) * uMoonK * s.a;
      }
    }
    if (uShaftOn > 0.5) c += upsampleShafts(vUv, 1e5);
    fragColor = vec4(c, 1.0);
    return;
  }
  vec3 col = texture(uColor, vUv).rgb;
  if (uGIOn > 0.5) {
    float gd = length(viewPosFromDepth(vUv, d));
    col *= 1.0 + upsampleGI(vUv, gd);
  }
  if (uSSROn > 0.5) {
    float w = texture(uSceneA, vUv).a - 1.0;
    if (w > 0.01) {
      vec3 r = vec3(0.0);
      r += texture(uSSR, vUv + uHalfPx * vec2(-0.5, -0.5)).rgb; r += texture(uSSR, vUv + uHalfPx * vec2(0.5, -0.5)).rgb;
      r += texture(uSSR, vUv + uHalfPx * vec2(-0.5, 0.5)).rgb;  r += texture(uSSR, vUv + uHalfPx * vec2(0.5, 0.5)).rgb;
      col = max(col + w * r * 0.25, vec3(0.0));
      // reflection floor: glossy glass never collapses to black when it reflects a shadowed street / SSR miss.
      // Stylised like the refs: at least ~60% of the (horizon-ish) sky radiance times the Fresnel weight.
      vec3 skyH = skyLUT(normalize(vec3(dir.x, 0.12, dir.z)));
      col = max(col, w * skyH * 0.35);
    }
  }
  vec3 pv = viewPosFromDepth(vUv, d);
  float dist = length(pv);
  // (foundation agent) cloud shadows darken the lit scene before the aerial perspective (so haze stays bright)
  if (dist < 20000.0) col *= 1.0 - cloudShadowAt(uCamPos + dir * dist) * (1.0 - smoothstep(9000.0, 20000.0, dist));
  float dd = max(dist - uFogStart, 0.0);
  float h0 = uCamPos.y;
  float k = uFogFalloff;
  float ry = dir.y;
  float od;
  float a = uFogDensity * exp(-k * max(h0, 0.0));
  if (abs(ry * k * dd) < 1e-3) od = a * dd;
  else od = a * (1.0 - exp(-k * ry * dd)) / (k * ry);
  // (atmosphere r2) tighter distance curve: the near / mid range (< ~400 m) keeps its saturation and contrast, the
  // 1-4 km band hazes faster (mid-distance tower clusters get aerial perspective), and the optical depth saturates
  // softly so far silhouettes never vanish into a uniform white wall (critic: 'milky at 500 m', 'flat white band')
  od *= mix(0.45, 1.3, smoothstep(150.0, 2600.0, dist)); // (lighting2 r2) 0.3 -> 0.45: street-level haze down the avenues
  od = od / (1.0 + od * 0.22);
  vec3 T = exp(-od * vec3(0.86, 1.0, 1.16));
  // (foundation agent) the horizon skirt (water.js, ~140 km) is fully in-scattered even for level rays from altitude,
  // where the height-falloff optical depth stays small -> no dark line on the geometric horizon
  T *= 1.0 - smoothstep(25000.0, 60000.0, dist);
  vec3 fogC = fogColor(dir, uShaftOn > 0.5 ? 0.35 : 1.0);
  // (foundation agent) far-field in-scatter converges to the untinted horizon sky: the fogged hinterland meets the sky
  // without a darker seam at the horizon (the tint only deepens the near/mid-distance haze)
  // (round 4) converge later: the near / mid distance keeps the blue-grey tinted in-scatter (graded aerial perspective
  // instead of a milky-white wall), only the far hinterland / horizon skirt melts into the horizon sky
  fogC = mix(fogC, skyLUT(normalize(vec3(dir.x, 0.012, dir.z))), smoothstep(9000.0, 45000.0, dist));
  col = col * T + fogC * (1.0 - T);
  if (uShaftOn > 0.5) col += upsampleShafts(vUv, dist);
  fragColor = vec4(col, 1.0);
}`,
  });

  // ---------------------------------------------------------------- TAA
  const taa = new FSPass({
    name: 'taa',
    uniforms: {
      uCurrent: { value: litRT.texture }, uHistory: { value: null }, uDepth: { value: depthTex },
      uProjInv: { value: new THREE.Matrix4() }, uReversed: { value: reversed ? 1 : 0 },
      uCamWorld: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
      uRes: { value: new THREE.Vector2(W, H) }, uBlend: { value: 0.1 }, uReset: { value: 1 },
      uJitter: { value: new THREE.Vector2() }, uProjInvU: { value: new THREE.Matrix4() },
      uMask: { value: maskDepth }, uMaskOn: { value: 0 }, uObjDelta: { value: new THREE.Matrix4() },
    },
    fragmentShader: /* glsl */`
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uCurrent, uHistory, uDepth;
uniform mat4 uCamWorld, uPrevViewProj; uniform vec2 uRes, uJitter; uniform float uBlend, uReset;
uniform sampler2D uMask; uniform float uMaskOn; uniform mat4 uObjDelta; uniform mat4 uProjInvU;
${GLSL_DEPTH}
${GLSL_COLOR}
// view position with the UN-jittered projection (history lives in the unjittered frame)
vec3 viewPosU(vec2 uv, float d) { float z = uReversed > 0.5 ? d : d * 2.0 - 1.0; vec4 p = uProjInvU * vec4(uv * 2.0 - 1.0, z, 1.0); return p.xyz / p.w; }
vec3 toYC(vec3 c) { return vec3(0.25*c.r + 0.5*c.g + 0.25*c.b, 0.5*c.r - 0.5*c.b, -0.25*c.r + 0.5*c.g - 0.25*c.b); }
vec3 fromYC(vec3 y) { return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
vec3 tm(vec3 c) { return c / (1.0 + luma(c)); }
vec3 itm(vec3 c) { return c / max(1.0 - luma(c), 1e-4); }
vec3 sampleCR(sampler2D t, vec2 uv) {
  vec2 sp = uv * uRes; vec2 tc = floor(sp - 0.5) + 0.5; vec2 f = sp - tc;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)); vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)); vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2; vec2 tc0 = (tc - 1.0) / uRes; vec2 tc3 = (tc + 2.0) / uRes; vec2 tc12 = (tc + w2 / w12) / uRes;
  vec3 r = texture(t, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y)
         + texture(t, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y)
         + texture(t, vec2(tc12.x, tc12.y)).rgb * (w12.x * w12.y)
         + texture(t, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y)
         + texture(t, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
  float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / ws, 0.0);
}
void main() {
  vec2 px = 1.0 / uRes;
  // un-jitter the current frame: content that belongs at vUv was rendered at vUv + uJitter (uv units)
  vec3 cur = sampleCR(uCurrent, vUv + uJitter);
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  float closest = uReversed > 0.5 ? 0.0 : 1.0; vec2 cuv = vUv;
  vec3 cmin = vec3(1e9), cmax = vec3(-1e9);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(x, y) * px;
    vec3 c = toYC(tm(texture(uCurrent, vUv + o).rgb));
    m1 += c; m2 += c * c; cmin = min(cmin, c); cmax = max(cmax, c);
    float d = texture(uDepth, vUv + o).r;
    bool nearer = uReversed > 0.5 ? d > closest : d < closest;
    if (nearer) { closest = d; cuv = vUv + o; }
  }
  vec3 world;
  if (isSky(closest)) world = (uCamWorld * vec4(viewDirFromUv(vUv) * 1e5, 1.0)).xyz;
  else world = (uCamWorld * vec4(viewPosU(vUv, closest), 1.0)).xyz;
  // character pixel? (mask depth == scene depth) -> reproject with the character's rigid motion
  bool isChar = false;
  if (uMaskOn > 0.5) {
    float md = texture(uMask, cuv).r;
    if (!isSky(md)) {
      float zs = -viewPosFromDepth(cuv, closest).z, zm = -viewPosFromDepth(cuv, md).z;
      isChar = abs(zs - zm) < 0.03 + 0.004 * zs;
    }
  }
  if (isChar) world = (uObjDelta * vec4(world, 1.0)).xyz;
  vec4 pc = uPrevViewProj * vec4(world, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (uReset > 0.5 || any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0))) || pc.w <= 0.0) {
    fragColor = vec4(cur, 1.0); return;
  }
  vec3 hist = toYC(tm(sampleCR(uHistory, puv)));
  vec3 mu = m1 / 9.0; vec3 sig = sqrt(max(m2 / 9.0 - mu * mu, 0.0));
  float vel = length((puv - vUv) * uRes);
  // static / slow: wide box (no edge flicker from the neighbourhood itself moving with the jitter); fast: tight
  float g = vel < 0.5 ? 1.9 : mix(1.4, 0.9, clamp((vel - 0.5) / 8.0, 0.0, 1.0));
  if (isChar) g = min(g, 1.0);
  vec3 bmin = max(cmin, mu - g * sig), bmax = min(cmax, mu + g * sig);
  // clip toward the mean
  vec3 pc0 = 0.5 * (bmax + bmin), e = 0.5 * (bmax - bmin) + 1e-5;
  vec3 v = hist - pc0; vec3 a = abs(v / e); float ma = max(a.x, max(a.y, a.z));
  if (ma > 1.0) hist = pc0 + v / ma;
  vec3 curT = toYC(tm(cur));
  float blend = mix(uBlend, 0.25, clamp(vel / 20.0, 0.0, 1.0));
  // where the history had to be clipped hard (edge flips between frames) trust the stable history a bit more
  if (vel < 0.5) blend *= mix(1.0, 0.6, clamp(ma - 1.0, 0.0, 1.0));
  if (isChar) blend = max(blend, 0.14);
  vec3 res = mix(hist, curT, blend);
  fragColor = vec4(itm(fromYC(res)), 1.0);
}`,
  });

  // ---------------------------------------------------------------- DoF (half-res gather bokeh)
  const dofState = { focus: 10, aperture: 0, maxBlur: 14, auto: null, far: 1 };
  const cocUniforms = () => ({ uFocus: { value: 10 }, uBokeh: { value: 0 }, uMaxCoc: { value: 12 }, uFar: { value: 1 } });
  const GLSL_COC = /* glsl */`
uniform float uFocus, uBokeh, uMaxCoc, uFar;
float cocAt(float d, vec2 uv) { // signed CoC in half-res pixels (background side scaled by uFar)
  if (isSky(d)) return min(uMaxCoc, uBokeh * 0.5 * uFar);
  float z = -viewPosFromDepth(uv, d).z;
  float c = uBokeh * 0.5 * (z - uFocus) / max(z, 1e-3);
  if (c > 0.0) c *= uFar;
  return clamp(c, -uMaxCoc, uMaxCoc);
}`;
  const dofPre = new FSPass({
    name: 'dofPrefilter',
    uniforms: { ...cocUniforms(), uColor: { value: null }, uDepth: { value: depthTex }, uProjInv: { value: new THREE.Matrix4() }, uReversed: { value: reversed ? 1 : 0 }, uPx: { value: new THREE.Vector2() } },
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor;
uniform sampler2D uColor, uDepth; uniform vec2 uPx;
${GLSL_DEPTH}
${GLSL_COLOR}
${GLSL_COC}
void main() {
  vec2 o[4] = vec2[](vec2(-0.5,-0.5), vec2(0.5,-0.5), vec2(-0.5,0.5), vec2(0.5,0.5));
  vec3 c = vec3(0.0); float ws = 0.0; float cmin = 1e9, cmax = -1e9;
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUv + o[i] * uPx;
    vec3 s = texture(uColor, uv).rgb; float w = 1.0 / (1.0 + luma(s));
    c += s * w; ws += w;
    float k = cocAt(texture(uDepth, uv).r, uv); cmin = min(cmin, k); cmax = max(cmax, k);
  }
  float coc = cmin < 0.0 ? cmin : cmax;
  fragColor = vec4(c / ws, coc);
}`,
  });
  // golden-angle disk kernel
  function diskKernel(n) {
    const pts = [];
    for (let i = 0; i < n; i++) { const r = Math.sqrt((i + 0.5) / n); const a = i * 2.39996323; pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r)); }
    return pts;
  }
  const dofBokeh = new FSPass({
    name: 'dofBokeh',
    defines: { TAPS: Q.dofTaps },
    uniforms: { uSrc: { value: dofHalfA.texture }, uKernel: { value: diskKernel(Q.dofTaps) }, uMaxCoc: { value: 12 }, uPx: { value: new THREE.Vector2() } },
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc; uniform vec2 uKernel[TAPS]; uniform float uMaxCoc; uniform vec2 uPx;
float weigh(float coc, float r) { return clamp((coc - r + 2.0) / 2.0, 0.0, 1.0); }
void main() {
  vec4 ctr = texture(uSrc, vUv);
  vec3 bg = vec3(0.0), fg = vec3(0.0); float bw = 0.0, fw = 0.0;
  for (int i = 0; i < TAPS; i++) {
    vec2 o = uKernel[i] * uMaxCoc; float r = length(o);
    vec4 s = texture(uSrc, vUv + o * uPx);
    float w = weigh(max(0.0, min(s.a, ctr.a)), r); bg += s.rgb * w; bw += w;
    float f = weigh(-s.a, r); fg += s.rgb * f; fw += f;
  }
  bg /= bw + (bw == 0.0 ? 1.0 : 0.0);
  fg /= fw + (fw == 0.0 ? 1.0 : 0.0);
  float a = min(1.0, fw * 3.14159 / float(TAPS));
  fragColor = vec4(mix(bg, fg, a), a);
}`,
  });
  const dofPost = new FSPass({
    name: 'dofTent',
    uniforms: { uSrc: { value: dofHalfB.texture }, uPx: { value: new THREE.Vector2() } },
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor; uniform sampler2D uSrc; uniform vec2 uPx;
void main() { vec4 o = vec4(uPx.xy, -uPx.xy) * 0.5;
  fragColor = 0.25 * (texture(uSrc, vUv + o.xy) + texture(uSrc, vUv + o.zy) + texture(uSrc, vUv + o.xw) + texture(uSrc, vUv + o.zw)); }`,
  });
  const dofCombine = new FSPass({
    name: 'dofCombine',
    uniforms: { ...cocUniforms(), uColor: { value: null }, uDof: { value: dofHalfA.texture }, uDepth: { value: depthTex }, uProjInv: { value: new THREE.Matrix4() }, uReversed: { value: reversed ? 1 : 0 } },
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor;
uniform sampler2D uColor, uDof, uDepth;
${GLSL_DEPTH}
${GLSL_COC}
void main() {
  vec3 src = texture(uColor, vUv).rgb;
  vec4 dof = texture(uDof, vUv);
  float coc = cocAt(texture(uDepth, vUv).r, vUv);
  float s = smoothstep(0.25, 1.2, abs(coc));
  vec3 c = mix(src, dof.rgb, s + dof.a - s * dof.a);
  fragColor = vec4(c, 1.0);
}`,
  });

  // ---------------------------------------------------------------- motion blur
  const mbState = { strength: 0, velocity: null, angular: null, maskDistance: null, prevViewProj: new THREE.Matrix4(), have: false };
  const motion = new FSPass({
    name: 'motionBlur',
    defines: { SAMPLES: Q.mbSamples },
    uniforms: {
      uColor: { value: null }, uDepth: { value: depthTex }, uProjInv: { value: new THREE.Matrix4() }, uReversed: { value: reversed ? 1 : 0 },
      uCamWorld: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() }, uScale: { value: 0.5 },
      uMask: { value: 3.0 }, uRes: { value: new THREE.Vector2(W, H) }, uFrame: { value: 0 },
    },
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor;
uniform sampler2D uColor, uDepth; uniform mat4 uCamWorld, uPrevViewProj; uniform float uScale, uMask, uFrame; uniform vec2 uRes;
${GLSL_DEPTH}
float linZ(vec2 uv) { float d = texture(uDepth, uv).r; return isSky(d) ? 1e6 : -viewPosFromDepth(uv, d).z; }
void main() {
  float d = texture(uDepth, vUv).r;
  vec3 world = isSky(d) ? (uCamWorld * vec4(viewDirFromUv(vUv) * 1e5, 1.0)).xyz : (uCamWorld * vec4(viewPosFromDepth(vUv, d), 1.0)).xyz;
  vec4 pc = uPrevViewProj * vec4(world, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  vec2 v = (vUv - puv) * uScale;
  float z = isSky(d) ? 1e6 : -viewPosFromDepth(vUv, d).z;
  v *= smoothstep(uMask, uMask + 5.0, z); // near-field (foliage beside the lens, the character) stays crisp
  float lp = length(v * uRes);
  float maxL = 0.1 * uRes.x; // (user r10e: room for the High / Very High settings)
  if (lp > maxL) v *= maxL / lp;
  vec3 c = texture(uColor, vUv).rgb;
  if (lp < 0.5) { fragColor = vec4(c, 1.0); return; }
  float j = ign(gl_FragCoord.xy + uFrame * 5.588238) - 0.5;
  vec3 acc = c; float ws = 1.0;
  int n = lp > 20.0 ? SAMPLES * 2 : SAMPLES; // long streaks: more taps (no discrete ghost copies)
  for (int i = 0; i < SAMPLES * 2; i++) {
    if (i >= n) break;
    float t = (float(i) + 0.5 + j) / float(n) - 0.5;
    vec2 uv = vUv + v * t;
    float sz = linZ(uv);
    float w = smoothstep(uMask, uMask + 5.0, sz); // don't smear the sharp foreground (character) over bg
    acc += texture(uColor, uv).rgb * w; ws += w;
  }
  fragColor = vec4(acc / ws, 1.0);
}`,
  });

  // ---------------------------------------------------------------- bloom
  const bloomDownPass = new FSPass({
    name: 'bloomDown',
    uniforms: { uSrc: { value: null }, uPx: { value: new THREE.Vector2() }, uFirst: { value: 0 } },
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor; uniform sampler2D uSrc; uniform vec2 uPx; uniform float uFirst;
${GLSL_COLOR}
vec3 s(vec2 o) { return texture(uSrc, vUv + o * uPx).rgb; }
vec3 kw(vec3 a, vec3 b, vec3 c, vec3 d) {
  if (uFirst < 0.5) return (a + b + c + d) * 0.25;
  float wa = 1.0/(1.0+luma(a)), wb = 1.0/(1.0+luma(b)), wc = 1.0/(1.0+luma(c)), wd = 1.0/(1.0+luma(d));
  return (a*wa + b*wb + c*wc + d*wd) / (wa+wb+wc+wd);
}
void main() {
  vec3 A = s(vec2(-2,-2)), B = s(vec2(0,-2)), C = s(vec2(2,-2)), D = s(vec2(-1,-1)), E = s(vec2(1,-1));
  vec3 F = s(vec2(-2,0)), G = s(vec2(0,0)), H_ = s(vec2(2,0)), I = s(vec2(-1,1)), J = s(vec2(1,1));
  vec3 K = s(vec2(-2,2)), L = s(vec2(0,2)), M = s(vec2(2,2));
  vec3 c = kw(D,E,I,J) * 0.5 + kw(A,B,F,G) * 0.125 + kw(B,C,G,H_) * 0.125 + kw(F,G,K,L) * 0.125 + kw(G,H_,L,M) * 0.125;
  float lc = luma(c); c *= min(1.0, 48.0 / max(lc, 1e-4)); // clamp bloom input (tiny sun glints must not bloom into blobs) (lighting2 r1: 16 -> 48, the sun disk glows)
  fragColor = vec4(c, 1.0);
}`,
  });
  const bloomUpPass = new FSPass({
    name: 'bloomUp',
    uniforms: { uSrc: { value: null }, uCur: { value: null }, uPx: { value: new THREE.Vector2() }, uRadius: { value: 1.0 },
      uT: { value: 1.2 }, uK: { value: 0.8 }, uThrSrc: { value: 0 } },
    // (lighting2 r1) THRESHOLDED bloom: the down chain stays plain radiance (auto exposure + SSGI read it), the soft-knee
    // threshold is applied to every level as it is added here, so only sun / sky glare, glints and emissives glow
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor; uniform sampler2D uSrc, uCur; uniform vec2 uPx; uniform float uRadius;
uniform float uT, uK, uThrSrc;
vec3 thr(vec3 c) { float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); float s = clamp(l - uT + uK, 0.0, 2.0 * uK); s = s * s / (4.0 * uK + 1e-4);
  return c * max(s, l - uT) / max(l, 1e-4); }
vec3 src(vec2 uv) { vec3 c = texture(uSrc, uv).rgb; return uThrSrc > 0.5 ? thr(c) : c; }
void main() {
  vec4 d = vec4(uPx, -uPx.x, 0.0) * uRadius;
  vec3 s = src(vUv - d.xy) + 2.0 * src(vUv - d.wy) + src(vUv - d.zy)
         + 2.0 * src(vUv + d.zw) + 4.0 * src(vUv) + 2.0 * src(vUv + d.xw)
         + src(vUv + d.zy) + 2.0 * src(vUv + d.wy) + src(vUv + d.xy);
  fragColor = vec4(thr(texture(uCur, vUv).rgb) + s / 16.0, 1.0);
}`,
  });

  // ---------------------------------------------------------------- auto exposure (eye adaptation)
  // Meters a centre-weighted log-average luminance of the (bloom-downsampled) HDR frame, rejecting the darkest and
  // brightest samples' extremes, and adapts over time (faster toward brighter). The final pass applies a PARTIAL
  // compensation (grade.aeStrength) around grade.aeKey so dark alleys open up and bright vistas calm down without
  // flattening the intended look.
  const aePass = new FSPass({
    name: 'autoExposure',
    uniforms: { uSrc: { value: null }, uPrev: { value: null }, uRate: { value: 0.1 }, uReset: { value: 1 } },
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor; uniform sampler2D uSrc, uPrev; uniform float uRate, uReset;
// weighted MEDIAN of log2 luminance (32-bin histogram over [-12, 4] EV): robust to a bright sky or a dark glass wall
void main() {
  float h[32];
  for (int i = 0; i < 32; i++) h[i] = 0.0;
  float ws = 0.0;
  for (int y = 0; y < 24; y++) for (int x = 0; x < 40; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(40.0, 24.0);
    vec3 c = texture(uSrc, uv).rgb;
    float l = clamp(log2(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5)), -12.0, 3.99);
    vec2 d = (uv - 0.5) * vec2(1.6, 1.8);
    float w = exp(-dot(d, d) * 2.2) + 0.15;                 // centre weighted (subject), some frame-wide influence
    h[int((l + 12.0) * 2.0)] += w; ws += w;
  }
  // average of the 40..60th percentile band (smooth, stable)
  float cum = 0.0, acc = 0.0, aw = 0.0;
  for (int i = 0; i < 32; i++) {
    float lo = cum / ws; cum += h[i]; float hi = cum / ws;
    float ov = max(0.0, min(hi, 0.6) - max(lo, 0.4));
    acc += ov * (float(i) + 0.5) * 0.5; aw += ov;
  }
  float cur = acc / max(aw, 1e-5) - 12.0;
  float prev = texture(uPrev, vec2(0.5)).r;
  float a = uReset > 0.5 ? 1.0 : uRate;
  fragColor = vec4(mix(prev, cur, a), cur, 0.0, 1.0);
}`,
  });

  // ---------------------------------------------------------------- final
  const grade = {
    autoExposure: true,
    aeKey: -2.05,      // log2 luminance that maps to the base exposure (calibrated on the reference shots)
    aeStrength: 0.42,  // 0 = fixed exposure, 1 = full compensation
    aeRange: 1.25,     // max EV correction either way
    aeSpeedUp: 2.5, aeSpeedDown: 1.4, // adaptation speeds (1/s)
    exposure: 0.8,
    bloom: 0.11,     // (lighting2 r2) 0.07 -> 0.11 (sun / wet glints glow like the golden-hour ref) (lighting2 r1) additive, thresholded (was a 0.045 energy-conserving mix of the whole frame)
    bloomThreshold: 0.9, bloomKnee: 0.7, // (lighting2 r2) 1.1 -> 0.9 // HDR (pre-exposure) luminance
    saturation: 1.14, // (lighting2 r3) 1.0 -> 1.14 day refs: richer brick / foliage / sky (with the warm cast removed below)
    contrast: 1.18, // (lighting2 r3) 1.14 -> 1.18  // (atmosphere r2: 1.15 -> 1.2, critic: 'grey, lifted blacks, no real darks') (lighting2 r1: 1.14, shade crushed)
    pivot: 0.18,     // contrast pivot (display-linear, ~mid grey)
    satKnee: 0.72,   // chroma soft-clip: saturation above this is compressed (keeps neon foliage/paint in gamut)
    lift: new THREE.Vector3(-0.004, -0.004, -0.003), // (lighting2 r1) was -0.009: anything below ~1% went pure black // black point (atmosphere r2: deeper, was -0.004/-0.005/-0.008)
    gamma: new THREE.Vector3(1.0, 1.0, 1.0),
    gain: new THREE.Vector3(1.015, 1.0, 0.975), // (lighting2 r3) was 1.03/0.95: whole frame read sepia      // (atmosphere r1: 1.06/0.9 -> 1.03/0.95, the horizon / clouds read cream-yellow; refs' whites are neutral)
    whiteBalance: new THREE.Vector3(1.0, 1.0, 1.0),
    // (atmosphere r2) split toning: cool shadows / warm highlights (display-linear luma-weighted tint, luma-neutral)
    splitShadow: new THREE.Vector3(0.95, 1.0, 1.07),
    splitHigh: new THREE.Vector3(1.035, 1.0, 0.95), // (lighting2 r3) was 1.05/0.92
    splitBalance: 0.3, // luma where the tint crosses over
    vignette: 0.28,
    ca: 0.0009,
    sharpen: Q.sharpen,
    grain: 0.012,
    shafts: 1.0,     // volumetric sun shaft strength
    flare: 1.0,      // lens flare / sun glare strength
    gi: 0.5,         // (lighting2 r3) 1.0 -> 0.7 (less fill: darker shade, user) (lighting2 r1) SSGI bounce strength
    toe: 0.34, // (lighting2 r3) 0.36 -> 0.34 (tried 0.3: shade crushed to 0.004 vs topdown ref 0.023)
    // (lighting2 r2) 0.45 -> 0.36: the stronger sky / bounce fill lifts shade, keep some contrast (lighting2 r1) tonemap toe: linear slope floor under the ACES curve (0 = plain ACES)
  };
  const final = new FSPass({
    name: 'final',
    uniforms: {
      uColor: { value: null }, uBloom: { value: null }, uPx: { value: new THREE.Vector2() },
      uExposure: { value: 1 }, uBloomStr: { value: 0.04 }, uSat: { value: 1 }, uContrast: { value: 1 },
      uLift: { value: grade.lift }, uGamma: { value: grade.gamma }, uGain: { value: grade.gain }, uWB: { value: grade.whiteBalance },
      uVignette: { value: 0.3 }, uCA: { value: 0.001 }, uSharpen: { value: 0.3 }, uGrain: { value: 0 }, uFrame: { value: 0 },
      uAspect: { value: 1 },
      uSunVis: { value: sunVisRT.texture }, uSunUv: { value: new THREE.Vector2() }, uFlare: { value: 0 },
      uSunCol: { value: new THREE.Vector3() }, uPivot: { value: 0.18 }, uSatKnee: { value: 0.72 },
      uDepthS: { value: depthTex }, uProjInvS: { value: new THREE.Matrix4() }, uRevS: { value: reversed ? 1 : 0 },
      uAE: { value: null }, uAEOn: { value: 0 }, uAEKey: { value: 0 }, uAEStr: { value: 0.6 }, uAERange: { value: 1.25 },
      uSplitSh: { value: grade.splitShadow }, uSplitHi: { value: grade.splitHigh }, uSplitBal: { value: 0.3 },
      uToe: { value: 0.45 }, uRain: { value: 0 },
    },
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor;
uniform sampler2D uColor, uBloom; uniform vec2 uPx;
uniform float uExposure, uBloomStr, uSat, uContrast, uVignette, uCA, uSharpen, uGrain, uFrame, uAspect;
uniform vec3 uLift, uGamma, uGain, uWB; uniform float uPivot, uSatKnee;
uniform sampler2D uSunVis; uniform vec2 uSunUv; uniform float uFlare; uniform vec3 uSunCol;
uniform sampler2D uAE; uniform float uAEOn, uAEKey, uAEStr, uAERange;
uniform vec3 uSplitSh, uSplitHi; uniform float uSplitBal;
uniform sampler2D uDepthS; uniform mat4 uProjInvS; uniform float uRevS;
bool isSkyD(float d) { return uRevS > 0.5 ? d <= 0.0 : d >= 1.0; }
vec3 viewPosFromDepthS(vec2 uv, float d) { float z = uRevS > 0.5 ? d : d * 2.0 - 1.0; vec4 p = uProjInvS * vec4(uv * 2.0 - 1.0, z, 1.0); return p.xyz / p.w; }
// subtle camera-lens response to the sun: soft glare, a few chromatic ghosts mirrored through the centre, halo ring
vec3 lensFlare(vec2 uv) {
  float vis = texture(uSunVis, vec2(0.5)).r * uFlare;
  if (vis < 1e-3) return vec3(0.0);
  vec2 asp = vec2(uAspect, 1.0);
  vec2 sp = uSunUv; vec2 toC = vec2(0.5) - sp;
  vec3 acc = vec3(0.0);
  // glare around the sun (wide, soft)
  float ds = length((uv - sp) * asp);
  acc += vec3(1.0, 0.86, 0.66) * (0.022 / (ds * ds * 40.0 + 0.02)) * 0.02;
  // (lighting2 r1) physically-motivated veiling glare: a tight hot core + a wide warm halo (sun glow of the golden-hour ref)
  acc += vec3(1.0, 0.86, 0.66) * (0.22 * exp(-ds * 13.0) + 0.05 * exp(-ds * 3.5)); // (lighting2 r2) brighter core + wider warm halo (golden-hour ref sun bloom)
  // ghosts
  const float gpos[5] = float[](0.55, 0.9, 1.25, 1.6, 2.1);
  const float gsize[5] = float[](0.035, 0.018, 0.06, 0.025, 0.09);
  const vec3 gcol[5] = vec3[](vec3(0.45, 0.6, 1.0), vec3(1.0, 0.7, 0.35), vec3(0.4, 1.0, 0.6), vec3(1.0, 0.45, 0.3), vec3(0.5, 0.55, 1.0));
  for (int i = 0; i < 5; i++) {
    vec2 gp = sp + toC * gpos[i];
    float r = length((uv - gp) * asp) / gsize[i];
    float disk = smoothstep(1.0, 0.75, r) * (0.55 + 0.45 * smoothstep(0.2, 1.0, r));
    acc += gcol[i] * disk * 0.012;
  }
  // halo ring centred on the screen, brightest on the sun side
  vec2 hv = (uv - vec2(0.5)) * asp; float hr = length(hv);
  float ring = exp(-pow((hr - 0.42) / 0.018, 2.0)) * max(dot(normalize(hv + 1e-5), normalize(-toC * asp + 1e-5)), 0.0);
  acc += vec3(0.55, 0.7, 1.0) * ring * 0.01;
  // fade as the sun leaves the frame
  vec2 e = smoothstep(-0.25, 0.1, sp) * smoothstep(1.25, 0.9, sp);
  return acc * vis * e.x * e.y * uSunCol;
}
${GLSL_COLOR}
float ignf(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
// ACES fitted (Stephen Hill)
const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
// (lighting2 r1) softer toe: the fitted RRT crushes the darks ~6x at 0.02 (shade went black while sunlit faces were fine);
// a smooth max with a linear segment (slope uToe) keeps shaded walls / streets readable, mid-tones and highlights unchanged
uniform float uToe; uniform float uRain;
vec3 aces(vec3 c) { c = ACESIn * c; vec3 r = RRTAndODTFit(c); vec3 l = c * uToe;
  r = 0.5 * (r + l + sqrt((r - l) * (r - l) + 0.01 * (r + l) * (r + l)));
  return clamp(ACESOut * r, 0.0, 1.0); }
vec3 tmS(vec3 c) { return c / (1.0 + luma(c)); }
vec3 itmS(vec3 c) { return c / max(1.0 - luma(c), 1e-4); }
void main() {
  vec2 d = vUv - 0.5;
  // sharpen (in a compressed domain to avoid halos on HDR edges)
  vec3 c0 = tmS(texture(uColor, vUv).rgb);
  vec3 n = tmS(texture(uColor, vUv + vec2(0.0, uPx.y)).rgb), s = tmS(texture(uColor, vUv - vec2(0.0, uPx.y)).rgb);
  vec3 e = tmS(texture(uColor, vUv + vec2(uPx.x, 0.0)).rgb), w = tmS(texture(uColor, vUv - vec2(uPx.x, 0.0)).rgb);
  // luma-only adaptive sharpen (no chroma fringes / colour noise), weaker with distance (TAA already resolves far detail)
  float l0 = luma(c0), ln = luma(n), ls = luma(s), le_ = luma(e), lw = luma(w);
  float mnl = min(l0, min(min(ln, ls), min(le_, lw))), mxl = max(l0, max(max(ln, ls), max(le_, lw)));
  float amp = sqrt(clamp(min(mnl, 1.0 - mxl) / max(mxl, 1e-4), 0.0, 1.0));
  float dz = texture(uDepthS, vUv).r;
  float zv = isSkyD(dz) ? 1e4 : -viewPosFromDepthS(vUv, dz).z;
  float distK = mix(1.0, 0.35, smoothstep(15.0, 120.0, zv));
  float dl = (4.0 * l0 - ln - ls - le_ - lw) * uSharpen * amp * 0.25 * distK;
  vec3 c = itmS(clamp(c0 * (1.0 + dl / max(l0, 1e-4)), 0.0, 0.999));
  // chromatic aberration (radial, very subtle)
  vec2 cao = d * dot(d, d) * uCA * 4.0 * smoothstep(0.3, 0.7, length(d * vec2(uAspect, 1.0))); // edges only
  c.r = mix(c.r, texture(uColor, vUv - cao).r, 0.85);
  c.b = mix(c.b, texture(uColor, vUv + cao).b, 0.85);
  // bloom (energy-conserving mix)
  vec3 b = texture(uBloom, vUv).rgb;
  c += b * uBloomStr; // (lighting2 r1) additive thresholded bloom
  c += lensFlare(vUv);
  float ev = 0.0;
  if (uAEOn > 0.5) ev = clamp(-(texture(uAE, vec2(0.5)).r - uAEKey) * uAEStr, -uAERange, uAERange);
  c *= uExposure * exp2(ev) * uWB;
  // vignette
  vec2 dv = d * vec2(uAspect, 1.0);
  c *= mix(1.0, 1.0 - smoothstep(0.25, 1.05, length(dv)), uVignette);
  c = aces(c);
  { // (atmosphere r2) split toning: cool shade, warm sunlit highlights (keeps luma)
    float sl = luma(c);
    vec3 tt = mix(uSplitSh, uSplitHi, smoothstep(uSplitBal * 0.25, uSplitBal * 2.2, sl));
    tt /= dot(tt, vec3(0.2126, 0.7152, 0.0722));
    c *= tt;
  }
  if (uRain > 0.0) { // (lighting2 r3) overcast preset: cheap screen-space rain streaks (2 layers, slanted, falling)
    float rr = 0.0, tt = uFrame / 60.0;
    for (int i = 0; i < 2; i++) {
      float sc = i == 0 ? 1.0 : 1.9;
      vec2 p = vec2(vUv.x * uAspect * 70.0 * sc + vUv.y * 5.0 * sc, vUv.y * 2.2 * sc + tt * (3.2 + 1.4 * float(i)));
      float col = floor(p.x), h = fract(sin(col * 91.3 + float(i) * 17.0) * 43758.5);
      float y = fract(p.y + h * 10.0 + tt * h);
      float st = smoothstep(0.0, 0.04, y) * smoothstep(0.3 + 0.2 * h, 0.04, y) * step(0.5, h);
      st *= smoothstep(0.35, 0.0, abs(fract(p.x) - 0.5));
      rr += st * (i == 0 ? 0.7 : 0.4);
    }
    c = mix(c, vec3(0.72, 0.75, 0.8), clamp(rr * 0.11 * uRain, 0.0, 1.0));
  }
  // grade (display-linear): lift/gamma/gain, contrast, saturation
  c = max(uGain * (c + uLift * (1.0 - c)), 0.0);
  c = pow(max(c, 0.0), 1.0 / uGamma);
  float l = luma(c);
  c = mix(vec3(l), c, uSat);
  c = clamp(c, 0.0, 1.0);
  { // chroma soft-clip
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    float st = (mx - mn) / max(mx, 1e-4);
    if (st > uSatKnee) {
      float t = uSatKnee + (1.0 - uSatKnee) * (1.0 - exp(-(st - uSatKnee) / (1.0 - uSatKnee) * 1.6)) / 1.6 * 1.25;
      float k = clamp(t / st, 0.0, 1.0);
      c = mx - (mx - c) * k;
    }
  }
  vec3 lc = log2(c + 1e-4);
  c = exp2((lc - log2(uPivot)) * uContrast + log2(uPivot)) - 1e-4;
  // highlight shoulder: roll off above 0.72 instead of clipping (sky, white paint, speculars keep detail)
  // shoulder from 0.8 that still reaches 1.0 (~1% of pixels: speculars, white paint, sun-lit clouds may clip like the refs)
  // (lighting2 r3) day refs (measured): p95 0.44-0.77, p99 <= 0.83 display-linear, < 1 % clipped; ours had p95 0.85-0.9
  // and 2-11 % clipped (sunlit cream walls, sky). Softer shoulder from 0.62 (asymptote ~0.99): sunlit faces stay bright
  // + warm with texture instead of white
  vec3 hs = 0.62 + 0.37 * (1.0 - exp(-max(c - 0.62, 0.0) / 0.37));
  c = mix(c, hs, step(0.62, c));
  vec3 o = linearToSRGB(clamp(c, 0.0, 1.0));
  // grain + dither
  float g = ignf(gl_FragCoord.xy + fract(uFrame * 0.618) * 113.0) - 0.5;
  o += g * (1.0 / 255.0 + uGrain * (1.0 - o) * 0.5);
  fragColor = vec4(o, 1.0);
}`,
  });

  // ---------------------------------------------------------------- debug view (pipeline.debug = {tex:'ssr'|'shafts'|'ao'|'scene', scale})
  const dbgPass = new FSPass({
    name: 'debugBlit',
    uniforms: { uSrc: { value: null }, uScale: { value: 1 }, uMode: { value: 0 } },
    fragmentShader: /* glsl */`
precision highp float; in vec2 vUv; out vec4 fragColor; uniform sampler2D uSrc; uniform float uScale, uMode;
void main() { vec4 t = texture(uSrc, vUv); vec3 c = uMode > 0.5 ? vec3(t.a - 1.0) : t.rgb;
  c = abs(c) * uScale; fragColor = vec4(pow(c / (1.0 + c), vec3(1.0 / 2.2)), 1.0); }`,
  });

  // ---------------------------------------------------------------- state
  let frame = 0;
  let histIdx = 0;
  let resetHistory = true;
  let aeReset = true;
  const projUnjit = new THREE.Matrix4();
  const viewProj = new THREE.Matrix4();
  const prevViewProj = new THREE.Matrix4();
  const prevCamPos = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const prevCamQuat = new THREE.Quaternion();
  const tmpQ = new THREE.Quaternion();
  const tmpM = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  const lens = { sunUv: new THREE.Vector2(), onScreen: false };
  const _virtual = new THREE.Matrix4();

  function setSize(w, h) {
    const pr = renderer.getPixelRatio();
    W = Math.max(1, Math.floor(w * pr)); H = Math.max(1, Math.floor(h * pr));
    sceneRT.setSize(W, H); depthTex.image.width = W; depthTex.image.height = H;
    aoRT.setSize(W, H); litRT.setSize(W, H); hist[0].setSize(W, H); hist[1].setSize(W, H);
    postA.setSize(W, H); postB.setSize(W, H);
    skyRT.setSize(W >> 1, H >> 1); dofHalfA.setSize(W >> 1, H >> 1); dofHalfB.setSize(W >> 1, H >> 1);
    ssrRT.setSize(W >> 1, H >> 1); shaftRT.setSize(W >> 1, H >> 1); ssgiRT.setSize(W >> 1, H >> 1);
    gmirror?.setSize(W, H);
    maskRT.setSize(W, H); maskDepth.image.width = W; maskDepth.image.height = H;
    allocBloom();
    if (ao) ao.setSize(W, H);
    resetHistory = true;
  }

  function updateCoc(u, cam) {
    u.uFocus.value = dofState.focus;
    u.uBokeh.value = dofState.aperture;   // full-res px at infinity -> *0.5 in shader for half res
    u.uMaxCoc.value = dofState.maxBlur;
    u.uFar.value = dofState.far;
    if (u.uProjInv) u.uProjInv.value.copy(cam.projectionMatrixInverse);
  }

  // materials that render their own (planar) reflections opt out of SSR
  const ssrOptOut = new WeakSet();
  function scanSSROptOut() {
    scene.traverse(o => {
      const m = o.material; if (!m || Array.isArray(m) || ssrOptOut.has(m)) return;
      ssrOptOut.add(m);
      let key = '';
      try { key = m.customProgramCacheKey?.() ?? ''; } catch (e) { /* ignore */ }
      if (m.userData?.noSSR || key.includes('hero-glass')) { m.defines = { ...(m.defines || {}), NO_SSR: '' }; m.needsUpdate = true; }
    });
  }

  renderer.info.autoReset = false;
  const stats = { calls: 0, triangles: 0 };
  function render(dt = 1 / 60) {
    frame++;
    stats.calls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles; // previous frame, all passes
    stats.shadowCalls = shadowStat.cCalls; stats.shadowTris = shadowStat.cTris; stats.shadowCpu = shadowStat.cCpu || 0; shadowStat.cCalls = shadowStat.cTris = shadowStat.cCpu = 0; // (perf)
    renderer.info.reset();
    if (ssrOn && frame % 120 === 1) scanSSROptOut();
    prof.poll();
    const cam = camera;
    cam.updateMatrixWorld();
    if (dofState.auto) {
      dofState.auto.getWorldPosition(tmpV);
      dofState.focus = tmpV.distanceTo(tmpV.clone().setFromMatrixPosition(cam.matrixWorld));
    }

    // --- camera cut detection
    camPos.setFromMatrixPosition(cam.matrixWorld);
    tmpQ.setFromRotationMatrix(cam.matrixWorld);
    if (camPos.distanceTo(prevCamPos) > 60 || tmpQ.angleTo(prevCamQuat) > 0.6) resetHistory = true;
    // motion blur fades back in over ~0.3 s after a cut / resize / resetHistory() (a stale prev matrix would streak)
    mbState.fade = resetHistory ? 0 : Math.min(1, (mbState.fade ?? 1) + dt / 0.3);

    // --- jitter (make sure three has switched the camera to reversed-Z first, or our saved matrix would be stale)
    if (reversed && cam.reversedDepth !== true) { cam._reversedDepth = true; cam.updateProjectionMatrix(); }
    projUnjit.copy(cam.projectionMatrix);
    viewProj.multiplyMatrices(projUnjit, cam.matrixWorldInverse);
    const jIdx = (frame % 16) + 1;
    const jx = Q.taa ? (halton(jIdx, 2) - 0.5) : 0, jy = Q.taa ? (halton(jIdx, 3) - 0.5) : 0;
    if (Q.taa) {
      cam.projectionMatrix.elements[8] += (2 * jx) / W;
      cam.projectionMatrix.elements[9] += (2 * jy) / H;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    }

    // --- (render r-refl) glass mirror of the player / cars / peds (sampled by the facade glass in the scene pass)
    if (gmirror) { prof.begin('glassMirror'); gmirror.render(cam); }

    // --- scene
    prof.begin('scene+shadows');
    renderer.setRenderTarget(sceneRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);

    // --- character mask (depth only, same jittered camera)
    const po = window.__ctx?.player?.object;
    let maskOn = false;
    if (Q.taa && po && po.visible) {
      prof.begin('charMask');
      po.updateMatrixWorld();
      objCur.copy(po.matrixWorld);
      const swapped = [];
      po.traverse(o => {
        if (o.material && (o.isMesh || o.isSkinnedMesh) && o.visible) { swapped.push([o, o.material]); o.material = maskMat; }
        else if (o.visible && (o.isLine || o.isPoints || o.isSprite)) { swapped.push([o, null]); o.visible = false; }
      });
      const oldAuto = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(maskRT); renderer.clear(false, true, false);
      renderer.render(po, cam);
      renderer.shadowMap.autoUpdate = oldAuto;
      for (const [o, m] of swapped) { if (m) o.material = m; else o.visible = true; }
      objDelta.copy(objPrev).multiply(tmpM.copy(objCur).invert());
      maskOn = objHave;
      objPrev.copy(objCur); objHave = true;
    }

    // --- sky (half res)
    prof.begin('sky');
    sky.renderSkyPass(skyRT, cam, depthTex, W, H, frame, reversed);

    // --- sun visibility for lens effects
    const sunNdc = tmpV.copy(sky.sunDir).multiplyScalar(1e4).add(camPos).project(cam).clone(); // (lighting2 r1) clone: tmpV is overwritten just below, which put the glare / flare at sunDir.xy instead of the sun
    const sunOnScreen = Math.abs(sunNdc.x) < 1.3 && Math.abs(sunNdc.y) < 1.3 && tmpV.copy(sky.sunDir).dot(camFwd.set(0, 0, -1).applyQuaternion(tmpQ)) > 0;
    lens.sunUv.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5); lens.onScreen = sunOnScreen;
    if (sunOnScreen && grade.flare > 0) {
      sunVis.uniforms.uSunUv.value.copy(lens.sunUv); sunVis.uniforms.uAspect.value = W / H;
      sunVis.render(renderer, sunVisRT);
    }

    // --- SSR
    const envTex = scene.environment;
    const doSSR = ssrOn && envTex && envTex.mapping === THREE.CubeUVReflectionMapping;
    if (doSSR) {
      prof.begin('ssr');
      const u = ssr.uniforms;
      const hgt = envTex.image.height;
      if (ssr.material.userData.envH !== hgt) {
        const maxMip = Math.log2(hgt) - 2;
        ssr.material.defines.CUBEUV_TEXEL_HEIGHT = 1 / hgt;
        ssr.material.defines.CUBEUV_TEXEL_WIDTH = 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16));
        ssr.material.defines.CUBEUV_MAX_MIP = maxMip.toFixed(1);
        ssr.material.needsUpdate = true; ssr.material.userData.envH = hgt;
      }
      u.envMap.value = envTex; u.uEnvI.value = scene.environmentIntensity ?? 1;
      u.uPrev.value = hist[1 - histIdx].texture; u.uHavePrev.value = (Q.taa && !resetHistory) ? 1 : 0;
      u.uProj.value.copy(cam.projectionMatrix); u.uProjInv.value.copy(cam.projectionMatrixInverse);
      u.uCamWorld.value.copy(cam.matrixWorld); u.uPrevViewProj.value.copy(prevViewProj);
      u.uRes.value.set(W, H); u.uFrame.value = frame % 64;
      ssr.render(renderer, ssrRT);
    }

    // --- SSGI (lighting2 r1)
    const doGI = ssgiOn && envTex && envTex.mapping === THREE.CubeUVReflectionMapping && !!csm.lights[0].shadow.map?.depthTexture;
    if (doGI) {
      prof.begin('ssgi');
      const u = ssgi.uniforms;
      const hgt = envTex.image.height;
      if (ssgi.material.userData.envH !== hgt) {
        const maxMip = Math.log2(hgt) - 2;
        ssgi.material.defines.CUBEUV_TEXEL_HEIGHT = 1 / hgt;
        ssgi.material.defines.CUBEUV_TEXEL_WIDTH = 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16));
        ssgi.material.defines.CUBEUV_MAX_MIP = maxMip.toFixed(1);
        ssgi.material.needsUpdate = true; ssgi.material.userData.envH = hgt;
      }
      for (let i = 0; i < Math.min(NC, 4); i++) {
        const l = csm.lights[i];
        u['uSM' + i].value = l.shadow.map?.depthTexture ?? null;
        u.uSMat.value[i].copy(l.shadow.matrix);
      }
      for (let i = NC; i < 4; i++) u['uSM' + i].value = u.uSM0.value;
      const sp = csm.splits;
      u.uSplits.value.set(sp[1] ?? 1e9, sp[2] ?? 1e9, sp[3] ?? 1e9, sp[4] ?? 1e9);
      const A = lighting.amb;
      u.envMap.value = envTex; u.uEnvI.value = (scene.environmentIntensity ?? 1) * (A.shape.z > 0 ? A.shape.z : 1);
      u.uAmbBounce.value.set(A.bounce.x, A.bounce.y, A.bounce.z).multiplyScalar(0.6 * (scene.environmentIntensity ?? 1));
      u.uPrevRad.value = bloomDown[1].texture; u.uHavePrev.value = (!resetHistory && frame > 2) ? 1 : 0;
      u.uProj.value.copy(cam.projectionMatrix); u.uProjInv.value.copy(cam.projectionMatrixInverse);
      u.uCamWorld.value.copy(cam.matrixWorld); u.uPrevViewProj.value.copy(prevViewProj);
      u.uRes.value.set(W, H); u.uFrame.value = frame % 64;
      u.uStrength.value = grade.gi * (A.bounce.w ?? 1);
      ssgi.render(renderer, ssgiRT);
    }

    // --- volumetric sun shafts
    const doShafts = shaftsOn && lighting.fog.shafts > 0 && sky.sunDir.y > 0.0;
    if (doShafts) {
      prof.begin('shafts');
      const u = shafts.uniforms;
      for (let i = 0; i < Math.min(NC, 4); i++) {
        const l = csm.lights[i];
        u['uSM' + i].value = l.shadow.map?.depthTexture ?? null;
        u.uSMat.value[i].copy(l.shadow.matrix);
      }
      for (let i = NC; i < 4; i++) u['uSM' + i].value = u.uSM0.value;
      const sp = csm.splits;
      u.uSplits.value.set(sp[1] ?? 1e9, sp[2] ?? 1e9, sp[3] ?? 1e9, sp[4] ?? 1e9);
      u.uProjInv.value.copy(cam.projectionMatrixInverse);
      u.uCamWorld.value.copy(cam.matrixWorld); u.uCamPos.value.copy(camPos);
      cam.getWorldDirection(u.uCamFwd.value);
      u.uRes.value.set(W, H); u.uFrame.value = frame % 64;
      u.uStrength.value = grade.shafts * lighting.fog.shafts;
      if (u.uSM0.value) shafts.render(renderer, shaftRT);
    }

    // --- AO
    let colorTex = sceneRT.texture;
    if (ao) {
      prof.begin('ao');
      ao.render(renderer, sceneRT, aoRT);
      colorTex = aoRT.texture;
    }

    // --- composite
    prof.begin('composite');
    {
      const u = composite.uniforms;
      u.uColor.value = colorTex;
      u.uProjInv.value.copy(cam.projectionMatrixInverse);
      u.uCamWorld.value.copy(cam.matrixWorld);
      u.uCamPos.value.copy(camPos);
      const f = lighting.fog;
      u.uMoonDir.value.copy(lighting.moon?.dir ?? u.uMoonDir.value); u.uMoonK.value = lighting.moon?.k ?? 0; // (daynight)
      u.uFogDensity.value = f.density; u.uFogFalloff.value = f.heightFalloff; u.uFogSun.value = f.sunScatter;
      u.uFogTint.value.copy(f.tint); u.uFogStart.value = f.startDistance;
      u.uSSROn.value = doSSR ? 1 : 0;
      u.uGIOn.value = doGI ? 1 : 0;
      u.uShaftOn.value = doShafts && shafts.uniforms.uSM0.value ? 1 : 0;
      u.uHalfPx.value.set(1 / shaftRT.width, 1 / shaftRT.height);
      composite.render(renderer, litRT);
    }

    // --- TAA
    let cur = litRT;
    if (Q.taa) {
      prof.begin('taa');
      const u = taa.uniforms;
      const out = hist[histIdx], prev = hist[1 - histIdx];
      u.uCurrent.value = litRT.texture; u.uHistory.value = prev.texture;
      u.uProjInv.value.copy(cam.projectionMatrixInverse);
      u.uCamWorld.value.copy(cam.matrixWorld);
      u.uPrevViewProj.value.copy(prevViewProj);
      u.uRes.value.set(W, H);
      u.uReset.value = resetHistory ? 1 : 0;
      u.uBlend.value = 0.08;
      u.uJitter.value.set(-jx / W, -jy / H);
      u.uProjInvU.value.copy(projUnjit).invert();
      u.uMaskOn.value = maskOn ? 1 : 0; u.uObjDelta.value.copy(objDelta);
      taa.render(renderer, out);
      histIdx = 1 - histIdx;
      cur = out;
    }
    resetHistory = false;

    // restore unjittered projection for everything after (DoF / MB reconstruct with the jitter-free matrix)
    cam.projectionMatrix.copy(projUnjit);
    cam.projectionMatrixInverse.copy(projUnjit).invert();

    let pp = [postA, postB], ppi = 0;
    // --- DoF
    if (dofState.aperture > 0.01) {
      prof.begin('dof');
      updateCoc(dofPre.uniforms, cam);
      dofPre.uniforms.uColor.value = cur.texture;
      dofPre.uniforms.uPx.value.set(1 / W, 1 / H);
      dofPre.render(renderer, dofHalfA);
      dofBokeh.uniforms.uSrc.value = dofHalfA.texture;
      dofBokeh.uniforms.uMaxCoc.value = dofState.maxBlur;
      dofBokeh.uniforms.uPx.value.set(2 / W, 2 / H);
      dofBokeh.render(renderer, dofHalfB);
      dofPost.uniforms.uSrc.value = dofHalfB.texture;
      dofPost.uniforms.uPx.value.set(2 / W, 2 / H);
      dofPost.render(renderer, dofHalfA);
      updateCoc(dofCombine.uniforms, cam);
      dofCombine.uniforms.uColor.value = cur.texture;
      dofCombine.uniforms.uDof.value = dofHalfA.texture;
      dofCombine.render(renderer, pp[ppi]);
      cur = pp[ppi]; ppi = 1 - ppi;
    }

    // --- motion blur
    if (mbState.strength > 0.001 && (mbState.fade > 0.001 || mbState.velocity || mbState.angular)) {
      let pvp = prevViewProj;
      if (mbState.velocity || mbState.angular) {
        // synthetic previous camera: undo `velocity * (1/60)` translation and `angular * (1/60)` rotation
        const h = 1 / 60;
        const p = camPos.clone();
        if (mbState.velocity) p.addScaledVector(mbState.velocity, -h);
        const q = tmpQ.clone();
        if (mbState.angular) {
          const ang = mbState.angular.length() * h;
          if (ang > 0) q.premultiply(new THREE.Quaternion().setFromAxisAngle(mbState.angular.clone().normalize(), -ang));
        }
        _virtual.compose(p, q, new THREE.Vector3(1, 1, 1)).invert();
        pvp = tmpM.multiplyMatrices(projUnjit, _virtual);
      }
      if (mbState.have || mbState.velocity || mbState.angular) {
        prof.begin('motionBlur');
        const u = motion.uniforms;
        u.uColor.value = cur.texture;
        u.uProjInv.value.copy(cam.projectionMatrixInverse);
        u.uCamWorld.value.copy(cam.matrixWorld);
        u.uPrevViewProj.value.copy(pvp);
        // normalise real per-frame motion to a 60 fps shutter
        const fpsNorm = (mbState.velocity || mbState.angular) ? 1 : Math.min(2, (1 / 60) / Math.max(dt, 1e-3));
        u.uScale.value = mbState.strength * fpsNorm * (mbState.velocity || mbState.angular ? 1 : mbState.fade ?? 1);
        u.uMask.value = mbState.maskDistance ?? (dofState.auto || dofState.focus < 30 ? dofState.focus + 1.5 : 3.0);
        u.uRes.value.set(W, H);
        u.uFrame.value = frame % 64;
        motion.render(renderer, pp[ppi]);
        cur = pp[ppi]; ppi = 1 - ppi;
      }
    }

    // --- bloom
    prof.begin('bloom');
    let src = cur.texture, sw = W, shh = H;
    for (let i = 0; i < bloomDown.length; i++) {
      bloomDownPass.uniforms.uSrc.value = src;
      bloomDownPass.uniforms.uPx.value.set(1 / sw, 1 / shh);
      bloomDownPass.uniforms.uFirst.value = i === 0 ? 1 : 0;
      bloomDownPass.render(renderer, bloomDown[i]);
      src = bloomDown[i].texture; sw = bloomDown[i].width; shh = bloomDown[i].height;
    }
    let up = bloomDown[bloomDown.length - 1];
    for (let i = bloomDown.length - 2; i >= 0; i--) {
      bloomUpPass.uniforms.uSrc.value = up.texture;
      bloomUpPass.uniforms.uCur.value = bloomDown[i].texture;
      bloomUpPass.uniforms.uPx.value.set(1 / up.width, 1 / up.height);
      bloomUpPass.uniforms.uThrSrc.value = i === bloomDown.length - 2 ? 1 : 0;
      bloomUpPass.uniforms.uT.value = grade.bloomThreshold; bloomUpPass.uniforms.uK.value = grade.bloomKnee;
      bloomUpPass.render(renderer, bloomUp[i]);
      up = bloomUp[i];
    }

    // --- auto exposure
    if (grade.autoExposure) {
      prof.begin('autoExposure');
      const u = aePass.uniforms;
      const prevT = aeRT[aeIdx], outT = aeRT[1 - aeIdx];
      u.uSrc.value = bloomDown[Math.min(3, bloomDown.length - 1)].texture; u.uPrev.value = prevT.texture;
      u.uReset.value = aeReset ? 1 : 0; aeReset = false;
      // asymmetric speed can't be decided on the CPU without readback: use the mean of both (smooth, stable)
      const sp = 0.5 * (grade.aeSpeedUp + grade.aeSpeedDown);
      u.uRate.value = 1 - Math.exp(-Math.max(dt, 1 / 240) * sp);
      aePass.render(renderer, outT);
      aeIdx = 1 - aeIdx;
    }

    // --- final
    prof.begin('final');
    {
      const u = final.uniforms;
      u.uColor.value = cur.texture; u.uBloom.value = up.texture;
      u.uPx.value.set(1 / W, 1 / H);
      const td = lighting.tod || {};
      u.uRain.value = td.rain ?? 0; u.uExposure.value = grade.exposure * (td.exposure ?? 1); u.uBloomStr.value = grade.bloom * (td.bloom ?? 1); u.uSat.value = grade.saturation;
      u.uFlare.value = lens.onScreen ? grade.flare * (lighting.tod.sunK ?? 1) : 0; // (daynight) no sun flare once the sun has set u.uSunUv.value.copy(lens.sunUv);
      u.uSunCol.value.copy(sky.skyUniforms.uSunColor.value);
      u.uContrast.value = grade.contrast; u.uPivot.value = grade.pivot; u.uSatKnee.value = grade.satKnee; u.uVignette.value = grade.vignette; u.uCA.value = grade.ca;
      u.uSharpen.value = grade.sharpen; u.uGrain.value = grade.grain; u.uFrame.value = frame % 36000; // (lighting2 r3) long period: rain streak clock
      u.uAspect.value = W / H;
      u.uProjInvS.value.copy(cam.projectionMatrixInverse);
      u.uAE.value = aeRT[aeIdx].texture; u.uAEOn.value = grade.autoExposure ? 1 : 0;
      u.uAEKey.value = grade.aeKey; u.uAEStr.value = grade.aeStrength; u.uAERange.value = grade.aeRange;
      u.uToe.value = grade.toe; u.uSplitSh.value = grade.splitShadow; u.uSplitHi.value = grade.splitHigh; u.uSplitBal.value = grade.splitBalance;
      final.render(renderer, null);
    }
    if (pipeline.debug) {
      const D = pipeline.debug, T = { ssr: ssrRT, ssgi: ssgiRT, shafts: shaftRT, ao: aoRT, scene: sceneRT, lit: litRT, ssrw: sceneRT }[D.tex];
      if (T) { dbgPass.uniforms.uSrc.value = T.texture; dbgPass.uniforms.uScale.value = D.scale ?? 1; dbgPass.uniforms.uMode.value = D.tex === 'ssrw' ? 1 : 0; dbgPass.render(renderer, null); }
    }
    prof.begin('external'); // GPU work issued between frames (planar mirrors, world/player updates) until next render()

    // --- history
    prevViewProj.copy(viewProj);
    prevCamPos.copy(camPos); prevCamQuat.copy(tmpQ);
    mbState.have = true;
  }

  const pipeline = {
    debug: null,
    render, setSize, grade,
    get ao() { return ao; },
    passes: { ssr, ssgi, shafts, composite, taa, final },   // debug access to uniforms
    gmirror, // (render r-refl)
    setFocus(d) { dofState.focus = Math.max(0.1, d); },
    setAperture(px) { dofState.aperture = Math.max(0, px); },
    /** background blur scale (1 = physical, <1 keeps the background crisper while the foreground still blurs) */
    setDofFar(k) { dofState.far = Math.max(0, k); },
    setDof({ focus, aperture, maxBlur, far } = {}) {
      if (far !== undefined) dofState.far = far;
      if (focus !== undefined) dofState.focus = focus;
      if (aperture !== undefined) dofState.aperture = aperture;
      if (maxBlur !== undefined) dofState.maxBlur = maxBlur;
    },
    setAutoFocus(obj) { dofState.auto = obj || null; },
    setMotionBlur(strength, opts = {}) {
      mbState.strength = strength;
      mbState.velocity = opts.cameraVelocity ? opts.cameraVelocity.clone() : null;
      mbState.angular = opts.angularVelocity ? opts.angularVelocity.clone() : null;
      mbState.maskDistance = opts.maskDistance ?? null;
    },
    resetHistory() { resetHistory = true; },
    resetExposure() { aeReset = true; },
    /** metered log2 luminance {adapted, current} (debug; GPU readback) */
    readExposure() { const b = new Float32Array(4); renderer.readRenderTargetPixels(aeRT[aeIdx], 0, 0, 1, 1, b); return { adapted: b[0], current: b[1] }; },
    timings(reset) { return prof.report(reset); },
    prepareMaterials() { if (ssrOn) scanSSROptOut(); }, // (perf r3) the NO_SSR defines the first render would add (render/warmup.js compiles after them)
    get size() { return { W, H }; },
    /** draw calls / triangles of the previous frame summed over ALL passes (shadows, mirrors, post) */
    get stats() { return { ...stats }; },
  };
  return pipeline;
}
