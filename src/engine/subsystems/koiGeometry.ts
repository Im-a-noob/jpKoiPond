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
// Body outline (s = 0 nose .. 1 tail base; body length = 1 unit). Proportions follow a mature Sanke / Kohaku:
// deep rounded back, broad shoulders, blunt head with a protrusible mouth.
export const KOI_TOP = [[0, 0.006], [0.015, 0.025], [0.05, 0.053], [0.1, 0.076], [0.17, 0.095], [0.26, 0.117], [0.36, 0.126], [0.48, 0.117], [0.62, 0.091], [0.76, 0.062], [0.9, 0.039], [1.0, 0.032]];
export const KOI_BOT = [[0, -0.006], [0.015, -0.021], [0.05, -0.043], [0.1, -0.058], [0.17, -0.07], [0.28, -0.087], [0.42, -0.093], [0.56, -0.083], [0.7, -0.061], [0.84, -0.039], [1.0, -0.028]];
export const KOI_W = [[0, 0.007], [0.015, 0.03], [0.05, 0.06], [0.1, 0.077], [0.17, 0.087], [0.27, 0.098], [0.37, 0.1], [0.5, 0.087], [0.64, 0.063], [0.78, 0.038], [0.91, 0.021], [1.0, 0.013]];
export function crInterp(tab, s) {
  let i = 0; while (i < tab.length - 2 && tab[i + 1][0] < s) i++;
  const p0 = tab[Math.max(0, i - 1)], p1 = tab[i], p2 = tab[i + 1], p3 = tab[Math.min(tab.length - 1, i + 2)];
  const t = clamp((s - p1[0]) / (p2[0] - p1[0]), 0, 1);
  const m1 = (p2[1] - p0[1]) / (p2[0] - p0[0] || 1) * (p2[0] - p1[0]), m2 = (p3[1] - p1[1]) / (p3[0] - p1[0] || 1) * (p2[0] - p1[0]);
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
}
export const KOI_EYE = { s: 0.088, y: 0.014, r: 0.0175 };
export function koiSection(s, th) {
  const bulk = smoothstep(0.03, 0.16, s) * (1 - 0.5 * smoothstep(0.7, 1.0, s));   // mature, broad-shouldered body
  const top = crInterp(KOI_TOP, s) * (1 + 0.06 * bulk), bot = crInterp(KOI_BOT, s) * (1 + 0.06 * bulk), w = crInterp(KOI_W, s) * (1 + 0.2 * bulk);
  const yc = (top + bot) / 2, at = top - yc, ab = yc - bot, c = Math.cos(th), sn = Math.sin(th);
  let y = yc + (c > 0 ? at * Math.pow(c, 0.92) : -ab * Math.pow(-c, 0.88));
  let z = w * Math.sign(sn) * Math.pow(Math.abs(sn), 0.9);
  // operculum: the gill cover stands a little proud with a crisp posterior edge
  const op = smoothstep(0.1, 0.2, s) * (1 - smoothstep(0.2, 0.215, s)) * smoothstep(0.55, 0.0, c);
  // eye bulge
  const eb = Math.exp(-(((s - KOI_EYE.s) / 0.028) ** 2) - (((c - 0.35) / 0.35) ** 2)) * Math.abs(sn);
  const k = 1 + 0.03 * op + 0.1 * eb;
  return [(y - yc) * k + yc, z * k];
}
export function koiBodyGeo() {
  const NS = 104, NR = 56, pos = [], uv = [], lip = [], idx = [];
  const mouthY = -0.004, mouthR = 0.021;
  const ring = (fn) => { for (let j = 0; j <= NR; j++) fn(j, (j / NR) * Math.PI * 2); };
  // ring 0: lip ring (open-state positions, collapsed in the shader when the mouth is shut)
  ring((j, th) => { pos.push(0.5, mouthY + Math.cos(th) * mouthR * 0.9, Math.sin(th) * mouthR); uv.push(0, j / NR); lip.push(1); });
  for (let i = 1; i <= NS; i++) {
    const s = 0.012 + 0.988 * Math.pow((i - 1) / (NS - 1), 1.12);
    ring((j, th) => { const [y, z] = koiSection(s, th); pos.push(0.5 - s, y, z); uv.push(s, j / NR); lip.push(i === 1 ? 0.5 : 0); });
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
    const a = i * (NR + 1) + j, b = a + NR + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // mouth interior: a recessed throat cone behind the lips
  const inner = pos.length / 3;
  ring((j, th) => { pos.push(0.5 - 0.02, mouthY + Math.cos(th) * mouthR * 0.55, Math.sin(th) * mouthR * 0.6); uv.push(0.005, j / NR); lip.push(2); });
  const throat = pos.length / 3; pos.push(0.5 - 0.04, mouthY, 0); uv.push(0.01, 0.5); lip.push(2);
  for (let j = 0; j < NR; j++) { idx.push(j, inner + j, j + 1, j + 1, inner + j, inner + j + 1); idx.push(inner + j, throat, inner + j + 1); }
  // tail cap
  const cap = pos.length / 3, last = NS * (NR + 1); pos.push(-0.5, (crInterp(KOI_TOP, 1) + crInterp(KOI_BOT, 1)) / 2, 0); uv.push(1, 0.5); lip.push(0);
  for (let j = 0; j < NR; j++) idx.push(last + j, last + j + 1, cap);
  // two pairs of barbels at the corners of the mouth (they ride forward with the lips)
  for (const side of [1, -1]) for (const [len, off, r0] of [[0.028, 0.0, 0.0024], [0.016, 0.012, 0.0017]]) {
    const base = pos.length / 3, segs = 7, rad = 6;
    for (let a = 0; a <= segs; a++) {
      const t = a / segs, cx = 0.5 - 0.008 - off - t * len * 0.55, cy = mouthY - 0.008 - t * len * 0.72, cz = side * (0.013 + t * len * 0.35), r = r0 * (1 - t * 0.75);
      for (let b = 0; b <= rad; b++) { const an = (b / rad) * Math.PI * 2; pos.push(cx + Math.cos(an) * r, cy, cz + Math.sin(an) * r); uv.push(0.02, 0.5); lip.push(0.5); }
    }
    for (let a = 0; a < segs; a++) for (let b = 0; b < rad; b++) { const p = base + a * (rad + 1) + b, q = p + rad + 1; idx.push(p, q, p + 1, p + 1, q, q + 1); }
  }
  for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; }   // outward-facing winding
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aLip', new THREE.Float32BufferAttribute(lip, 1));
  g.setIndex(idx); g.computeVertexNormals();
  // stitch the dorsal seam (first/last vertex of every ring share a position)
  const n = g.attributes.normal;
  for (let i = 0; i <= NS; i++) {
    const a = i * (NR + 1), b = a + NR;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}
// Fins: aFin = (type, distance from root 0..1, across -1..1, -), aPivot = root pivot.
// types: 0 dorsal, 1 pectoral L, 2 pectoral R, 3 pelvic L, 4 pelvic R, 5 anal, 6 caudal
export function koiFinGeo() {
  const pos = [], uv = [], fin = [], piv = [], idx = [];
  const grid = (nu, nv, fn, type, pivot) => {
    const b = pos.length / 3;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv, p = fn(u, v);
      pos.push(p[0], p[1], p[2]); uv.push(u, v); fin.push(type, u, v * 2 - 1, 0); piv.push(...pivot);
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = b + i * (nv + 1) + j, c = a + nv + 1; idx.push(a, c, a + 1, a + 1, c, c + 1); }
  };
  const top = (s) => crInterp(KOI_TOP, s), bot = (s) => crInterp(KOI_BOT, s), wid = (s) => crInterp(KOI_W, s);
  // dorsal: long, rising steeply at the front and tapering back
  grid(10, 30, (u, v) => {
    const s = lerp(0.37, 0.76, v), h = 0.078 * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.5)), 0.75) * (1.2 - 0.55 * v);
    return [0.5 - s - u * 0.045 * (0.3 + v), top(s) - 0.004 + u * h, 0];
  }, 0, [0, 0, 0]);
  // caudal: broad forked tail with rounded lobes
  grid(14, 30, (u, v) => {
    const w = v * 2 - 1, aw = Math.abs(w);
    const L = (0.15 + 0.11 * Math.pow(aw, 1.3) - 0.045 * (1 - aw)) * (1 - 0.22 * Math.pow(aw, 8));
    const half = 0.026 + 0.17 * Math.pow(u, 0.85);
    return [-0.485 - L * u, w * half + 0.004, 0];
  }, 6, [-0.485, 0, 0]);
  // anal fin
  grid(6, 10, (u, v) => { const s = lerp(0.74, 0.86, v); return [0.5 - s - u * 0.03, bot(s) + 0.003 - u * 0.05 * Math.sin(Math.PI * Math.pow(v, 0.6)), 0]; }, 5, [0, 0, 0]);
  // paired fins: large fan pectorals behind the gill covers, smaller pelvics
  for (const side of [1, -1]) {
    for (const [s, L, W, type] of [[0.225, 0.2, 0.08, side > 0 ? 1 : 2], [0.5, 0.108, 0.042, side > 0 ? 3 : 4]]) {
      const pv = [0.5 - s, bot(s) * 0.62 + (type > 2 ? 0.004 : 0), side * wid(s) * (type > 2 ? 0.55 : 0.72)];
      const D1 = new THREE.Vector3(-0.55, -0.24, side * 0.8).normalize();
      const D2 = new THREE.Vector3(1, 0, 0).addScaledVector(D1, -D1.x).normalize();
      grid(10, 14, (u, v) => {
        // a rounded fan: rays radiate from a narrow base and end on a convex, scalloped margin (never a square tip)
        const w = v * 2 - 1, Leff = L * (0.48 + 0.52 * Math.sqrt(Math.max(0, 1 - w * w))) * (1 + 0.14 * w) * (1 + 0.015 * Math.sin(v * 40.0));
        const across = w * (0.005 + W * 0.92 * Math.pow(u, 0.95) * (1 - 0.15 * smoothstep(0.85, 1, u)));
        return [pv[0] + D1.x * Leff * u + D2.x * across, pv[1] + D1.y * Leff * u + D2.y * across, pv[2] + D1.z * Leff * u + D2.z * across];
      }, type, pv);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 4));
  g.setAttribute('aPivot', new THREE.Float32BufferAttribute(piv, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
export function koiEyeGeo() {
  const geos = [];
  for (const side of [1, -1]) {
    const [yb, zb] = koiSection(KOI_EYE.s, Math.PI / 2 - 0.42);
    const g = new THREE.SphereGeometry(KOI_EYE.r, 28, 20);
    g.rotateX(side > 0 ? Math.PI / 2 : -Math.PI / 2);          // pole (iris) faces outward
    const c = [0.5 - KOI_EYE.s, yb + 0.002, side * (Math.abs(zb) - KOI_EYE.r * 0.45)];
    g.translate(c[0], c[1], c[2]);
    const n = g.attributes.position.count, cc = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cc.set(c, i * 3);
    g.setAttribute('aEyeC', new THREE.BufferAttribute(cc, 3));
    geos.push(g);
  }
  const m = mergeGeos(geos);
  const cc = new Float32Array(m.attributes.position.count * 3); let o = 0;
  for (const g of geos) { cc.set(g.attributes.aEyeC.array, o); o += g.attributes.aEyeC.array.length; }
  m.setAttribute('aEyeC', new THREE.BufferAttribute(cc, 3));
  return m;
}

// Variety palettes (sRGB) and pattern rules. The roster order puts the iconic varieties first.
