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
import { KOI_N, KOI_STYLES, KOI_ROSTER_DEF, KOI_ROSTER } from "./koiRoster";
import { KOI_TOP, KOI_BOT, KOI_W, KOI_EYE, crInterp, koiSection } from "./koiGeometry";

export function koiPatternAtlas() {
  const W = 256, H = 128, data = new Uint8Array(W * H * KOI_N * 4);
  for (let f = 0; f < KOI_N; f++) {
    const st = KOI_STYLES[KOI_ROSTER[f]], seed = 101 + f * 37;
    // coarse noise evaluated on a small grid and bilinearly upsampled (patterns are low frequency)
    const GW = 97, GH = 49, n1 = new Float32Array(GW * GH), n2 = new Float32Array(GW * GH), n3 = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const s = i / (GW - 1), th = (j / (GH - 1)) * Math.PI * 2, cy = Math.cos(th) * 1.25, sy = Math.sin(th) * 1.25;
      n1[j * GW + i] = fbm3(s * 4.2 + seed * 0.13, cy * 0.75, sy * 0.62, 4, seed);   // broad patches that wrap over the back
      n2[j * GW + i] = fbm3(s * 8.5, cy * 2.1 + seed * 0.07, sy * 2.1, 4, seed + 5);
      n3[j * GW + i] = fbm3(s * 16, cy * 3.5, sy * 3.5 + seed * 0.05, 2, seed + 9);
    }
    const samp = (arr, s, v) => { const x = s * (GW - 1), y = v * (GH - 1), i = Math.min(GW - 2, Math.floor(x)), j = Math.min(GH - 2, Math.floor(y)), u = x - i, w = y - j;
      return lerp(lerp(arr[j * GW + i], arr[j * GW + i + 1], u), lerp(arr[(j + 1) * GW + i], arr[(j + 1) * GW + i + 1], u), w); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (x + 0.5) / W, v = (y + 0.5) / H, th = v * Math.PI * 2, dors = Math.cos(th);
      const a1 = samp(n1, s, v), a2 = samp(n2, s, v), a3 = samp(n3, s, v);
      const top = smoothstep(-0.42, 0.1, dors);
      let hi = 0, sumi = 0;
      if (st.hiCover > 0) {
        let fld = a1 + (st.hiCover - 0.5) * 0.55;
        if (st.steps) {                                   // 2-4 separate patches along the back with white 'windows' between
          const nS = st.steps + Math.floor(hash3i(f, 7, 1, 3) * 1.99) - 0.5, ph = hash3i(f, 8, 1, 3) * 0.6;
          fld = fld * 0.7 + 0.2 * Math.cos(((s - 0.1) / 0.8) * Math.PI * 2 * nS * 0.5 * 2 + ph) + 0.05 * (1 - smoothstep(0.08, 0.2, s));
        }
        hi = 0.5 + fld * 4.2;
        hi = lerp(-0.4, hi, top) * smoothstep(0.035, 0.085, s) * (1 - 0.8 * smoothstep(0.92, 1.0, s));   // clean white nose, fading at the peduncle
      }
      if (st.tancho) { const d = Math.hypot((s - 0.115) * 1.0, Math.acos(clamp(dors, -1, 1)) * 0.07 * 0.85); hi = 0.5 + (0.042 - d) / 0.01; }
      if (st.asagi) hi = 0.5 + (-dors - 0.25 + a1 * 0.35) * 3.2 + (s < 0.2 ? (0.2 - s) * 8 * smoothstep(0.6, -0.2, dors) : 0);
      if (st.sumiCover > 0) {
        const showa = !!st.utsuri;
        const zone = showa ? smoothstep(-0.7, -0.1, dors) : smoothstep(0.05, 0.45, dors) * smoothstep(0.2, 0.3, s);
        sumi = (0.5 + (a2 + (st.sumiCover - 0.5) * 0.6) * 4.5) * zone;
        if (showa) sumi = Math.max(sumi, (0.5 + (0.09 - Math.abs(s - 0.12 + 0.03 * dors)) / 0.02) * smoothstep(0.1, 0.5, dors) * 0.9); // menware stripe on the head
      }
      const belly = smoothstep(-0.3, -0.85, dors);
      const k = ((f * H + y) * W + x) * 4;
      data[k] = clamp(hi, 0, 1) * 255; data[k + 1] = clamp(sumi, 0, 1) * 255; data[k + 2] = clamp(0.5 + a3 * 0.9, 0, 1) * 255; data[k + 3] = belly * 255;
    }
  }
  const t = new THREE.DataTexture(data, W, H * KOI_N); t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
