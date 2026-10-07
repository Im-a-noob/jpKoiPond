// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG, mulberry32, fbm2P, mix3, srgbHex, hash3i } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets, SDFK, instanced } from "../geometry";
import { $, progress, toast } from "../state";
import { canvasTex, dataTex, heightToNormal, makeCanvas, TEX } from "./textures";
import { physical, seasonal } from "./materials";
import { scene, camera, renderer, SH } from "./lighting";
import { WORLD, sdf, groundHeight } from "./terrain";
import { RT, WAVES, SIM, stepRipples } from "./water";
import { POLY } from "./terrain";
import { cubeRT } from "./lighting";
import { SIM_FS } from "./waterRipples";
import { shaderPass } from "./water";
export const RIPPLE_STATE: any = {
  water: null,
  waterMat: null,
  simA: null,
  simB: null,
  simPass: null,
  maskTex: null,
};
export let water: any = null, waterMat: any = null;

export const WATER_VS = /* glsl */`
// === WATER SURFACE: vertex ======================================================
// Sum of 4 Gerstner waves (0.5–2 cm, 0.4–3 m wavelengths, deep-water dispersion) + ripple-sim height.
uniform float uTime;
uniform vec4 uWaves[4];      // dir.xy, wavelength (m), amplitude (m)
uniform float uSteep;
uniform sampler2D tRipple;
uniform vec4 uSim;           // x0, z0, size, texel
varying vec3 vWPos;
varying vec3 vNrm;
varying vec2 vSimUv;
varying vec3 vViewPos;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 xz = wp.xz;
  vec3 disp = vec3(0.0), n = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < 4; i++) {
    vec2 D = normalize(uWaves[i].xy);
    float k = 6.2831853 / uWaves[i].z, A = uWaves[i].w;
    float c = sqrt(9.81 / k);
    float f = k * (dot(D, xz) - c * uTime);
    float S = sin(f), C = cos(f);
    disp += vec3(uSteep * A * D.x * C, A * S, uSteep * A * D.y * C);
    n -= vec3(D.x * k * A * C, uSteep * k * A * S, D.y * k * A * C);
  }
  vSimUv = (xz - uSim.xy) / uSim.z;
  wp.xyz += disp;
  wp.y += texture2D(tRipple, vSimUv).r;
  vWPos = wp.xyz; vNrm = n;
  vec4 mv = viewMatrix * wp; vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

export const WATER_FS = /* glsl */`
// === WATER SURFACE: fragment ====================================================
// Above: planar reflection + depth-aware refraction blended by Schlick Fresnel (F0 = 0.02),
//        Beer–Lambert absorption along the refracted path, shoreline foam, GGX sun glint.
// Below: Snell's window (refracted view of the world above) and total internal reflection.
#include <packing>
uniform float uTime;
uniform float uWaterY;
uniform float uUnder;
uniform float uNear;
uniform float uFar;
uniform float uReflDistort;
uniform float uRefrStr;
uniform float uDetail;
uniform float uSpecMax;
uniform vec2 uInvRes;
uniform vec2 uWind;
uniform float uGustW;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAbsorb;
uniform float uScatter;
uniform vec3 uInscatter;
uniform vec3 uFoamColor;
uniform sampler2D tRefl;
uniform sampler2D tRefr;
uniform sampler2D tRefrDepth;
uniform sampler2D tNormal;
uniform sampler2D tRipple;
uniform sampler2D tMask;
uniform samplerCube tSky;
uniform mat4 uReflMatrix;
uniform mat4 uProj;
uniform vec4 uSim;
uniform float uRain;
uniform float uIce;
uniform float uSnowCover;
uniform float uFogDensity;
uniform vec3 uFogColor;
varying vec3 vWPos;
varying vec3 vNrm;
varying vec2 vSimUv;
varying vec3 vViewPos;

float linDepth(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tRefrDepth, uv).r, uNear, uFar); }
vec3 sky(vec3 d){ return textureCube(tSky, d).rgb; }
// GGX / Trowbridge-Reitz specular for the sun, with Smith-Schlick visibility and Schlick Fresnel
vec3 sunGGX(vec3 N, vec3 V, vec3 L, float rough){
  vec3 H = normalize(L + V);
  float NdL = max(dot(N, L), 0.0), NdV = max(dot(N, V), 1e-3), NdH = max(dot(N, H), 0.0), VdH = max(dot(V, H), 0.0);
  float a2 = rough * rough * rough * rough;
  float d = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * d * d);
  float k = rough * rough * 0.5;
  float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  float F = 0.02 + 0.98 * pow(1.0 - VdH, 5.0);
  return uSunColor * D * G * F / (4.0 * NdV);
}

