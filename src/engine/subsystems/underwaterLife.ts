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
import { waterHeightAt } from "./water";
import { terrainHeight } from "./terrain";
import { BRIDGE } from "./terrain";

/* ------------------------------------------------------------------ 9d. UNDERWATER: lily rhizomes, roots & petioles, lotus tubers, submerged plants */
// Nymphaea grow from knobbly rhizomes creeping through the mud; each pad and flower rises on its own long, flexible
// petiole. Nelumbo (sacred lotus) grows from segmented tubers (renkon) with roots at every node.
export const ROOTS = { stems: [], stemGeo: null };
export function knobbly(geo, amp, freq, seed) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = amp * fbm3(x * freq + seed, y * freq, z * freq, 3, seed | 0);
    p.setXYZ(i, x + n.getX(i) * k, y + n.getY(i) * k, z + n.getZ(i) * k);
  }
  geo.computeVertexNormals(); return geo;
}
export function bottomY(x, z) { return terrainHeight(x, z); }
export function buildUnderwaterLife() {
  const V3 = THREE.Vector3;
  const rhizomeMat = physical({ map: TEX.bark.map, normalMap: TEX.bark.normalMap, normalScale: new THREE.Vector2(1.0, 1.0), color: 0xe8cda4, roughness: 0.75 }, { key: 'rhizome' });
  const rootMat = physical({ color: 0xcdbb98, roughness: 0.6, sheen: 0.5, sheenColor: new THREE.Color(0xf0e6d0) }, { key: 'rootlets', leaf: true, uniforms: { uTransl: { value: 0.4 } } });
  const tuberMat = physical({ color: 0xc9a77e, map: TEX.boulder.map, roughness: 0.5, clearcoat: 0.3, sheen: 0.3, sheenColor: new THREE.Color(0xf5e2c8) }, { key: 'renkon' });
  const rhiz = [], roots = [], tubers = [];
  // ---- cluster the floating pads and give every cluster a rhizome on the floor
  const pads = WORLD.lilies || [], used = new Set(), clusters = [];
  pads.forEach((L, i) => {
    if (used.has(i)) return;
    const c = [i]; used.add(i);
    pads.forEach((M, j) => { if (!used.has(j) && Math.hypot(L.x - M.x, L.z - M.z) < 1.0) { c.push(j); used.add(j); } });
    clusters.push(c);
  });
  ROOTS.anchors = new Array(pads.length);
  for (const c of clusters) {
    const cx = c.reduce((s2, i) => s2 + pads[i].x, 0) / c.length, cz = c.reduce((s2, i) => s2 + pads[i].z, 0) / c.length;
    const ang = rand() * Math.PI, len = 0.35 + c.length * 0.12, pts = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5 - 0.5, x = cx + Math.cos(ang) * len * t + rr(-0.04, 0.04), z = cz + Math.sin(ang) * len * t + rr(-0.04, 0.04);
      pts.push(new V3(x, bottomY(x, z) + 0.03, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    rhiz.push(knobbly(taperTube(curve, 28, 12, 0.038, 0.028, 6), 0.009, 45, cx * 3));
    // fibrous roots from the underside, spreading into the gravel
    for (let r = 0; r < 48; r++) {
      const p0 = curve.getPointAt(rand()), a = rand() * Math.PI * 2, L = rr(0.07, 0.24);
      const p1 = p0.clone().add(new V3(Math.cos(a) * L * 0.5, -0.004, Math.sin(a) * L * 0.5));
      const p2 = p0.clone().add(new V3(Math.cos(a) * L, 0, Math.sin(a) * L)); p2.y = bottomY(p2.x, p2.z) - 0.01;
      roots.push(taperTube(new THREE.CatmullRomCurve3([p0.clone().add(new V3(0, -0.02, 0)), p1, p2]), 7, 4, rr(0.0022, 0.0038), 0.0008, 4));
    }
    // leaf scars / growing tips along the rhizome
    for (let k = 0; k < 5; k++) { const p = curve.getPointAt(0.1 + k * 0.2); const g = new THREE.SphereGeometry(0.02, 10, 8); g.scale(1, 0.7, 1); g.translate(p.x, p.y + 0.014, p.z); rhiz.push(g); }
    for (const i of c) ROOTS.anchors[i] = curve.getPointAt(rand()).add(new V3(0, 0.015, 0));
  }
  // ---- sacred-lotus tubers (renkon) under the emergent leaves, with roots at the nodes
  const lotusBase = new V3(-2.8, 0, 0.05);
  {
    const ang = 0.6, pts = [];
    for (let k = 0; k < 5; k++) { const x = lotusBase.x + Math.cos(ang) * (k - 2) * 0.16, z = lotusBase.z + Math.sin(ang) * (k - 2) * 0.16; pts.push(new V3(x, bottomY(x, z) + 0.018, z)); }
    const curve = new THREE.CatmullRomCurve3(pts), N = 40, rad = 12, pos = [], uv = [], idx = [];
    const frames = curve.computeFrenetFrames(N, false), P = new V3();
    for (let i = 0; i <= N; i++) {
      const t = i / N; curve.getPointAt(t, P);
      const seg = (t * 4) % 1, r = 0.026 * (0.55 + 0.45 * Math.sqrt(Math.sin(Math.PI * seg)));   // constricted nodes
      for (let j = 0; j <= rad; j++) { const a = (j / rad) * Math.PI * 2, nx = frames.normals[i].x * Math.cos(a) + frames.binormals[i].x * Math.sin(a), ny = frames.normals[i].y * Math.cos(a) + frames.binormals[i].y * Math.sin(a), nz = frames.normals[i].z * Math.cos(a) + frames.binormals[i].z * Math.sin(a); pos.push(P.x + nx * r, P.y + ny * r, P.z + nz * r); uv.push(j / rad, t * 3); }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j, b = a + rad + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    tubers.push(g);
    for (let k = 1; k < 4; k++) {
      const p0 = curve.getPointAt(k / 4);
      for (let r = 0; r < 14; r++) { const a = rand() * Math.PI * 2, L = rr(0.05, 0.14), p2 = p0.clone().add(new V3(Math.cos(a) * L, 0, Math.sin(a) * L)); p2.y = bottomY(p2.x, p2.z) - 0.012;
        roots.push(taperTube(new THREE.CatmullRomCurve3([p0.clone().add(new V3(0, -0.02, 0)), p0.clone().lerp(p2, 0.5).add(new V3(0, -0.01, 0)), p2]), 6, 4, 0.0022, 0.0007, 4)); }
    }
    // stalks of the emergent leaves and the flower reach down to the tuber
    ROOTS.lotusAnchor = curve;
  }
  const mk = (geos, mat) => { const m = new THREE.Mesh(mergeGeos(geos), mat); m.receiveShadow = true; m.castShadow = false; setLayer(m, LAYER.UNDER); scene.add(m); return m; };
  mk(rhiz, rhizomeMat); mk(roots, rootMat); mk(tubers, tuberMat);
  // ---- petioles (pads & flowers): one dynamic tube mesh, rebuilt each frame so the stems follow the drifting pads
  const petioleMat = physical({ color: 0xa89a5c, roughness: 0.38, sheen: 0.4, sheenColor: new THREE.Color(0xe0c8a0) }, { key: 'petiole', leaf: true, uniforms: { uTransl: { value: 0.7 } } });
  const SEG = 14, RAD = 6;
  pads.forEach((L, i) => {
    ROOTS.stems.push({ pad: L, anchor: ROOTS.anchors[i], r: 0.0068, ph: rand() * 6, flower: null });
    L.mesh.traverse((o) => { if (o.userData.flower) ROOTS.stems.push({ pad: L, anchor: ROOTS.anchors[i].clone().add(new V3(rr(-0.05, 0.05), 0, rr(-0.05, 0.05))), r: 0.0078, ph: rand() * 6, flower: o }); });
  });
  const nV = ROOTS.stems.length * (SEG + 1) * (RAD + 1), pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), idx = [];
  ROOTS.stems.forEach((st, k) => { const b = k * (SEG + 1) * (RAD + 1); for (let i = 0; i < SEG; i++) for (let j = 0; j < RAD; j++) { const a = b + i * (RAD + 1) + j, c = a + RAD + 1; idx.push(a, a + 1, c, a + 1, c + 1, c); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
  g.attributes.position.setUsage(THREE.DynamicDrawUsage); g.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  ROOTS.stemMesh = new THREE.Mesh(g, petioleMat); ROOTS.stemMesh.frustumCulled = false; ROOTS.stemMesh.receiveShadow = true;
  setLayer(ROOTS.stemMesh, LAYER.UNDER); scene.add(ROOTS.stemMesh); seasonal(ROOTS.stemMesh, 'SRA');
  Object.assign(ROOTS, { SEG, RAD });
  // lotus stalks extended to the tuber
  for (const Lt of WORLD.lotus || []) {
    const top = new V3(); Lt.leaf.getWorldPosition(top); const a = ROOTS.lotusAnchor.getPointAt(rand());
    const c = new THREE.CatmullRomCurve3([a, a.clone().lerp(top, 0.4).add(new V3(rr(-0.05, 0.05), 0, rr(-0.05, 0.05))), new V3(top.x, WATER_Y - 0.3, top.z)]);
    mk([taperTube(c, 12, 6, 0.0065, 0.006, 3)], petioleMat);
  }
  // ---- submerged plants: eelgrass ribbons and hornwort clumps; a few decaying leaves on the floor
  const ribbon = (h, w) => {
    const segs = 12, p2 = [], u2 = [], i2 = [];
    for (let i = 0; i <= segs; i++) { const t = i / segs, wd = w * (1 - 0.3 * t), x = 0.03 * Math.sin(t * 3) * t; p2.push(x, h * t, -wd / 2, x, h * t, wd / 2); u2.push(0, t, 1, t); }
    for (let i = 0; i < segs; i++) { const a = i * 2; i2.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(u2, 2)); gg.setIndex(i2); gg.computeVertexNormals(); return gg;
  };
  const eelMat = physical({ map: TEX.iris, color: 0x9ab87a, side: THREE.DoubleSide, roughness: 0.45, sheen: 0.4, sheenColor: new THREE.Color(0xc8e0a0) },
    { key: 'eelgrass', leaf: true, wind: 'local', windWeight: 'pow(uv.y, 1.5) * 1.6', uniforms: { uTransl: { value: 0.6 } } });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), Sc = new V3(), Pp = new V3(), eel = [];
  let guard = 0, clumps = 0;
  while (clumps < 26 && guard++ < 3000) {
    const x = rr(-3.3, 3.0), z = rr(-5.8, 5.6), sd = sdf(x, z);
    if (sd > -0.35 || sd < -1.3 || Math.abs(z - BRIDGE.z) < 0.7) continue;
    clumps++;
    const n = 8 + (rand() * 10 | 0), depth = -bottomY(x, z);
    for (let i = 0; i < n; i++) {
      Pp.set(x + rr(-0.12, 0.12), bottomY(x, z) - 0.01, z + rr(-0.12, 0.12)); E.set(rr(-0.15, 0.15), rand() * 6.28, rr(-0.15, 0.15)); Q.setFromEuler(E);
      const hs = depth * rr(0.55, 0.95); Sc.set(1, hs, 1); eel.push(M.compose(Pp, Q, Sc).clone());
    }
  }
  const eim = new THREE.InstancedMesh(ribbon(1, 0.012), eelMat, eel.length); eel.forEach((m, i) => eim.setMatrixAt(i, m));
  eim.receiveShadow = true; eim.computeBoundingSphere(); setLayer(eim, LAYER.UNDER); scene.add(eim);
  // hornwort: whorls of fine needles on upright stems (alpha cards stacked around the stem)
  const hcv = makeCanvas(128, 256), hg = hcv.getContext('2d');
  hg.strokeStyle = '#3f5a24'; hg.lineWidth = 3; hg.beginPath(); hg.moveTo(64, 256); hg.lineTo(64, 0); hg.stroke();
  for (let y = 8; y < 256; y += 14) for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2 + y; hg.strokeStyle = `hsl(${95 + (y % 20)}, 45%, ${24 + (k % 3) * 4}%)`; hg.lineWidth = 1.6; hg.beginPath(); hg.moveTo(64, y); hg.lineTo(64 + Math.cos(a) * 34, y - 10 + Math.sin(a) * 6); hg.stroke(); }
  const hornMat = physical({ map: canvasTex(hcv), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6 }, { key: 'hornwort', leaf: true, wind: 'local', windWeight: 'uv.y * 0.8', uniforms: { uTransl: { value: 0.5 } } });
  const hcard = new THREE.PlaneGeometry(0.1, 0.32); hcard.translate(0, 0.16, 0);
  const horn = [];
  guard = 0; clumps = 0;
  while (clumps < 16 && guard++ < 3000) {
    const x = rr(-3.3, 3.0), z = rr(-5.8, 5.6), sd = sdf(x, z);
    if (sd > -0.3 || sd < -1.0) continue;
    clumps++;
    for (let i = 0; i < 9; i++) { Pp.set(x + rr(-0.08, 0.08), bottomY(x, z) - 0.01, z + rr(-0.08, 0.08)); E.set(0, rand() * 6.28, rr(-0.2, 0.2)); Q.setFromEuler(E); const s2 = rr(0.7, 1.4); Sc.set(s2, s2, s2); horn.push(M.compose(Pp, Q, Sc).clone()); }
  }
  const him = new THREE.InstancedMesh(hcard, hornMat, horn.length); horn.forEach((m, i) => him.setMatrixAt(i, m));
  him.receiveShadow = true; him.computeBoundingSphere(); setLayer(him, LAYER.UNDER); scene.add(him);
  // decaying leaves resting on the gravel
  const lcv = makeCanvas(64, 64), lg2 = lcv.getContext('2d');
  lg2.fillStyle = '#5a3a1e'; lg2.beginPath(); lg2.ellipse(32, 32, 14, 28, 0, 0, Math.PI * 2); lg2.fill(); lg2.strokeStyle = 'rgba(30,18,8,0.7)'; lg2.beginPath(); lg2.moveTo(32, 4); lg2.lineTo(32, 60); lg2.stroke();
  const deadMat = physical({ map: canvasTex(lcv), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }, { key: 'deadleaf' });
  const dg = new THREE.PlaneGeometry(0.06, 0.06); dg.rotateX(-Math.PI / 2);
  const dead = [];
  for (let i = 0; i < 70; i++) { let x, z, g2 = 0; do { x = rr(-3.3, 3.0); z = rr(-5.8, 5.6); } while (sdf(x, z) > -0.2 && g2++ < 50); Pp.set(x, bottomY(x, z) + 0.004, z); E.set(rr(-0.2, 0.2), rand() * 6.28, rr(-0.2, 0.2)); Q.setFromEuler(E); const s2 = rr(0.6, 1.3); Sc.set(s2, 1, s2); dead.push(M.compose(Pp, Q, Sc).clone()); }
  const dim = new THREE.InstancedMesh(dg, deadMat, dead.length); dead.forEach((m, i) => dim.setMatrixAt(i, m));
  dim.receiveShadow = true; dim.computeBoundingSphere(); setLayer(dim, LAYER.UNDER); scene.add(dim);
}
const _st = new THREE.Vector3(), _st2 = new THREE.Vector3(), _sb = new THREE.Vector3(), _sn = new THREE.Vector3(), _sT = new THREE.Vector3(), _sp = new THREE.Vector3();
export function updateUnderwaterLife(t) {
  if (!ROOTS.stemMesh) return;
  const pos = ROOTS.stemMesh.geometry.attributes.position.array, nor = ROOTS.stemMesh.geometry.attributes.normal.array, SEG = ROOTS.SEG, RAD = ROOTS.RAD;
  let o = 0;
  for (const st of ROOTS.stems) {
    const a = st.anchor;
    if (st.flower) st.flower.getWorldPosition(_st2); else _st2.copy(st.pad.mesh.position);
    _st2.y = WATER_Y - 0.006;
    const L = Math.max(0.2, a.distanceTo(_st2));
    // cubic Bezier: rises from the rhizome, leans, and eases horizontally into the underside of the pad
    const c1x = a.x + Math.sin(st.ph + t * 0.2) * 0.05, c1y = a.y + L * 0.45, c1z = a.z + Math.cos(st.ph) * 0.05;
    const c2x = _st2.x + (a.x - _st2.x) * 0.25, c2y = _st2.y - L * 0.25, c2z = _st2.z + (a.z - _st2.z) * 0.25;
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG, iu = 1 - u, b0 = iu * iu * iu, b1 = 3 * iu * iu * u, b2 = 3 * iu * u * u, b3 = u * u * u;
      _sp.set(a.x * b0 + c1x * b1 + c2x * b2 + _st2.x * b3, a.y * b0 + c1y * b1 + c2y * b2 + _st2.y * b3, a.z * b0 + c1z * b1 + c2z * b2 + _st2.z * b3);
      const d0 = 3 * iu * iu, d1 = 6 * iu * u, d2 = 3 * u * u;
      _sT.set((c1x - a.x) * d0 + (c2x - c1x) * d1 + (_st2.x - c2x) * d2, (c1y - a.y) * d0 + (c2y - c1y) * d1 + (_st2.y - c2y) * d2, (c1z - a.z) * d0 + (c2z - c1z) * d1 + (_st2.z - c2z) * d2).normalize();
      _sn.set(0, 1, 0).cross(_sT); if (_sn.lengthSq() < 1e-6) _sn.set(1, 0, 0); _sn.normalize(); _sb.crossVectors(_sT, _sn);
      const r = st.r * (1 - 0.25 * u);
      for (let j = 0; j <= RAD; j++) {
        const ang = (j / RAD) * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
        const nx = _sn.x * cs + _sb.x * sn, ny = _sn.y * cs + _sb.y * sn, nz = _sn.z * cs + _sb.z * sn;
        pos[o] = _sp.x + nx * r; pos[o + 1] = _sp.y + ny * r; pos[o + 2] = _sp.z + nz * r; nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz; o += 3;
      }
    }
  }
  ROOTS.stemMesh.geometry.attributes.position.needsUpdate = true; ROOTS.stemMesh.geometry.attributes.normal.needsUpdate = true;
}

