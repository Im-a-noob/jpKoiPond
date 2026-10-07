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
import { addDrop } from "./water";
import { splashAt, bubbleBurst } from "./bubbles";
import { POLY_LEN, shoreAt, addMossShells } from "./terrain";
import { rockMaterial } from "./materials";
import { cubeRT, skyUniforms } from "./lighting";
import { spawnSplash } from "./bubbles";

// A small two-tier cascade on the upper-left bank (as in classic Japanese stroll gardens): a spring pool on a mossy
// mound, a first lip stone into a middle basin, a second lip into the pond. Local frame: a = into the pond, b = along shore.
export const WF = { site: null, sheets: [], pools: [], impacts: [] };
export function setupWaterfallSite() {
  let best = null, bd = 1e9;
  for (let s = 0; s < POLY_LEN; s += 0.04) { const sh = shoreAt(s); const d = Math.hypot(sh.x + 3.25, sh.z + 2.05); if (d < bd) { bd = d; best = sh; } }
  WF.site = best;
}
export function wfMound(x, z) {
  const S = WF.site; if (!S) return 0;
  const cx = S.x + S.nx * 2.0, cz = S.z + S.nz * 2.0, d = Math.hypot(x - cx, z - cz);   // peak rises behind the spring pool
  return 0.8 * Math.exp(-((d / 1.3) ** 2));
}
export function wfWorld(a, b, y) { const S = WF.site; return new THREE.Vector3(S.x - S.nx * a + S.tx * b, y, S.z - S.nz * a + S.tz * b); }
export function nearWaterfall(x, z, r) { const S = WF.site; return S && Math.hypot(x - S.x, z - S.z) < r; }

export const FALL_VS = /* glsl */`
varying vec2 vUv;
varying vec3 vWPos;
varying vec3 vN;
void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`;
export const FALL_FS = /* glsl */`
// === FALLING WATER SHEET: fast streaks scrolling down the sheet, ragged translucent edges, white water at the
//     lip and the impact, sky reflection by Fresnel and sparkling sun highlights
uniform float uTime;
uniform float uSpeed;
uniform float uSeed;
uniform sampler2D tNoise;
uniform samplerCube tSky;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
varying vec2 vUv;
varying vec3 vWPos;
varying vec3 vN;
void main(){
  float u = vUv.x, v = vUv.y, sp = uTime * uSpeed;
  // stretched noise = individual threads of falling water
  float s1 = texture2D(tNoise, vec2(u * 3.1 + uSeed, v * 0.35 - sp)).r;
  float s2 = texture2D(tNoise, vec2(u * 7.3 + uSeed * 2.0, v * 0.6 - sp * 1.4)).g;
  float s3 = texture2D(tNoise, vec2(u * 17.0 + uSeed * 3.0, v * 1.2 - sp * 2.0)).r;
  float strand = s1 * 0.45 + s2 * 0.35 + s3 * 0.2;
  float aer = smoothstep(0.06, 0.75, v);                                  // glassy at the lip, aerated lower down
  float edge = smoothstep(0.0, 0.14 + 0.1 * s2, u) * smoothstep(1.0, 0.86 - 0.1 * s1, u);
  float gaps = smoothstep(0.3 - 0.08 * aer, 0.52, strand + (1.0 - aer) * 0.3);   // the sheet tears into strands as it falls
  vec3 V = normalize(cameraPosition - vWPos), N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  N = normalize(N + vec3((s2 - 0.5) * 0.35, 0.0, (s3 - 0.5) * 0.35));
  float F = 0.04 + 0.96 * pow(1.0 - abs(dot(N, V)), 5.0);
  vec3 refl = textureCube(tSky, reflect(-V, N)).rgb;
  vec3 H = normalize(uSunDir + V);
  vec3 glass = mix(vec3(0.05, 0.085, 0.08) * uAmbient * 2.4, refl * 0.9, F) + uSunColor * pow(max(dot(N, H), 0.0), 140.0) * 0.9;
  vec3 white = vec3(0.93, 0.96, 0.96) * (uAmbient * 1.2 + uSunColor * 0.14) * (0.82 + 0.28 * s3);
  float whiteK = clamp(aer * (0.4 + 0.75 * smoothstep(0.45, 0.8, strand)) + smoothstep(0.86, 1.0, v) * 0.6 + (1.0 - smoothstep(0.0, 0.05, v)) * 0.45, 0.0, 1.0);
  vec3 col = mix(glass, white, whiteK);
  float alpha = mix(0.5, 0.93, whiteK) * gaps * edge;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}`;