void main(){
  // Clip to the pond outline (mask = signed distance, metres)
  float sdM = texture2D(tMask, vSimUv).r * 4.0 - 2.0;
  if (sdM > 0.28) discard;

  float dist = length(vViewPos);
  // ---- Normal: Gerstner base + two scrolling FBM ripple layers + ripple-sim gradient
  vec3 N = normalize(vNrm);
  float fadeD = 1.0 / (1.0 + dist * 0.07);
  vec2 uv1 = vWPos.xz * 0.42 + uWind * uTime * 0.05;
  vec2 uv2 = (vWPos.xz * 1.07) * mat2(0.94, -0.34, 0.34, 0.94) + vec2(-uWind.y, uWind.x) * uTime * 0.021 + uWind * uTime * 0.03;
  vec3 d1 = texture2D(tNormal, uv1).xyz * 2.0 - 1.0;
  vec3 d2 = texture2D(tNormal, uv2).xyz * 2.0 - 1.0;
  vec2 detail = (d1.xy * 0.6 + d2.xy * 0.45) * uDetail * fadeD;
  // gust 'cat's paws': patches of stronger ripples drifting downwind
  float paws = smoothstep(0.42, 0.72, texture2D(tNormal, vWPos.xz * 0.045 - uWind * uTime * 0.035).r) * uGustW;
  detail *= 0.55 + 1.7 * paws;
  float tx = uSim.w, cell = uSim.z * tx;
  float hL = texture2D(tRipple, vSimUv - vec2(tx, 0.0)).r, hR = texture2D(tRipple, vSimUv + vec2(tx, 0.0)).r;
  float hD = texture2D(tRipple, vSimUv - vec2(0.0, tx)).r, hU = texture2D(tRipple, vSimUv + vec2(0.0, tx)).r;
  vec2 rip = vec2(hL - hR, hD - hU) / (2.0 * cell);
  N = normalize(vec3(N.x + detail.x + rip.x, N.y, N.z + detail.y + rip.y));
  // rain: every few centimetres a drop lands and throws an expanding ring (two jittered cell layers)
  if (uRain > 0.001) {
    vec2 rg = vec2(0.0);
    for (int L = 0; L < 2; L++) {
      vec2 p = vWPos.xz * (L == 0 ? 7.0 : 11.0) + float(L) * 3.7, ci = floor(p);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = ci + vec2(float(i), float(j));
        float h = fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
        vec2 cen = c + vec2(fract(h * 17.3), fract(h * 31.7));
        float t = fract(uTime * (0.8 + h * 0.7) + h * 7.0);
        vec2 dv = p - cen; float d = length(dv), r = t * 0.95;
        float ring = sin(clamp((d - r) * 26.0, -3.14159, 3.14159)) * (1.0 - t) * (1.0 - t) * step(abs(d - r), 0.12);
        rg += dv / max(d, 1e-3) * ring;
      }
    }
    N = normalize(N + vec3(rg.x, 0.0, rg.y) * 0.45 * uRain * fadeD);
  }

  vec3 V = normalize(cameraPosition - vWPos);
  vec2 suv = gl_FragCoord.xy * uInvRes;
  vec3 nV = (viewMatrix * vec4(N, 0.0)).xyz;
  vec3 col;

  if (uUnder < 0.5) {
    // ================= ABOVE THE SURFACE =================
    float NdV = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);                 // Schlick, F0 = 0.02

    // Planar reflection (mirrored camera), distorted by the surface normal
    vec4 rc = uReflMatrix * vec4(vWPos.x, uWaterY, vWPos.z, 1.0);
    vec2 ruv = rc.xy / rc.w + N.xz * uReflDistort;
    // clamp small overshoots at the frame edges (distortion) instead of falling back to the bright sky
    float outR = length(ruv - clamp(ruv, 0.0, 1.0));
    // A real surface never mirrors cleanly: blur with the local ripple roughness and distance, and smear the
    // image vertically (wave slopes stretch reflections toward the viewer), so it breaks up instead of copying.
    float rough = clamp(length(detail) * 2.4 + length(rip) * 0.08 + paws * 0.35 + dist * 0.012, 0.0, 1.0);
    float lod = 0.6 + rough * 3.2;
    vec2 st = vec2(0.0, 0.006 + 0.028 * rough) * (0.6 + 0.8 * abs(N.x + N.z));
    vec2 c0 = clamp(ruv, 0.001, 0.999);
    vec3 rs = textureLod(tRefl, c0, lod).rgb * 0.36
            + textureLod(tRefl, clamp(ruv + st, 0.001, 0.999), lod + 0.4).rgb * 0.2 + textureLod(tRefl, clamp(ruv - st, 0.001, 0.999), lod + 0.4).rgb * 0.2
            + textureLod(tRefl, clamp(ruv + st * 2.3, 0.001, 0.999), lod + 0.9).rgb * 0.12 + textureLod(tRefl, clamp(ruv - st * 2.3, 0.001, 0.999), lod + 0.9).rgb * 0.12;
    vec3 refl = mix(rs, sky(reflect(-V, N)), smoothstep(0.03, 0.12, outR));

    // Refraction. Apparent displacement grows with the depth of what is seen (a koi 7 cm down barely wobbles, the
    // floor a metre down swims), but a per-pixel depth factor jumps at every koi outline, tears the image there and
    // traces a translucent, stair-stepped second outline of the fish. So the depth factor is averaged over a small ring
    // of taps: it still falls to almost nothing over a shallow koi, yet changes smoothly across its edge, and one
    // single, continuous lookup is used - never a blend of two differently displaced images.
    float wz = -vViewPos.z;
    float z0 = linDepth(suv);
    float kd = clamp((z0 - wz) * 1.6, 0.0, 1.0) * 2.0;
    vec2 rr = uInvRes * (4.0 + 12.0 / max(wz, 0.5));
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      kd += clamp((linDepth(suv + vec2(cos(a), sin(a)) * rr) - wz) * 1.6, 0.0, 1.0);
    }
    kd /= 10.0;
    vec2 roff = nV.xy * uRefrStr * kd * smoothstep(0.0, 0.45, -sdM) / (1.0 + wz * 0.12);
    vec2 ruv2 = clamp(suv + roff, vec2(0.001), vec2(0.999));
    float z1 = linDepth(ruv2);
    float rej = 1.0 - smoothstep(wz - 0.005, wz + 0.02, z1);
    vec3 refr = mix(texture2D(tRefr, ruv2).rgb, texture2D(tRefr, suv).rgb, rej);
    z1 = mix(z1, z0, rej);
    float path = max(z1 - wz, 0.0) * dist / max(wz, 1e-3);     // metres of water along the view ray

    // Beer–Lambert: red is absorbed first -> clear teal in the shallows, blue-green in the deep
    vec3 T = exp(-(uAbsorb + uScatter) * path);
    refr = refr * T + uInscatter * (1.0 - T);

    // Foam / bright edge where the water column is under 5 cm
    float vdepth = max(z0 - wz, 0.0) * dist / max(wz, 1e-3) * max(V.y, 0.05);
    float fn = texture2D(tNormal, vWPos.xz * 2.7 + uTime * 0.03).r;
    float foam = (1.0 - smoothstep(0.0, 0.035, vdepth)) * smoothstep(0.5, 0.75, fn + 0.15);
    foam *= 1.0 - smoothstep(0.35, 0.8, -sdM);                  // only along the shore / piers, never on koi backs

    // Sun glint (GGX, roughness ~0.05 widened a little with distance), soft-shouldered so it blooms without clipping
    vec3 spec = sunGGX(N, V, uSunDir, 0.05 + dist * 0.002) * step(0.0, uSunDir.y);
    spec = spec / (1.0 + spec / uSpecMax);

    col = mix(refr, refl, F) + spec;
    col = mix(col, uFoamColor, foam * 0.14);
    if (uIce > 0.001) {
      // winter: ice sheets creep out from the banks (ragged edge), frosted and dusted with snow, crazed with cracks
      float n1 = texture2D(tNormal, vWPos.xz * 0.23).r, n2 = texture2D(tNormal, vWPos.xz * 1.9).g;
      float edge = sdM + 0.85 * uIce + (n1 - 0.5) * 0.7;
      float ice = smoothstep(0.0, 0.05, edge) * uIce;
      float crack = smoothstep(0.47, 0.5, abs(texture2D(tNormal, vWPos.xz * 0.9).b - 0.5) + 0.46) * 0.5;
      vec3 amb = uFogColor * 1.3 + uSunColor * 0.03;
      vec3 iceCol = mix(vec3(0.55, 0.64, 0.7), vec3(0.8, 0.86, 0.9), n2) * amb * (1.0 - crack);
      iceCol = mix(iceCol, vec3(0.9, 0.92, 0.96) * amb * 1.15, uSnowCover * smoothstep(0.35, 0.75, n1 + n2 * 0.5 + edge * 0.6));
      col = mix(col, iceCol + refl * 0.08, ice);
    }
    col = mix(col, uFogColor, (1.0 - exp(-dist * uFogDensity)));
  } else {
    // ================= BELOW THE SURFACE =================
    N = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.55));   // seen from below the fine ripples read softer
    vec3 I = -V;                                   // camera -> surface (pointing up)
    vec3 Nd = -N;                                  // normal facing the viewer
    vec3 Tr = refract(I, Nd, 1.333);               // water -> air
    vec4 rc = uReflMatrix * vec4(vWPos.x, uWaterY, vWPos.z, 1.0);
    vec2 ruv = clamp(rc.xy / rc.w - N.xz * uReflDistort, 0.001, 0.999);
    vec3 tir = mix(uInscatter * 0.6, textureLod(tRefl, ruv, 2.0).rgb, 0.55);   // soft mirrored darkness of the pond
    if (dot(Tr, Tr) < 1e-4) {
      col = tir;                                   // beyond the critical angle (~48.6°): total internal reflection
    } else {
      float cosT = max(dot(Tr, N), 0.0);
      float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
      // Snell's window: find what the refracted ray sees in the above-water render, fall back to the sky
      vec4 cp = uProj * viewMatrix * vec4(vWPos + Tr * 6.0, 1.0);
      vec2 wuv = cp.xy / cp.w * 0.5 + 0.5;
      vec3 above = sky(Tr);
      if (cp.w > 0.0) {
        float inW = smoothstep(0.0, 0.04, wuv.x) * smoothstep(1.0, 0.96, wuv.x) * smoothstep(0.0, 0.04, wuv.y) * smoothstep(1.0, 0.96, wuv.y);
        above = mix(above, (texture2D(tRefr, clamp(wuv, 0.001, 0.999)).rgb * 0.5 + texture2D(tRefr, clamp(wuv + vec2(0.004, 0.003), 0.001, 0.999)).rgb * 0.25 + texture2D(tRefr, clamp(wuv - vec2(0.004, 0.003), 0.001, 0.999)).rgb * 0.25), inW);
      }
      float sd = max(dot(Tr, uSunDir), 0.0);
      above += uSunColor * (pow(sd, 1500.0) * 40.0 + pow(sd, 60.0) * 0.6);
      col = mix(above, tir, F);
    }
    // absorption + in-scattering along the path from the camera to the surface
    vec3 T = exp(-(uAbsorb + uScatter) * dist);
    col = col * T + uInscatter * (1.0 - T);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function updateWaves() {
  const base = P.windDir * DEG, offs = [0, 0.45, -0.5, 0.95], Ls = [2.9, 1.6, 0.85, 0.42], As = [0.016, 0.011, 0.007, 0.004];
  const w = (0.3 + P.windSpeed * 1.4) * P.waveHeight;
  for (let i = 0; i < 4; i++) WAVES[i].set(Math.cos(base + offs[i]), Math.sin(base + offs[i]), Ls[i], As[i] * w);
  SH.uWindDir.value.set(Math.cos(base), Math.sin(base));
  SH.uWind.value = P.windSpeed;
}
// CPU mirror of the Gerstner heights (for camera crossing, floating lily pads)
export function waterHeightAt(x, z, t) {
  let h = WATER_Y;
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.z, c = Math.sqrt(9.81 / k), l = Math.hypot(w.x, w.y);
    h += w.w * Math.sin(k * ((w.x / l) * x + (w.y / l) * z - c * t));
  }
  return h;
}
export function updateClarity() {
  const c = P.waterClarity;
  SH.uAbsorb.value.set(0.35, 0.08, 0.04).multiplyScalar(1 / c);
  SH.uScatter.value = 0.035 / c;
}

