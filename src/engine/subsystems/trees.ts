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
export const LEAVES = { maple: [], pine: [], green: [], conifer: [], shrub: [], bloom: [], sakura: [], hydrangea: [], bigleaf: [], camellia: [], kikyo: [] };
export const BARK = [];
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1), _s = new THREE.Vector3();
export function addCard(list, p, n, size, color) {
  _q.setFromUnitVectors(_z, n.clone().normalize());
  _q2.setFromAxisAngle(_z, rand() * Math.PI * 2);
  _q.multiply(_q2);
  _s.set(size, size, size);
  list.push({ m: new THREE.Matrix4().compose(p, _q, _s), c: color });
}
export function randDir() { const u = rr(-1, 1), a = rr(0, Math.PI * 2), s = Math.sqrt(1 - u * u); return new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a)); }
// Recursive branching; returns branch curves and tip points
export function growTree(o) {
  const branches = [], tips = [];
  function grow(start, dir, len, rad, lvl) {
    const pts = [start.clone()], d = dir.clone(), p = start.clone(), segs = lvl === 0 ? 6 : 4;
    for (let i = 1; i <= segs; i++) {
      d.addScaledVector(randDir(), o.wiggle[lvl] ?? 0.2);
      d.y += o.gravity[lvl] ?? 0; d.normalize();
      p.addScaledVector(d, len / segs); pts.push(p.clone());
    }
    const curve = new THREE.CatmullRomCurve3(pts), rEnd = rad * o.radDecay;
    branches.push({ curve, r0: rad, r1: lvl >= o.depth ? rad * 0.3 : rEnd, lvl });
    if (lvl >= o.depth) { tips.push({ p: p.clone(), d: d.clone(), lvl }); return; }
    const nC = o.children[lvl];
    for (let c = 0; c < nC; c++) {
      const t = lerp(o.childStart[lvl], 0.98, (c + rand()) / nC);
      const sp = curve.getPointAt(t), tan = curve.getTangentAt(t);
      const axis = randDir().cross(tan).normalize();
      const nd = tan.clone().applyAxisAngle(axis, o.spread[lvl] * rr(0.7, 1.2));
      nd.y = lerp(nd.y, o.upBias[lvl] ?? nd.y, 0.5); nd.normalize();
      grow(sp, nd, len * o.lenDecay * rr(0.8, 1.1), lerp(rad, rEnd, t) * 0.78, lvl + 1);
    }
    if (lvl >= o.depth - 1) tips.push({ p: p.clone(), d: d.clone(), lvl });
  }
  grow(o.base, o.dir, o.len, o.rad, 0);
  tips.branches = branches;
  for (const b of branches) {
    const tub = b.lvl === 0 ? 28 : b.lvl === 1 ? 12 : 6, rad = b.lvl === 0 ? 12 : b.lvl === 1 ? 8 : 5;
    if (b.r0 < 0.008) continue;
    BARK.push(taperTube(b.curve, tub, rad, b.r0, b.r1, 1.2));
  }
  return tips;
}
const ground = (x, z) => groundHeight(x, z, sdf(x, z));