export const POOLFOAM_FS = /* glsl */`
// === SMALL POOL / IMPACT FOAM: reflective dark water with churning foam rings around where the water lands
uniform float uTime;
uniform sampler2D tNoise;
uniform samplerCube tSky;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform float uFoamOnly;
uniform vec2 uImpact;      // impact point in uv space
varying vec2 vUv;
varying vec3 vWPos;
varying vec3 vN;
void main(){
  vec2 d = vUv - uImpact; float r = length(d);
  vec2 dir = d / max(r, 1e-3);
  // foam is carried outward from the plunge point and breaks up as it spreads (cartesian noise: no radial streaks)
  float n1 = texture2D(tNoise, (vUv - dir * fract(uTime * 0.12) * 0.25) * 4.0 + uTime * 0.02).r;
  float n2 = texture2D(tNoise, (vUv - dir * fract(uTime * 0.12 + 0.5) * 0.25) * 4.0 - uTime * 0.02 + 0.37).r;
  float bl = abs(fract(uTime * 0.12) - 0.5) * 2.0;
  float n3 = texture2D(tNoise, vUv * 10.0 - uTime * 0.06).g;
  float n = mix(n1, n2, bl) * 0.65 + n3 * 0.35;
  float core = 1.0 - smoothstep(0.0, 0.26, r);
  float foam = smoothstep(0.52, 0.74, n + core * 0.6) * (1.0 - smoothstep(0.16, 0.46, r));
  foam = max(foam, core * core * 0.9);
  float bub = smoothstep(0.84, 0.92, texture2D(tNoise, vUv * 26.0 + vec2(uTime * 0.11, -uTime * 0.07)).r) * (1.0 - smoothstep(0.15, 0.4, r));
  foam = clamp(foam + bub * 0.5, 0.0, 1.0);
  vec2 ripple = dir * sin(r * 70.0 - uTime * 11.0) * 0.03 * (1.0 - smoothstep(0.05, 0.5, r));
  vec3 N = normalize(vec3(ripple.x + (n - 0.5) * 0.15, 1.0, ripple.y));
  vec3 V = normalize(cameraPosition - vWPos);
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = mix(vec3(0.012, 0.03, 0.028) * uAmbient * 3.0, textureCube(tSky, reflect(-V, N)).rgb * 0.35, F);
  col = mix(col, vec3(0.9, 0.93, 0.93) * (uAmbient * 1.1 + uSunColor * 0.1), foam);
  float edgeA = 1.0 - smoothstep(0.42, 0.5, length(vUv - 0.5));
  float alpha = uFoamOnly > 0.5 ? foam * 0.6 * edgeA : edgeA;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}`;