// Overlapping cycloid scales. RG = normal xy, B = per-scale random id, A = exposed-rim mask.
export function koiScaleTexture() {
  const N = 512, cols = 8, rows = 8, H = new Float32Array(N * N), ID = new Float32Array(N * N), RIM = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = (x / N) * cols, fy = (y / N) * rows;
    let bestC = 1e9, h = 0, id = 0, rim = 0;
    for (let r = Math.floor(fy) - 1; r <= Math.floor(fy) + 1; r++) {
      const off = (((r % 2) + 2) % 2) * 0.5;
      for (let c = Math.floor(fx - off) - 1; c <= Math.floor(fx - off) + 1; c++) {
        const cx = c + off + 0.5, cy = r + 0.5, dx = (fx - cx) / 0.95, dy = (fy - cy) / 0.78, d = Math.hypot(dx, dy);
        if (d < 1 && cx < bestC) {                         // the most anterior covering scale is on top
          bestC = cx;
          const wc = ((c % cols) + cols) % cols, wr = ((r % rows) + rows) % rows;
          id = hash3i(wc, wr, 5, 9);
          const post = smoothstep(-0.3, 0.9, dx);          // exposed posterior field lifts toward the free edge
          h = 0.25 + 0.6 * post - 0.55 * smoothstep(0.86, 1.0, d) + 0.025 * Math.sin(d * 34) * post + (id - 0.5) * 0.12 * dy;
          rim = smoothstep(0.62, 0.97, d) * smoothstep(-0.2, 0.35, dx);
        }
      }
    }
    H[y * N + x] = h; ID[y * N + x] = id; RIM[y * N + x] = rim;
  }
  const nrm = heightToNormal(H, N, N, 5.5);
  for (let i = 0; i < N * N; i++) { nrm[i * 4 + 2] = ID[i] * 255; nrm[i * 4 + 3] = RIM[i] * 255; }
  return dataTex(nrm, N, N, false);
}
// Fin membrane: R = membrane density, G = ray mask, A = opacity (ragged, thinner at the edge)
export function koiFinTexture() {
  const W = 512, Hh = 256, cv = makeCanvas(W, Hh), g = cv.getContext('2d');
  const img = g.createImageData(W, Hh), d = img.data;
  const nRays = 22;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / Hh;
    // rays fan out and fork two-thirds of the way to the edge; segmented joints
    let ray = 0;
    const k = v * nRays, base = Math.abs((k % 1) - 0.5);
    const fork = smoothstep(0.55, 0.75, u) * 0.22;
    const dr = Math.min(Math.abs(base - fork), Math.abs(base + fork));
    ray = (1 - smoothstep(0.035, 0.09 * (1 - u * 0.5), dr)) * (0.75 + 0.25 * Math.sin(u * 90 + Math.floor(k) * 1.7) ** 2);
    const mem = 0.42 + 0.18 * fbm2P(u * 6, v * 12, 6, 3, 7) - 0.2 * u;
    const fray = u > 0.86 ? smoothstep(1.0, 0.86, u + 0.06 * (hash3i(y >> 2, 1, 1, 3) - 0.5) + 0.05 * Math.sin(v * 140)) : 1;
    const a = clamp((mem * 1.2 + ray * 0.8) * fray, 0, 1);            // milky membrane, opaque white rays
    const i = (y * W + x) * 4;
    d[i] = clamp(mem, 0, 1) * 255; d[i + 1] = ray * 255; d[i + 2] = 255; d[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTex(cv, false);
}
export function koiEyeTexture() {
  const cv = makeCanvas(256, 128), g = cv.getContext('2d');
  // v = 0 (top rows) is the outward pole: pupil, then golden iris ring, then dark sclera
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#020202'); grd.addColorStop(0.19, '#040404'); grd.addColorStop(0.205, '#3a2a10'); grd.addColorStop(0.24, '#d8a93a');
  grd.addColorStop(0.3, '#f1d27a'); grd.addColorStop(0.36, '#b98a2c'); grd.addColorStop(0.4, '#2a2016'); grd.addColorStop(0.55, '#1a1512'); grd.addColorStop(1, '#0d0b0a');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 128);
  g.globalAlpha = 0.35;
  for (let i = 0; i < 90; i++) { const x = Math.random() * 256; g.strokeStyle = Math.random() < 0.5 ? '#6b4a18' : '#fff0b0'; g.beginPath(); g.moveTo(x, 26); g.lineTo(x + (Math.random() - 0.5) * 3, 48); g.stroke(); }
  return canvasTex(cv, true);
}