export function buildWater() {
  // pond mask (signed distance) for the sim and the surface clip
  const N = SIM.N, md = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = SIM.x0 + (i + 0.5) / N * SIM.size, z = SIM.z0 + (j + 0.5) / N * SIM.size;
    const v = clamp((sdf(x, z) + 2) / 4, 0, 1) * 255, k = (j * N + i) * 4;
    md[k] = md[k + 1] = md[k + 2] = v; md[k + 3] = 255;
  }
  const mask = new THREE.DataTexture(md, N, N); mask.magFilter = mask.minFilter = THREE.LinearFilter; mask.needsUpdate = true;
  RIPPLE_STATE.maskTex = mask;

  const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
  const sA = new THREE.WebGLRenderTarget(N, N, rtOpts); const sB = new THREE.WebGLRenderTarget(N, N, rtOpts);
  RIPPLE_STATE.simA = sA; RIPPLE_STATE.simB = sB;
  const drops = []; for (let i = 0; i < 16; i++) drops.push(new THREE.Vector4());
  const sPass = shaderPass(SIM_FS, {
    tPrev: { value: null }, tMask: { value: mask }, uTexel: { value: new THREE.Vector2(1 / N, 1 / N) },
    uDrops: { value: drops }, uNumDrops: { value: 0 }, uPads: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, uNumPads: { value: 0 }, uSim: { value: new THREE.Vector4(SIM.x0, SIM.z0, SIM.size, 0) },
  });
  RIPPLE_STATE.simPass = sPass;
  renderer.setRenderTarget(sA); renderer.clear(); renderer.setRenderTarget(sB); renderer.clear(); renderer.setRenderTarget(null);

  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const [x, z] of POLY) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const m = 0.4, W = maxX - minX + 2 * m, D = maxZ - minZ + 2 * m;
  const geo = new THREE.PlaneGeometry(W, D, 256, 256); geo.rotateX(-Math.PI / 2);
  waterMat = RIPPLE_STATE.waterMat = new THREE.ShaderMaterial({
    name: 'Water', vertexShader: WATER_VS, fragmentShader: WATER_FS, side: THREE.DoubleSide,
    uniforms: {
      uTime: SH.uTime, uWaterY: SH.uWaterY, uUnder: { value: 0 }, uNear: { value: camera.near }, uFar: { value: camera.far },
      uReflDistort: { value: 0.035 }, uRefrStr: { value: 0.04 }, uDetail: { value: 0.32 }, uSpecMax: { value: 14 },
      uInvRes: { value: new THREE.Vector2() }, uWind: SH.uWindDir, uGustW: { value: 0.5 }, uSunDir: SH.uSunDir, uSunColor: SH.uSunColor,
      uAbsorb: SH.uAbsorb, uScatter: SH.uScatter, uInscatter: SH.uInscatter, uFoamColor: { value: new THREE.Color() },
      tRefl: { value: null }, tRefr: { value: null }, tRefrDepth: { value: null }, tNormal: { value: TEX.waterNormal },
      tRipple: { value: sA.texture }, tMask: { value: mask }, tSky: { value: cubeRT.texture },
      uReflMatrix: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
      uWaves: { value: WAVES }, uSteep: { value: 0.8 }, uRain: SH.uRain, uIce: SH.uIce, uSnowCover: SH.uSnowCover, uFogDensity: SH.uFogDensity, uFogColor: SH.uFogColor, uSim: { value: new THREE.Vector4(SIM.x0, SIM.z0, SIM.size, 1 / N) },
    },
  });
  SH.uWavesS.value = WAVES; SH.uSimS.value.set(SIM.x0, SIM.z0, SIM.size, 1 / N); SH.tRippleS.value = sA.texture;
  water = RIPPLE_STATE.water = new THREE.Mesh(geo, waterMat);
  water.position.set((minX + maxX) / 2, WATER_Y, (minZ + maxZ) / 2);
  water.frustumCulled = false;
  setLayer(water, LAYER.WATER); scene.add(water);
}