export function buildWaterfall() {
  const S = WF.site;
  const rockM = rockMaterial(TEX.boulder, { key: 'wfrock', scale: 0.9, moss: 0.55, rough: 0.8, nrm: 1.4, tint: 0xa8a296 });
  const variants = [0, 1, 2, 3].map((i) => (i < 2 ? rockGeo(i * 5.3 + 11, 4, -0.35, 1) : rockGeo(i * 5.3 + 11, 5, -0.35, 0.45, false)));
  const lists = [[], [], [], []];
  const Q = new THREE.Quaternion(), E = new THREE.Euler(), yaw = Math.atan2(S.nz, -S.nx);
  const stone = (a, b, y, sx, sy, sz, rx = 0, rz = 0) => {
    const p = wfWorld(a, b, y); E.set(rx + rr(-0.05, 0.05), yaw + rr(-0.25, 0.25), rz + rr(-0.05, 0.05), 'YXZ'); Q.setFromEuler(E);
    lists[sy < 0.12 ? (rand() * 2) | 0 : 2 + ((rand() * 2) | 0)].push(new THREE.Matrix4().compose(p, Q, new THREE.Vector3(sx, sy, sz)));   // flat slabs only where water runs over them
  };
  // lower tier: lip slab, the face behind the sheet, flanking stones
  stone(-0.06, 0, 0.27, 0.27, 0.065, 0.3, 0, 0.08); stone(-0.2, 0, 0.08, 0.24, 0.26, 0.34);
  for (const sd of [1, -1]) { stone(-0.02, sd * 0.36, 0.1, 0.27, 0.3, 0.24); stone(-0.3, sd * 0.44, 0.22, 0.3, 0.36, 0.3); stone(0.12, sd * 0.52, 0.02, 0.22, 0.18, 0.2); }
  // middle basin floor and the upper tier
  stone(-0.32, 0, 0.19, 0.34, 0.1, 0.34); stone(-0.57, 0, 0.61, 0.21, 0.055, 0.24, 0, 0.06); stone(-0.7, 0, 0.4, 0.22, 0.3, 0.3);
  for (const sd of [1, -1]) { stone(-0.55, sd * 0.31, 0.5, 0.24, 0.34, 0.22); stone(-0.88, sd * 0.36, 0.6, 0.3, 0.34, 0.28); }
  // spring pool bed and the stones behind it
  stone(-0.97, 0, 0.55, 0.4, 0.1, 0.26); stone(-1.38, 0, 0.62, 0.36, 0.26, 0.42); stone(-1.15, 0.32, 0.72, 0.22, 0.2, 0.2); stone(-1.2, -0.3, 0.68, 0.25, 0.22, 0.2);
  for (let i = 0; i < 4; i++) { const wm = instanced(variants[i], rockM, lists[i], LAYER.BOTH); (WORLD.solids = WORLD.solids || []).push(wm); addMossShells(wm, 0.6, 6, 0.012); }
  // pools
  const poolMat = (foamOnly, impact) => new THREE.ShaderMaterial({ vertexShader: FALL_VS, fragmentShader: POOLFOAM_FS, transparent: true, depthWrite: !foamOnly,
    uniforms: { uTime: SH.uTime, tNoise: { value: TEX.waterNormal }, tSky: { value: cubeRT.texture }, uAmbient: { value: new THREE.Color() }, uSunColor: SH.uSunColor, uFoamOnly: { value: foamOnly ? 1 : 0 }, uImpact: { value: new THREE.Vector2(...impact) } } });
  const pool = (a0, a1, hw, y, impactA, foamOnly = false, layer = LAYER.ABOVE) => {
    const g = new THREE.CircleGeometry(0.5, 40); g.rotateX(-Math.PI / 2); g.scale(a1 - a0, 1, hw * 2);
    const m = new THREE.Mesh(g, poolMat(foamOnly, [0.5, 0.5 + (impactA - (a0 + a1) / 2) / (a1 - a0)]));
    const c = wfWorld((a0 + a1) / 2, 0, y); m.position.copy(c); m.rotation.y = yaw; m.renderOrder = 3;
    setLayer(m, layer); scene.add(m); WF.pools.push(m); return m;
  };
  pool(-1.2, -0.6, 0.17, 0.668, -0.9);
  pool(-0.48, -0.14, 0.17, 0.312, -0.45);
  pool(-0.25, 0.55, 0.42, WATER_Y + 0.004, 0.12, true, LAYER.SURFACE);          // impact foam on the pond
  // falling sheets (ballistic arcs), slightly bowed across their width
  const sheet = (aLip, yLip, yBase, width, vx) => {
    const T = Math.sqrt(2 * (yLip - yBase) / 9.81), nu = 10, nv = 16, pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const v = j / nv, u = i / nu, tt = v * T, bw = width * (1 + 0.25 * v) * (u - 0.5);
      const a = aLip + vx * tt + 0.012 * Math.sin(u * Math.PI), y = yLip - 0.5 * 9.81 * tt * tt;
      const p = wfWorld(a, bw, y); pos.push(p.x, p.y, p.z); uv.push(u, v);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const q = j * (nu + 1) + i; idx.push(q, q + nu + 1, q + 1, q + 1, q + nu + 1, q + nu + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: FALL_VS, fragmentShader: FALL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: SH.uTime, uSpeed: { value: 1.6 + rand() * 0.4 }, uSeed: { value: rand() }, tNoise: { value: TEX.waterNormal }, tSky: { value: cubeRT.texture }, uSunDir: SH.uSunDir, uSunColor: SH.uSunColor, uAmbient: { value: new THREE.Color() } } }));
    m.renderOrder = 4; setLayer(m, LAYER.ABOVE); scene.add(m); WF.sheets.push(m);
    WF.impacts.push({ p: wfWorld(aLip + vx * T, 0, yBase), pond: yBase < 0.05 });
  };
  sheet(-0.57, 0.672, 0.338, 0.17, 0.34);
  sheet(-0.03, 0.338, WATER_Y, 0.26, 0.45);
  WF.mistT = 0;
}
export function updateWaterfall(t, dt) {
  if (!WF.site) return;
  const amb = new THREE.Color().copy(SH.uSunColor.value).multiplyScalar(0.18).add(new THREE.Color(0.25, 0.28, 0.3).multiplyScalar(skyUniforms.uCloudBright.value * 0.6));
  for (const m of WF.sheets.concat(WF.pools)) m.material.uniforms.uAmbient.value.copy(amb);
  if (dt <= 0) return;
  // the lower fall keeps stirring the pond: ripples, a little mist
  const imp = WF.impacts[1];
  if (imp && rand() < 0.7) addDrop(imp.p.x + rr(-0.08, 0.08), imp.p.z + rr(-0.08, 0.08), 0.06, rr(-0.004, -0.0015));
  WF.mistT -= dt;
  if (WF.mistT < 0) { WF.mistT = 0.06; for (const I of WF.impacts) spawnSplash(I.p.x + rr(-0.06, 0.06), I.p.z + rr(-0.06, 0.06), I.pond ? 0.28 : 0.2, I.p.y, true); }
}

// Kasuga-style stone lanterns (tōrō): pedestal, post, platform, light box with openings, curved cap, jewel finial
