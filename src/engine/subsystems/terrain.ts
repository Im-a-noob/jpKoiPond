// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets } from "../geometry";
import { $, progress, toast } from "../state";
import { wfMound, nearWaterfall } from "./waterfallMesh";
import { rockMaterial, physical } from "./materials";
import { scene } from "./lighting";
import { TEX } from "./textures";
/* ------------------------------------------------------------------ POND SHAPE (closed Catmull-Rom spline + SDF) */
export const POND_CTRL = [[0.0, 6.0], [3.1, 4.6], [2.5, 1.2], [3.0, -1.8], [1.8, -3.6], [1.6, -5.6], [-1.2, -6.0], [-1.8, -3.5], [-3.5, -1.0], [-3.4, 3.4]];
const pondCurve = new THREE.CatmullRomCurve3(POND_CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.5);
export const NPOLY = 480;
export const POLY = pondCurve.getSpacedPoints(NPOLY).slice(0, NPOLY).map((v) => [v.x, v.z]);
export const POLY_CUM = [0];
for (let i = 0; i < NPOLY; i++) { const a = POLY[i], b = POLY[(i + 1) % NPOLY]; POLY_CUM.push(POLY_CUM[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
export const POLY_LEN = POLY_CUM[NPOLY];
let _area = 0;
for (let i = 0; i < NPOLY; i++) { const a = POLY[i], b = POLY[(i + 1) % NPOLY]; _area += a[0] * b[1] - b[0] * a[1]; }
export const POLY_CCW = _area > 0;
// Point on the shoreline at arc length s, with tangent and outward normal
export function shoreAt(s) {
  s = ((s % POLY_LEN) + POLY_LEN) % POLY_LEN;
  let lo = 0, hi = NPOLY;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (POLY_CUM[m] <= s) lo = m; else hi = m; }
  const a = POLY[lo], b = POLY[(lo + 1) % NPOLY], seg = POLY_CUM[lo + 1] - POLY_CUM[lo];
  const t = seg > 0 ? (s - POLY_CUM[lo]) / seg : 0;
  let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  const nx = POLY_CCW ? tz : -tz, nz = POLY_CCW ? -tx : tx;
  return { x: lerp(a[0], b[0], t), z: lerp(a[1], b[1], t), tx, tz, nx, nz, u: s / POLY_LEN };
}
export function sdfExact(x, z) {
  let best = 1e18, inside = false;
  for (let i = 0, j = NPOLY - 1; i < NPOLY; j = i++) {
    const ax = POLY[j][0], az = POLY[j][1], bx = POLY[i][0], bz = POLY[i][1];
    const ex = bx - ax, ez = bz - az, wx = x - ax, wz = z - az;
    const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1);
    const dx = wx - ex * t, dz = wz - ez * t, d = dx * dx + dz * dz;
    if (d < best) best = d;
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside ? -Math.sqrt(best) : Math.sqrt(best);
}
export const SDF = { x0: -11, z0: -13, cell: 0.1, nx: 221, nz: 261, d: null };
export function buildSDF() {
  SDF.d = new Float32Array(SDF.nx * SDF.nz);
  for (let j = 0; j < SDF.nz; j++) for (let i = 0; i < SDF.nx; i++) SDF.d[j * SDF.nx + i] = sdfExact(SDF.x0 + i * SDF.cell, SDF.z0 + j * SDF.cell);
}
export function sdf(x, z) {
  const fx = (x - SDF.x0) / SDF.cell, fz = (z - SDF.z0) / SDF.cell;
  if (fx < 0 || fz < 0 || fx >= SDF.nx - 1 || fz >= SDF.nz - 1) {
    const cx = clamp(fx, 0, SDF.nx - 1.001), cz = clamp(fz, 0, SDF.nz - 1.001);
    return sdf(SDF.x0 + cx * SDF.cell, SDF.z0 + cz * SDF.cell) + Math.hypot((fx - cx) * SDF.cell, (fz - cz) * SDF.cell);
  }
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, n = SDF.nx, d = SDF.d;
  return lerp(lerp(d[j * n + i], d[j * n + i + 1], u), lerp(d[(j + 1) * n + i], d[(j + 1) * n + i + 1], u), v);
}
export const PAVILION = { x: 0.3, z: -9.2, r: 1.9 };
export const BRIDGE = { z: -3.55, half: 2.75, width: 1.25 };
export function pondDepth(x, z, d) { return 0.3 + 0.9 * Math.pow(smoothstep(0.0, 2.1, d), 0.85) + 0.05 * fbm3(x * 0.8, 0.3, z * 0.8, 3, 5) * smoothstep(0, 0.5, d); }
export function groundHeight(x, z, s) {
  let h = lerp(0.085, 0.14, smoothstep(0.2, 0.9, s)) + 0.04 * fbm3(x * 0.6, 0, z * 0.6, 3, 9) * smoothstep(0.1, 0.6, s);
  h += 0.45 * smoothstep(0.9, 5.5, s) * (0.5 + 0.5 * fbm3(x * 0.16, 1, z * 0.16, 3, 21));   // soft garden mounds
  const r = Math.hypot(x * 0.9, z * 0.75);
  h += 4.0 * smoothstep(14, 45, r) * (0.55 + 0.45 * fbm3(x * 0.045, 2, z * 0.045, 3, 4)); // distant hills
  const dp = Math.hypot(x - PAVILION.x, z - PAVILION.z);
  h = lerp(0.24, h, smoothstep(PAVILION.r + 0.5, PAVILION.r + 2.2, dp));
  h += wfMound(x, z) * smoothstep(0.1, 0.55, s);                                         // waterfall mound                 // pavilion pad
  return h;
}
export function terrainHeight(x, z) { const s = sdf(x, z); return s < 0 ? -pondDepth(x, z, -s) : groundHeight(x, z, s); }

/* ------------------------------------------------------------------ 6. TERRAIN + BASIN */
export const WORLD = { noReflect: [], seasonal: [], leafMesh: {}, bloomMats: [] };
export function axisCoords(inner, ext, step) {
  const a = [0]; let x = 0, s = step;
  while (x < ext) { if (x > inner) s *= 1.075; x = Math.min(ext, x + s); a.push(x); }
  return a.slice(1).reverse().map((v) => -v).concat(a);
}
export function buildTerrain() {
  const xs = axisCoords(8.5, 90, 0.08), zs = axisCoords(12.5, 90, 0.08);
  const NX = xs.length, NZ = zs.length, NV = NX * NZ;
  const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3), uv = new Float32Array(NV * 2), col = new Float32Array(NV * 3);
  const S = new Float32Array(NV), Y = new Float32Array(NV);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, x = xs[i], z = zs[j], s = sdf(x, z);
    const y = s < 0 ? -pondDepth(x, z, -s) : groundHeight(x, z, s);
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; uv[k * 2] = x; uv[k * 2 + 1] = z; S[k] = s; Y[k] = y;
    if (s < 0.05) {
      // gravel darkens and greens toward the deep centre (algae, less light)
      const t = smoothstep(0.25, 1.15, -y), n = 0.95 + 0.14 * fbm3(x * 0.7, 5, z * 0.7, 3, 2);
      col[k * 3] = (1 - 0.32 * t) * n; col[k * 3 + 1] = (1 - 0.22 * t) * n; col[k * 3 + 2] = (1 - 0.26 * t) * n * 0.95;
    } else {
      const n = fbm3(x * 0.16, 7, z * 0.16, 3, 8) * 1.6, n2 = fbm3(x * 1.3, 2, z * 1.3, 2, 3);
      const nearShore = 1 - smoothstep(0.1, 0.9, s);   // bare damp soil right behind the coping
      col[k * 3] = (0.92 + 0.2 * n + 0.06 * n2) * lerp(1, 1.1, nearShore);
      col[k * 3 + 1] = (0.98 + 0.12 * n + 0.06 * n2) * lerp(1, 0.86, nearShore);
      col[k * 3 + 2] = (0.86 + 0.1 * n) * lerp(1, 0.8, nearShore);
    }
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, i0 = Math.max(0, i - 1), i1 = Math.min(NX - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(NZ - 1, j + 1);
    const dx = (Y[j * NX + i1] - Y[j * NX + i0]) / (xs[i1] - xs[i0]), dz = (Y[j1 * NX + i] - Y[j0 * NX + i]) / (zs[j1] - zs[j0]);
    const l = Math.hypot(dx, 1, dz); nor[k * 3] = -dx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -dz / l;
  }
  const under = [], wall = [], ground = [];
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
    const minS = Math.min(S[a], S[b], S[c], S[d]), maxY = Math.max(Y[a], Y[b], Y[c], Y[d]);
    const list = minS < 0.02 ? (maxY < WATER_Y - 0.03 ? under : wall) : ground;
    list.push(a, c, b, b, c, d);
  }
  const attrs = {
    position: new THREE.BufferAttribute(pos, 3), normal: new THREE.BufferAttribute(nor, 3),
    uv: new THREE.BufferAttribute(uv, 2), color: new THREE.BufferAttribute(col, 3),
  };
  const mk = (idx) => { const g = new THREE.BufferGeometry(); for (const k in attrs) g.setAttribute(k, attrs[k]); g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1)); g.computeBoundingSphere(); return g; };
  TEX.ground.map.repeat.set(0.7, 0.7); TEX.ground.normalMap.repeat.set(0.7, 0.7);
  const basinMat = rockMaterial(TEX.gravel, { key: 'basin', scale: 1.5, moss: 0.0, rough: 0.9, nrm: 1.2, wet: 0.3, params: { vertexColors: true, envMapIntensity: 0.5 } });
  const groundMat = physical({ map: TEX.ground.map, normalMap: TEX.ground.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, vertexColors: true, envMapIntensity: 0.55, sheen: 0.4, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x6f8a3a) }, { key: 'ground' });
  const mUnder = new THREE.Mesh(mk(under), basinMat), mWall = new THREE.Mesh(mk(wall), basinMat), mGround = new THREE.Mesh(mk(ground), groundMat);
  mUnder.receiveShadow = mWall.receiveShadow = mGround.receiveShadow = true;
  setLayer(mUnder, LAYER.UNDER); setLayer(mWall, LAYER.BOTH); setLayer(mGround, LAYER.ABOVE);
  scene.add(mUnder, mWall, mGround);
}

