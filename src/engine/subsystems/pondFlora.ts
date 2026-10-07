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
import { buildFrog, updateFrog } from "./frog";
import { updateTurtle } from "./turtle";
import { buildSacredLotus } from "./lotus";
import { FEED, HANDCOL } from "./interactions";

export function padTextures() {
  const N = 512, cv = makeCanvas(N, N), g = cv.getContext('2d'), hv = makeCanvas(N, N), hg = hv.getContext('2d');
  const img = g.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N - 0.5, v = y / N - 0.5, r = Math.hypot(u, v) * 2;
    const m = fbm2P(x / N * 6, y / N * 6, 6, 4, 71) * 0.5 + 0.5, fine = fbm2P(x / N * 40, y / N * 40, 40, 2, 5) * 0.5 + 0.5;
    let c = mix3(srgbHex(0x55812f), srgbHex(0x3f6a24), smoothstep(0.1, 0.95, r) * 0.7 + m * 0.3);
    c = mix3(c, srgbHex(0x7b8a34), smoothstep(0.66, 0.8, m) * 0.35);                 // sun-bleached patches
    c = mix3(c, srgbHex(0x6a4a24), smoothstep(0.8, 0.9, fbm2P(x / N * 14, y / N * 14, 14, 3, 9) * 0.5 + 0.5) * 0.5);  // small brown blemishes
    c = mix3(c, srgbHex(0x6b2e2a), smoothstep(0.9, 0.99, r) * 0.7);                  // reddish margin
    c = c.map((q) => q * (0.94 + 0.12 * fine));
    const i = (y * N + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // veins: primary rays from the centre forking twice, drawn into colour (lighter) and height (raised)
  hg.fillStyle = '#000'; hg.fillRect(0, 0, N, N);
  const R = mulberry32(77);
  const vein = (x0, y0, a, len, w, depth) => {
    let x = x0, y = y0; const steps = 12;
    for (let s = 0; s < steps; s++) {
      a += (R() - 0.5) * 0.08;
      const nx = x + Math.cos(a) * len / steps, ny = y + Math.sin(a) * len / steps, ww = w * (1 - s / steps * 0.6);
      for (const [ctx, col] of [[g, 'rgba(160,190,105,0.16)'], [hg, 'rgba(255,255,255,0.5)']]) { ctx.strokeStyle = col; ctx.lineWidth = ww; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke(); }
      x = nx; y = ny;
      if (depth < 2 && s === Math.floor(steps * 0.55)) { vein(x, y, a + 0.35, len * 0.45, ww * 0.6, depth + 1); vein(x, y, a - 0.35, len * 0.45, ww * 0.6, depth + 1); }
    }
  };
  const nV = 21;
  for (let k = 0; k < nV; k++) vein(N / 2, N / 2, (k / nV) * Math.PI * 2 + R() * 0.1, N * 0.46, 3.2, 0);
  const tex = canvasTex(cv, true);
  const hd = hg.getImageData(0, 0, N, N).data, H = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) H[i] = hd[i * 4] / 255 * 0.6 + (fbm2P((i % N) / N * 30, Math.floor(i / N) / N * 30, 30, 2, 3) * 0.5 + 0.5) * 0.2;
  const nrm = dataTex(heightToNormal(H, N, N, 2.2), N, N, false);
  nrm.wrapS = nrm.wrapT = THREE.ClampToEdgeWrapping; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { map: tex, normalMap: nrm };
}
export function petalTexture(inner, outer, tip) {
  const cv = makeCanvas(128, 256), g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 256, 0, 0);
  grd.addColorStop(0, inner); grd.addColorStop(0.55, outer); grd.addColorStop(1, tip);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 256);
  g.globalAlpha = 0.18; g.strokeStyle = '#ffffff';
  for (let i = 0; i < 22; i++) { const x = 64 + (i - 11) * 5; g.beginPath(); g.moveTo(64, 256); g.quadraticCurveTo(x, 128, 64 + (i - 11) * 3.2, 4); g.stroke(); }
  return canvasTex(cv, true);
}
// Pointed petal (lanceolate) as a curved strip; bend lifts the tip, cup curls the sides
export function petalGeo(len, wid, bend, cup) {
  const nu = 8, nv = 4, pos = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv - 0.5, w = wid * Math.sin(Math.PI * Math.pow(u, 0.7)) * (1 - 0.15 * u) * 2 * v;
    const y = bend * u * u + cup * Math.abs(v) * Math.sin(Math.PI * u) * wid;
    pos.push(w, y, -u * len); uv.push(v + 0.5, u);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
export function waterLilyGeo(scale, open) {
  const parts = [];
  const rings = [[14, 0.075, 0.028, 0.5, 0.35], [12, 0.066, 0.025, 0.9, 0.5], [10, 0.055, 0.022, 1.25, 0.6], [8, 0.042, 0.018, 1.6, 0.7]];
  rings.forEach(([n, L, W, lift, cup], r) => {
    for (let i = 0; i < n; i++) {
      const g = petalGeo(L * scale, W * scale, 0.012 * scale, cup);
      g.rotateX(-(0.12 + lift * open * 0.55 + (1 - open) * 1.25));
      g.rotateY((i / n) * Math.PI * 2 + r * 0.31);
      g.translate(0, 0.004 * scale + r * 0.003 * scale, 0);
      parts.push(g);
    }
  });
  return mergeGeos(parts);
}
export function stamenGeo(scale) {
  const parts = [];
  const disc = new THREE.CylinderGeometry(0.012 * scale, 0.014 * scale, 0.008 * scale, 16); disc.translate(0, 0.012 * scale, 0); parts.push(disc);
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2, r0 = rr(0.009, 0.016) * scale, h = rr(0.014, 0.022) * scale;
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(Math.cos(a) * r0 * 0.8, 0.012 * scale, Math.sin(a) * r0 * 0.8), new THREE.Vector3(Math.cos(a) * r0 * 1.1, 0.012 * scale + h * 0.6, Math.sin(a) * r0 * 1.1), new THREE.Vector3(Math.cos(a) * r0 * 1.5, 0.012 * scale + h, Math.sin(a) * r0 * 1.5)]);
    parts.push(taperTube(c, 4, 4, 0.0012 * scale, 0.0018 * scale, 1));
  }
  return mergeGeos(parts);
}
// Floating pad: polar grid with a notch, wavy margin, slightly upturned rim
export function padGeo(r, seed, lotus) {
  const NR = 16, NA = 72, notch = lotus ? 0 : 0.32, pos = [], uv = [], idx = [];
  for (let i = 0; i <= NR; i++) for (let j = 0; j <= NA; j++) {
    const t = i / NR, a = notch / 2 + (j / NA) * (Math.PI * 2 - notch);
    const wav = 1 + 0.02 * Math.sin(a * 7 + seed) + 0.012 * Math.sin(a * 13 + seed * 2);
    const rr2 = r * Math.max(0.01, t) * wav;
    const y = lotus ? r * 0.28 * t * t - r * 0.02 * Math.sin(a * 9 + seed) * t * t * t : 0.0045 * Math.pow(t, 5) + 0.0015 * Math.sin(a * 5 + seed) * t * t * t + 0.001 * (1 - t);
    pos.push(Math.cos(a) * rr2, y, Math.sin(a) * rr2);
    uv.push(0.5 + Math.cos(a) * t * wav * 0.49, 0.5 + Math.sin(a) * t * wav * 0.49);
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + NA + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
export function padSurfaceY(r, x, z) { const t = clamp(Math.hypot(x, z) / r, 0, 1); return 0.0045 * Math.pow(t, 5) + 0.001 * (1 - t); }

export function buildPondLife() {
  const PT = padTextures();
  const padMat = physical({ map: PT.map, normalMap: PT.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.25,
    sheen: 0.3, sheenColor: new THREE.Color(0xb8d890), side: THREE.DoubleSide, envMapIntensity: 0.9 }, {
    key: 'pad2', leaf: true, float: true, decid: 0.5, uniforms: { uTransl: { value: 0.25 } },
    fsMap: 'if (!gl_FrontFacing) diffuseColor.rgb *= vec3(0.85, 0.45, 0.42);',                         // purple-red underside
  });
  const lotusMat = physical({ map: PT.map, normalMap: PT.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: 0xb9d6c2, roughness: 0.5, sheen: 0.9, sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0xd9ecf2), side: THREE.DoubleSide, envMapIntensity: 1.0 }, { key: 'lotusleaf', leaf: true, decid: 1, uniforms: { uTransl: { value: 0.35 } } });
  const dropMat = physical({ color: 0xcfe2ea, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.0, transparent: true, opacity: 0.55, envMapIntensity: 1.8, specularIntensity: 1 }, { key: 'drop' });
  const padDropMat = physical({ color: 0xcfe2ea, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.0, transparent: true, opacity: 0.55, envMapIntensity: 1.8, specularIntensity: 1 }, { key: 'paddrop', float: true });
  const lilyPetal = petalTexture('#fff6e8', '#f7cddb', '#e98fb2');
  const lilyMat = physical({ map: lilyPetal, side: THREE.DoubleSide, roughness: 0.42, sheen: 0.8, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xffe2ec), envMapIntensity: 0.8 },
    { key: 'lilypetal', leaf: true, uniforms: { uTransl: { value: 0.75 } } });
  const stamenMat = physical({ color: 0xf2c02a, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0xfff0a0) }, { key: 'stamen', leaf: true, uniforms: { uTransl: { value: 0.5 } } });
  const stemMat = physical({ color: 0x5f7f3a, map: TEX.blade, roughness: 0.5 }, { key: 'stem' });
  WORLD.lilies = [];
  // Clusters of pads (sizes vary; some overlap) + the frog's big pad in the near shallows
  const pads = [[-1.05, 3.85, 0.27, 'frog'], [-0.72, 4.18, 0.17], [-1.38, 3.55, 0.19, 'flower'], [-1.3, 4.25, 0.14],
    [-2.3, 2.2, 0.22], [-2.6, 1.05, 0.18], [-1.85, 1.5, 0.24, 'flower'], [-2.9, 1.8, 0.15], [-2.35, 1.55, 0.13], [-2.05, 2.55, 0.16],
    [1.9, 3.9, 0.2], [2.25, 3.3, 0.16, 'bud'], [1.6, 3.45, 0.13], [-0.8, -4.9, 0.22, 'flower'], [0.3, -5.25, 0.18], [-0.2, -4.7, 0.14]];
  pads.forEach(([x, z, r, kind], i) => {
    const grp = new THREE.Group();
    const m = new THREE.Mesh(padGeo(r, i * 1.7, false), padMat); m.castShadow = true; m.receiveShadow = true; grp.add(m);
    // beaded water droplets on top (as in the reference)
    const dg = [];
    for (let k = 0; k < Math.round(3 + r * 22); k++) {
      const a = rand() * Math.PI * 2, rad = Math.sqrt(rand()) * r * 0.82, px = Math.cos(a) * rad, pz = Math.sin(a) * rad;
      if (Math.abs(Math.atan2(pz, px)) < 0.25) continue;
      if (kind === 'frog' && rad < 0.08) continue;
      const s = rr(0.0025, 0.0075), sg = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      sg.scale(s, s * 0.62, s * rr(0.9, 1.15)); sg.translate(px, padSurfaceY(r, px, pz), pz); dg.push(sg);
    }
    if (dg.length) { const dm = new THREE.Mesh(mergeGeos(dg), padDropMat); grp.add(dm); }
    if (kind === 'flower' || kind === 'bud') {
      const open = kind === 'bud' ? 0.12 : rr(0.75, 1.0), sc = rr(0.9, 1.15);
      const fl = new THREE.Group();
      const pm2 = new THREE.Mesh(waterLilyGeo(sc, open), lilyMat); pm2.castShadow = true; fl.add(pm2);
      if (kind !== 'bud') { const st = new THREE.Mesh(stamenGeo(sc), stamenMat); fl.add(st); }
      fl.position.set(r * 0.35, padSurfaceY(r, r * 0.35, 0) + 0.002, -r * 0.2); fl.rotation.y = rand() * 6; fl.userData.flower = true;
      grp.add(fl);
    }
    setLayer(grp, LAYER.SURFACE); grp.traverse((o) => { if (o.userData.flower) { setLayer(o, LAYER.ABOVE); seasonal(o, 'SR'); } }); scene.add(grp);
    seasonal(grp, 'SRA');
    const lily = { mesh: grp, x, z, r, rot: rand() * 6.28, ph: rand() * 10, kind };
    WORLD.lilies.push(lily);
    if (kind === 'frog') WORLD.frogPad = lily;
  });
  // Emergent sacred-lotus leaves (peltate, cupped, above the water on stalks) and a lotus flower
  const LOT = [[-2.75, 0.3, 0.2, 0.34], [-3.0, -0.25, 0.16, 0.24], [-2.5, -0.6, 0.23, 0.42], [-2.95, 0.75, 0.13, 0.18]];
  WORLD.lotus = [];
  LOT.forEach(([x, z, r, h], i) => {
    const grp = new THREE.Group();
    const leaf = new THREE.Mesh(padGeo(r, i * 2.3 + 5, true), lotusMat); leaf.castShadow = leaf.receiveShadow = true;
    leaf.position.y = h; leaf.rotation.set(rr(-0.25, 0.25), rand() * 6, rr(-0.25, 0.25)); grp.add(leaf);
    const dg = [];
    for (let k = 0; k < 4; k++) { const s = rr(0.004, 0.011), a = rand() * 6, rd = rand() * r * 0.3, sg = new THREE.SphereGeometry(1, 16, 10); sg.scale(s, s * 0.8, s); sg.translate(Math.cos(a) * rd, r * 0.28 * (rd / r) ** 2 + s * 0.7, Math.sin(a) * rd); dg.push(sg); }
    const dm = new THREE.Mesh(mergeGeos(dg), dropMat); leaf.add(dm);
    const stalk = taperTube(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.45, 0), new THREE.Vector3(rr(-0.03, 0.03), h * 0.5, rr(-0.03, 0.03)), new THREE.Vector3(0, h, 0)]), 10, 6, 0.006, 0.004, 3);
    const sm = new THREE.Mesh(stalk, stemMat); sm.castShadow = true; grp.add(sm);
    grp.position.set(x, WATER_Y, z);
    setLayer(grp, LAYER.BOTH); scene.add(grp); seasonal(grp, 'SRA');
    WORLD.lotus.push({ leaf, base: leaf.rotation.clone(), ph: rand() * 6, h });
  });
  buildSacredLotus(stemMat);
  // Fallen maple leaves and petals drifting on the surface
  {
    const cv = makeCanvas(128, 128), g = cv.getContext('2d');
    g.fillStyle = '#b8261c'; g.beginPath();
    for (let i = 0; i <= 120; i++) { const a = (i / 120) * Math.PI * 2, lobe = Math.pow(Math.abs(Math.cos(a * 3.5)), 0.6), r = 56 * (0.3 + 0.7 * lobe) * (a > Math.PI * 0.75 && a < Math.PI * 1.25 ? 0.5 : 1); const px = 64 + Math.sin(a) * r, py = 64 - Math.cos(a) * r; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.fill(); g.strokeStyle = 'rgba(70,10,10,0.5)'; g.lineWidth = 1.5;
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.sin(a) * 50, 64 - Math.cos(a) * 50); g.stroke(); }
    const lm = physical({ map: canvasTex(cv), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.4, clearcoat: 0.4 }, { key: 'floatleaf', leaf: true, float: true, uniforms: { uTransl: { value: 0.4 } } });
    const petalFloatMat = physical({ map: lilyPetal, side: THREE.DoubleSide, roughness: 0.42, sheen: 0.8, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xffe2ec) }, { key: 'floatpetal', leaf: true, float: true, uniforms: { uTransl: { value: 0.75 } } });
    const lg = new THREE.PlaneGeometry(0.075, 0.075); lg.rotateX(-Math.PI / 2);
    const pg = petalGeo(0.035, 0.014, 0.003, 0.3);
    WORLD.floaters = [];
    for (let i = 0; i < 18; i++) {
      const isPetal = i >= 12;
      let x, z, guard = 0;
      do { x = isPetal ? rr(-2.9, -1.8) : rr(-3.1, -1.4); z = isPetal ? rr(-1.2, 0.8) : rr(-0.6, 2.8); } while (sdf(x, z) > -0.25 && guard++ < 50);
      const mesh = new THREE.Mesh(isPetal ? pg : lg, isPetal ? petalFloatMat : lm);
      mesh.receiveShadow = true; setLayer(mesh, LAYER.SURFACE); scene.add(mesh); seasonal(mesh, 'SRA');
      WORLD.floaters.push({ mesh, x, z, rot: rand() * 6.28, vx: rr(-0.008, 0.008), vz: rr(-0.008, 0.008), ph: rand() * 6, s: rr(0.75, 1.25) });
    }
  }
  buildFrog();
}
export function updatePondLife(t, dt) {
  // a hand in the water nudges floating pads aside instead of passing through them
  const H = FEED.hand, handIn = H && H.root.visible && HANDCOL.pts.length;
  for (const L of WORLD.lilies || []) {
    if (handIn && L.mesh.visible) {
      let px = 0, pz = 0;
      for (const [p, r] of HANDCOL.pts) {
        if (p.y > WATER_Y + 0.03 + r) continue;
        const dx = L.mesh.position.x - p.x, dz = L.mesh.position.z - p.z, d = Math.hypot(dx, dz) + 1e-4, reach = L.r + r + 0.01;
        if (d < reach) { px += dx / d * (reach - d); pz += dz / d * (reach - d); }
      }
      const pl = Math.hypot(px, pz), cap = 0.35 * dt;                   // pads drift aside at a gentle pace
      if (pl > 1e-5) { const k = Math.min(pl, cap) / pl; L.x += px * k; L.z += pz * k; }
    }
    const x = L.x + 0.03 * Math.sin(t * 0.09 + L.ph), z = L.z + 0.03 * Math.cos(t * 0.07 + L.ph);
    let y = waterHeightAt(x, z, t) + 0.002;
    if (L.dipT !== undefined && L.dipT < 3) { L.dipT += dt; y -= 0.012 * Math.exp(-L.dipT * 2.5) * Math.cos(L.dipT * 11); }
    const e = Math.max(0.08, L.r * 0.7);
    const sx = (waterHeightAt(x + e, z, t) - waterHeightAt(x - e, z, t)) / (2 * e), sz = (waterHeightAt(x, z + e, t) - waterHeightAt(x, z - e, t)) / (2 * e);
    L.mesh.position.set(x, y, z); L.mesh.rotation.set(sz, L.rot + 0.1 * Math.sin(t * 0.05 + L.ph), -sx, 'YXZ');
  }
  for (const L of WORLD.lotus || []) { L.leaf.rotation.x = L.base.x + 0.05 * Math.sin(t * 0.8 + L.ph) * P.windSpeed * (0.5 + SH.uGust.value); L.leaf.rotation.z = L.base.z + 0.04 * Math.sin(t * 0.63 + L.ph * 1.3) * P.windSpeed; }
  if (WORLD.lotusFlower) WORLD.lotusFlower.rotation.z = 0.04 * Math.sin(t * 0.7) * P.windSpeed;
  for (const F of WORLD.floaters || []) {
    F.x += (F.vx + SH.uWindDir.value.x * 0.004 * P.windSpeed) * dt; F.z += (F.vz + SH.uWindDir.value.y * 0.004 * P.windSpeed) * dt;
    if (sdf(F.x, F.z) > -0.15) { F.vx = -F.vx; F.vz = -F.vz; F.x += F.vx * dt * 3; F.z += F.vz * dt * 3; }
    F.rot += dt * 0.02 * Math.sin(F.ph);
    F.mesh.position.set(F.x, waterHeightAt(F.x, F.z, t) + 0.0015, F.z); F.mesh.rotation.set(0, F.rot, 0); F.mesh.scale.setScalar(F.s);
  }
  updateFrog(t, dt);
  updateTurtle(t, dt);
}