export const KOI_VS_PARS = /* glsl */`
attribute vec4 aSwim;      // tail phase, tail amplitude, turn bend, fish index
attribute vec4 aSwim2;     // pectoral phase L, pectoral phase R, girth, fin spread
attribute vec4 aSwim3;     // mouth open, gill phase, eye yaw, eye pitch
varying vec2 vBodyUv;
varying float vFishIdx;
varying float vMouthIn;
varying float vFinEdge;
varying float vFinType;
// lateral spine offset: travelling wave whose amplitude grows toward the tail + C-bend curvature in turns
float koiA(float s){ return aSwim.y * (0.05 + 0.95 * s * s); }
float koiLat(float s){ return koiA(s) * sin(s * 5.7 - aSwim.x) + aSwim.z * (s - 0.3) * (s - 0.3); }
float koiLatD(float s){
  float A = koiA(s), dA = aSwim.y * 1.9 * s;
  return dA * sin(s * 5.7 - aSwim.x) + A * 5.7 * cos(s * 5.7 - aSwim.x) + 2.0 * aSwim.z * (s - 0.3);
}
vec3 rotY(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
vec3 rotX(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
vec3 rotZ(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }
#ifdef KOI_BODY
  attribute float aLip;
#endif
#ifdef KOI_FIN
  attribute vec4 aFin;
  attribute vec3 aPivot;
  uniform float uDorsalFold[${KOI_N}];
  uniform float uFinLong[${KOI_N}];     // butterfly (hirenaga) koi: long, flowing fins
#endif
#ifdef KOI_EYE
  attribute vec3 aEyeC;
#endif
`;
export const KOI_VS_NORMAL = /* glsl */`
float kS = 0.5 - position.x;
#ifdef KOI_EYE
  kS = 0.5 - aEyeC.x;
  float eSide = sign(aEyeC.z);
  objectNormal = rotX(rotY(objectNormal, aSwim3.z * eSide), aSwim3.w * eSide);
#endif
float kSlope = -koiLatD(kS);
objectNormal = normalize(vec3(objectNormal.x - kSlope * objectNormal.z, objectNormal.y, objectNormal.z));
vBodyUv = uv; vFishIdx = aSwim.w; vMouthIn = 0.0; vFinEdge = 0.0; vFinType = -1.0;
#ifdef KOI_BODY
  vMouthIn = step(1.5, aLip);
#endif
#ifdef KOI_FIN
  vFinEdge = aFin.y; vFinType = aFin.x;
#endif
`;
export const KOI_VS_BEGIN = /* glsl */`
{
  vec3 p = transformed;
  #ifdef KOI_BODY
    float s0 = 0.5 - position.x, open = aSwim3.x;
    if (aLip > 0.25) {                      // protrusible mouth: the lips open into an 'O' and extend forward
      vec2 mc = vec2(-0.004, 0.0);
      if (aLip > 0.75) p.yz = mc + (p.yz - mc) * open;
      else p.yz = mc + (p.yz - mc) * (1.0 + 0.3 * open);          // lips roll outward
      p.x += 0.022 * open * (aLip > 0.75 ? 1.0 : 0.6);
    }
    float gill = exp(-pow((s0 - 0.19) / 0.03, 2.0)) * step(p.y, 0.035);
    p.yz *= 1.0 + gill * 0.03 * (0.5 + 0.5 * sin(aSwim3.y));        // gill covers breathe
    float gm = smoothstep(0.08, 0.35, s0) * (1.0 - smoothstep(0.72, 1.0, s0));
    p.yz *= mix(1.0, aSwim2.z, gm);                                   // girth varies fish to fish
  #endif
  #ifdef KOI_EYE
    float es = sign(aEyeC.z);
    p = aEyeC + rotX(rotY(p - aEyeC, aSwim3.z * es), aSwim3.w * es);  // eyes swivel in their sockets
  #endif
  #ifdef KOI_FIN
    vec3 q = p - aPivot;
    float t = aFin.x, fl = uFinLong[int(aSwim.w + 0.5)], fu = aFin.y;
    if (t > 0.5 && t < 4.5) q *= 1.0 + fl * (t < 2.5 ? 0.95 : 0.8) * fu;             // long flowing paired fins
    else if (t > 5.5) { q.x *= 1.0 + fl * 1.0 * fu; q.y *= 1.0 + fl * 0.4 * fu; }      // long veil tail
    else if (t < 0.5) { q.y += fl * 0.05 * fu; q.x -= fl * 0.035 * fu * (0.4 + aFin.z * 0.3 + 0.3); }
    else { q.y -= fl * 0.035 * fu; q.x -= fl * 0.03 * fu; }
    if (t > 0.5 && t < 4.5) {                                         // paired fins: fold back when fast, flare and scull when slow
      float side = (t < 1.5 || (t > 2.5 && t < 3.5)) ? 1.0 : -1.0;
      bool pect = t < 2.5;
      float ph = side > 0.0 ? aSwim2.x : aSwim2.y;
      float spread = aSwim2.w;
      q = rotY(q, -side * (1.0 - spread) * (pect ? 1.05 : 0.6));
      float flap = side * ((0.32 * sin(ph) * (0.35 + 0.65 * spread)) - 0.12) * (0.35 + 0.65 * aFin.y);
      q = rotX(q, flap);
      q.y += sin(ph * 1.3 + aFin.z * 2.5) * (0.004 + fl * 0.012 * fu) * aFin.y;          // membrane ripple (long fins billow)
    } else if (t > 5.5) {                                             // caudal: secondary wave lags the body
      q.z += sin(aSwim.x - 1.1 - aFin.y * 2.4) * (aSwim.y * 0.45 + 0.004) * aFin.y;
      q.z += sin(aSwim.x * 0.5 + aFin.z * 3.0) * 0.004 * aFin.y;
      q.z += sin(aSwim.x - 1.8 - fu * 3.2) * fl * (aSwim.y * 0.5 + 0.012) * fu * fu;          // veil tail trails and billows
    } else {                                                          // dorsal / anal flutter
      q.z += sin(aSwim.x * 0.9 - aFin.z * 5.0) * 0.007 * aFin.y;
      if (t < 0.5) { float fold = uDorsalFold[int(aSwim.w + 0.5)]; q.x -= aFin.y * 0.075 * fold; q.y -= aFin.y * 0.062 * fold; }   // laid flat when stroked
    }
    p = aPivot + q;
  #endif
  p.z += koiLat(0.5 - p.x);
  transformed = p;
}
`;
export const KOI_FS_PARS = /* glsl */`
uniform sampler2D tPattern;
// per-fish palette rows: 0 base, 1 hi, 2 sumi, 3 belly, 4 fin, 5 fin base, 6 (metallic, reticulation, iridescence, motoguro),
// 7 (doitsu, gin rin, hajiro, long fins)
uniform sampler2D tPal;
#define KOI_NF ${KOI_N}.0
vec4 kPal(float fi, float k){ return texture2D(tPal, vec2((k + 0.5) / 8.0, (fi + 0.5) / KOI_NF)); }
varying vec2 vBodyUv;
varying float vFishIdx;
varying float vMouthIn;
varying float vFinEdge;
varying float vFinType;
`;
// Skin: pattern fields -> crisp colour edges scalloped by individual scales, sumi granular per scale,
// pearly white with faint scale pockets, reticulation for Asagi / Chagoi, head details, mouth interior.
export const KOI_BODY_MAP = /* glsl */`
int fi = int(vFishIdx + 0.5);
float fiF = floor(vFishIdx + 0.5);
vec4 kInfo = kPal(fiF, 6.0), kInfo2 = kPal(fiF, 7.0);
float bs = vBodyUv.x, bth = vBodyUv.y * 6.2831853, cth = cos(bth), sth = sin(bth);
float pv = (vFishIdx + 0.01 + vBodyUv.y * 0.98) / KOI_NF;
vec4 pf = texture2D(tPattern, vec2(bs, pv));
vec4 sc = texture2D(normalMap, vNormalMapUv);
float scaleOn = smoothstep(0.19, 0.25, bs) * (1.0 - smoothstep(0.975, 1.0, bs));
// Doitsu: scaleless leather skin, with a row of large mirror scales either side of the dorsal ridge and along the lateral line
float doitsu = kInfo2.x;
if (doitsu > 0.5) {
  vec4 scB = texture2D(normalMap, vNormalMapUv * vec2(0.5, 0.5) + vec2(0.13, 0.0));
  float row = smoothstep(0.03, 0.09, abs(sth)) * (1.0 - smoothstep(0.55, 0.66, abs(sth))) * step(0.0, cth)
            + (1.0 - smoothstep(0.1, 0.18, abs(cth + 0.04)));
  sc = scB; scaleOn *= clamp(row, 0.0, 1.0) * smoothstep(0.24, 0.3, bs) * (1.0 - smoothstep(0.86, 0.94, bs));
}
float rim = sc.a * scaleOn, sid = sc.b;
float mirror = doitsu * scaleOn;                                   // doitsu mirror scales: large, glassy, clearly outlined
float scal = (sc.a - 0.35) * 0.14 * scaleOn;
// hi edges: crisp and scalloped scale by scale at the back of a patch (kiwa); soft and blurred at the front (sashi),
// where the translucent white scales in front overlap the red ones behind
float grd = texture2D(tPattern, vec2(bs + 0.012, pv)).r - pf.r;
float sashi = smoothstep(0.03, 0.2, grd) * scaleOn;
float fwh = max(fwidth(pf.r) * 1.3, 0.018), fws = max(fwidth(pf.g) * 1.3, 0.018);
float fwhS = mix(fwh, 0.13, sashi);
float hi = smoothstep(0.5 - fwhS, 0.5 + fwhS * (1.0 - 0.4 * sashi), pf.r + scal * (1.0 - sashi) + (sid - 0.5) * 0.1 * sashi);
float su = smoothstep(0.5 - fws, 0.5 + fws, pf.g + scal * 0.5 + (sid - 0.5) * 0.35 * scaleOn);   // sumi sits scale by scale
vec3 base = kPal(fiF, 0.0).rgb * (0.95 + 0.1 * pf.b);
vec3 col = mix(base, kPal(fiF, 3.0).rgb, pf.a * 0.8);
vec3 hiC = kPal(fiF, 1.0).rgb * (0.84 + 0.3 * pf.b) * (0.92 + 0.1 * sid);
hiC = mix(hiC, hiC * vec3(1.02, 1.12, 1.1) + 0.04, sashi * (1.0 - hi) * 0.8);      // pinkish veil where sashi fades out
col = mix(col, hiC, hi);
col = mix(col, kPal(fiF, 2.0).rgb * (0.8 + 0.4 * sid), su);
float ret = kInfo.y;
col *= 1.0 + rim * ret * 0.55;                                   // reticulated scale edges (Asagi, Chagoi, Kujaku net...)
col *= 1.0 - (1.0 - sc.a) * (0.08 + 0.04 * hi) * scaleOn;        // scale pockets, a touch deeper in the red
col *= 1.0 + rim * hi * 0.06;                                     // each red scale catches light on its free edge
col = mix(col, col * vec3(0.9, 0.95, 1.03), (1.0 - sc.a) * 0.45 * scaleOn * (1.0 - hi) * (1.0 - su));   // pearly, faintly blue in the pockets
col *= 1.0 - mirror * (0.16 * (1.0 - smoothstep(0.55, 0.9, sc.a)) * smoothstep(0.2, 0.5, sc.a) + 0.05);
// lateral line: a fine dashed row of pored scales along each flank
float lat = (1.0 - smoothstep(0.0, 0.03, abs(cth + 0.06))) * scaleOn * (1.0 - doitsu);
col *= 1.0 - 0.14 * lat * smoothstep(0.35, 0.8, sc.a);
// Gin Rin: reflective guanine deposits make individual scales flash like sequins
float gin = kInfo2.y * scaleOn * smoothstep(0.58, 0.66, sid) * (1.0 - smoothstep(0.1, 0.45, sc.a)) * smoothstep(-0.6, 0.2, cth);   // the scale's face, not its rim
col = mix(col, max(col, vec3(0.8)), gin * 0.05);
// head: lips, nostrils, gill slit
float lipM = 1.0 - smoothstep(0.0, 0.035, bs);
col = mix(col, col * vec3(1.0, 0.86, 0.82), lipM * (1.0 - hi) * 0.6);
float nos = min(length(vec2((bs - 0.048) / 0.0065, (bth - 0.62) / 0.07)), length(vec2((bs - 0.048) / 0.0065, (bth - 5.66) / 0.07)));
col *= 1.0 - 0.55 * (1.0 - smoothstep(0.6, 1.0, nos)) + 0.12 * (1.0 - smoothstep(1.0, 1.5, nos)) * smoothstep(0.9, 1.0, nos);
float gl = bs - (0.212 - 0.016 * cth);
col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.0025 + fwidth(bs), abs(gl))) * smoothstep(0.7, 0.2, cth);
col = mix(col, vec3(0.42, 0.14, 0.13), vMouthIn);               // pink-red mouth interior
diffuseColor.rgb = col;
`;
export const KOI_BODY_NORMAL = /* glsl */`
{
  vec2 nxy = (sc.xy * 2.0 - 1.0) * normalScale * scaleOn;
  vec3 mapN = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
  normal = normalize(tbn * mapN);
}
`;
export const KOI_GIN_POST = /* glsl */`
{
  vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  // Gin Rin: each crystal-bearing scale is a tiny tilted mirror, so individual scales flash as the fish turns
  if (gin > 0.0) {
    vec3 nG = normalize(geometryNormal + (vec3(sid, fract(sid * 7.13), fract(sid * 3.71)) - 0.5) * 0.7);   // one flat, randomly tilted mirror per scale
    float gl = pow(max(dot(nG, normalize(Lv + normalize(vViewPosition))), 0.0), 48.0) * (0.3 + 0.7 * fract(sid * 13.7));
    reflectedLight.directSpecular += directLight.color * gin * (0.015 + 4.0 * gl) * mix(vec3(1.0), diffuseColor.rgb + 0.4, 0.4);
    reflectedLight.indirectSpecular += gin * 0.06 * mix(vec3(1.0), diffuseColor.rgb, 0.3);
  }

}
`;
export const KOI_BODY_POST = /* glsl */`
{
  // wrap / subsurface: light bleeds past the terminator, warmer through red patches
  vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float nl = dot(geometryNormal, Lv);
  float wrapL = max(0.0, (nl + 0.55) / 1.55) - max(0.0, nl);
  reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * wrapL * 0.4 * vec3(1.0, 0.7, 0.6);
}
`;
export const KOI_FIN_MAP = /* glsl */`
float fiF = floor(vFishIdx + 0.5);
vec4 kInfo = kPal(fiF, 6.0), kInfo2 = kPal(fiF, 7.0);
vec4 ft = texture2D(map, vMapUv);
float mainFin = (vFinType > 0.5 && vFinType < 2.5) || vFinType > 5.5 ? 1.0 : 0.35;
// orange / black streaks radiate along the rays from the fin base (strongest on pectorals and tail)
float streak = ft.g * (1.0 - smoothstep(0.08, 0.55 + kInfo2.w * 0.15, vFinEdge)) * mainFin * kInfo.w;
vec3 fc = mix(kPal(fiF, 4.0).rgb, kPal(fiF, 5.0).rgb, streak);
fc = mix(fc, vec3(0.93, 0.92, 0.9), kInfo2.z * smoothstep(0.55, 0.9, vFinEdge) * mainFin);   // hajiro: white fin tips
fc = mix(fc * vec3(0.9, 0.94, 0.97), min(fc * 1.08 + 0.04, vec3(1.0)), ft.g);
diffuseColor.rgb = fc;
diffuseColor.a = opacity * ft.a * (1.0 - kInfo2.w * 0.3 * smoothstep(0.45, 1.0, vFinEdge));    // long fins thin to a gauze
`;