/* ------------------------------------------------------------------ 7. STONES */
export function instanced(geo, mat, matrices, layer, cast = true) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  matrices.forEach((mm, i) => m.setMatrixAt(i, mm));
  m.count = matrices.length; m.castShadow = cast; m.receiveShadow = true;
  m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
  setLayer(m, layer); scene.add(m);
  return m;
}
// Velvety moss: fur-style shells over the moss-covered parts of instanced rocks (same mask as the rock shader)
export const MOSS_FS = /* glsl */`
uniform sampler2D tMossAlb;
uniform float uMoss;
uniform float uShell;
float mh3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mh3(i), mh3(i + vec3(1,0,0)), f.x), mix(mh3(i + vec3(0,1,0)), mh3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mh3(i + vec3(0,0,1)), mh3(i + vec3(1,0,1)), f.x), mix(mh3(i + vec3(0,1,1)), mh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;
export const MOSS_MAP = /* glsl */`
{
  vec3 wn = normalize(vWNrm);
  float mN = mnoise(vUwPos * 2.2) * 0.7 + mnoise(vUwPos * 7.3 + 4.0) * 0.3;
  float lowLying = 1.0 - smoothstep(uWaterY + 0.05, uWaterY + 0.8, vUwPos.y);
  float shade = 1.0 - clamp(dot(wn, uSunDir), 0.0, 1.0);
  float mm = smoothstep(0.45, 0.85, wn.y * 0.75 + lowLying * 0.35 + shade * 0.3 + (mN - 0.5) * 0.8 - (1.0 - uMoss) * 0.9);
  mm *= smoothstep(uWaterY + 0.07, uWaterY + 0.16, vUwPos.y);
  float strand = mh3(floor(vUwPos * 950.0));
  if (strand * (0.4 + 0.75 * mm) < uShell * 0.8 + 0.12 || mm < 0.35) discard;
  vec3 mc = texture2D(tMossAlb, vUwPos.xz * 3.1).rgb;
  diffuseColor.rgb = mc * (0.55 + 0.75 * uShell) * mix(vec3(1.0), vec3(1.15, 1.1, 0.8), step(0.93, strand));   // occluded at the base, sunlit tips, a few sporophyte tips
}
`;
export function addMossShells(src, moss, shells = 5, h = 0.011) {
  for (let k = 1; k <= shells; k++) {
    const f = k / shells;
    const m = physical({ roughness: 0.9, sheen: 0.8, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x9ab85a), envMapIntensity: 0.5 }, {
      key: 'mossshell', uniforms: { tMossAlb: { value: TEX.moss.map }, uMoss: { value: moss }, uShell: { value: f } },
      vsBegin: `transformed += normalize(objectNormal) * ${(h * f).toFixed(4)} / max(0.2, length(instanceMatrix[1].xyz));`,
      fsPars: MOSS_FS, fsMap: MOSS_MAP });
    const sm = new THREE.InstancedMesh(src.geometry, m, src.count);
    sm.instanceMatrix = src.instanceMatrix; sm.count = src.count; sm.receiveShadow = true; sm.frustumCulled = false;
    setLayer(sm, LAYER.SURFACE); scene.add(sm);
  }
}
export function buildStones() {
  const granite = rockMaterial(TEX.granite, { key: 'granite', scale: 1.5, moss: 0.35, rough: 0.78, nrm: 0.9 });
  const boulderMat = rockMaterial(TEX.boulder, { key: 'boulder', scale: 0.75, moss: 0.62, rough: 0.8, nrm: 1.3, tint: 0xb8b2a8 });
  WORLD.granite = granite;
  WORLD.boulderMat = boulderMat;
  granite.userData.uniforms.uTint.value.setScalar(0.97);
  const V = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler(), SC = new THREE.Vector3();
  const mtx = () => new THREE.Matrix4().compose(V, Q, SC);

  // Cut-granite coping blocks (60 x 20 x 30 cm) following the spline, 2 cm mortar gap, ±3° jitter
  const blocks = [];
  let s = 0.035 * POLY_LEN; const sEnd = 0.705 * POLY_LEN;
  while (s < sEnd) {
    const a0 = shoreAt(s), a1 = shoreAt(s + 0.6), bend = Math.acos(clamp(a0.tx * a1.tx + a0.tz * a1.tz, -1, 1));
    const len = bend > 0.16 ? rr(0.3, 0.38) : bend > 0.08 ? rr(0.42, 0.5) : rr(0.52, 0.66), sh = shoreAt(s + len / 2);
    const yaw = Math.atan2(-sh.tz, sh.tx) + rr(-3, 3) * DEG;
    V.set(sh.x + sh.nx * 0.09, 0.078 + rr(-0.012, 0.01), sh.z + sh.nz * 0.09);
    E.set(rr(-1, 1) * DEG, yaw, rr(-1, 1) * DEG, 'YXZ'); Q.setFromEuler(E);
    SC.set(len / 0.6, rr(0.94, 1.06), rr(0.95, 1.1));
    blocks.push(mtx());
    s += len + 0.02 + rr(-0.004, 0.012);
  }
  // abutment blocks under both bridge ends
  for (const sx of [-1, 1]) {
    V.set(sx * (BRIDGE.half - 0.1), 0.12, BRIDGE.z); E.set(0, Math.PI / 2 + rr(-2, 2) * DEG, 0); Q.setFromEuler(E); SC.set(2.4, 1.5, 1.6); blocks.push(mtx());
  }
  (WORLD.solids = WORLD.solids || []).push(instanced(roundedBox(0.6, 0.2, 0.3, 0.02, 3), granite, blocks, LAYER.BOTH));

  // Natural rounded boulders along the left / near shore, a second row behind, garden accents, submerged stones
  const variants = [0, 1, 2, 3].map((i) => rockGeo(i * 13.7 + 2, 4));
  const shore = [[], [], [], []], under = [[], [], [], []];
  let sb = 0.715 * POLY_LEN; const sbEnd = 1.03 * POLY_LEN;
  while (sb < sbEnd) {
    const r = rr(0.2, 0.42), sh = shoreAt(sb);
    if (nearWaterfall(sh.x, sh.z, 0.85)) { sb += 0.3; continue; }
    V.set(sh.x + sh.nx * r * 0.2, -0.1 + r * 0.45, sh.z + sh.nz * r * 0.2);
    E.set(rr(-0.2, 0.2), rand() * 6.28, rr(-0.2, 0.2)); Q.setFromEuler(E);
    SC.set(r * rr(1.0, 1.35), r * rr(0.62, 0.85), r * rr(0.9, 1.2));
    shore[(rand() * 4) | 0].push(mtx());
    if (rand() < 0.6) {
      const R = rr(0.28, 0.6), d = r * 0.8 + R * 0.7;
      V.set(sh.x + sh.nx * d, groundHeight(sh.x + sh.nx * d, sh.z + sh.nz * d, d) - 0.05 + R * 0.28, sh.z + sh.nz * d);
      E.set(rr(-0.15, 0.15), rand() * 6.28, rr(-0.15, 0.15)); Q.setFromEuler(E);
      SC.set(R * rr(1.1, 1.4), R * rr(0.55, 0.8), R * rr(0.9, 1.2));
      shore[(rand() * 4) | 0].push(mtx());
    }
    sb += r * rr(1.25, 1.6);
  }
  // garden accent rocks (larger, half buried)
  const accents = [[-5.6, 1.9, 0.75], [4.9, 0.2, 0.6], [-3.4, -7.8, 0.7], [3.6, -8.2, 0.55], [5.4, 4.4, 0.8], [-6.2, -2.4, 0.9], [-1.6, 7.6, 0.6]];
  for (const [x, z, R] of accents) {
    V.set(x, groundHeight(x, z, sdf(x, z)) - R * 0.25, z); E.set(rr(-0.2, 0.2), rand() * 6.28, rr(-0.2, 0.2)); Q.setFromEuler(E);
    SC.set(R * rr(1.1, 1.5), R * rr(0.7, 0.9), R * rr(0.9, 1.2)); shore[(rand() * 4) | 0].push(mtx());
  }
  let n = 0, guard = 0;
  while (n < 46 && guard++ < 5000) {
    const x = rr(-3.4, 3.1), z = rr(-6, 6), sd = sdf(x, z);
    if (sd > -0.25) continue;
    const r = rr(0.06, 0.22) * (rand() < 0.15 ? 2.0 : 1);
    V.set(x, -pondDepth(x, z, -sd) + r * 0.2, z); E.set(rr(-0.3, 0.3), rand() * 6.28, rr(-0.3, 0.3)); Q.setFromEuler(E);
    SC.set(r * rr(1, 1.5), r * rr(0.5, 0.8), r); under[(rand() * 4) | 0].push(mtx()); n++;
  }
  for (let i = 0; i < 4; i++) {
    const bm = instanced(variants[i], boulderMat, shore[i], LAYER.BOTH); WORLD.solids.push(bm); addMossShells(bm, 0.62);
    instanced(variants[i], boulderMat, under[i], LAYER.UNDER);
  }
}



export const ground = (x: number, z: number) => groundHeight(x, z, sdf(x, z));
export const sdfGx = (x: number, z: number) => (sdf(x + 0.03, z) - sdf(x - 0.03, z)) / 0.06;
export const sdfGz = (x: number, z: number) => (sdf(x, z + 0.03) - sdf(x, z - 0.03)) / 0.06;
