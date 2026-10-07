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
export * from "./plantTextures";
export * from "./trees";
export * from "./iris";
export * from "./lotus";
export * from "./botanical";

import { LEAVES, BARK, addCard, randDir, growTree } from "./trees";
import { buildIrisFlowers } from "./iris";
import { buildBotanical } from "./botanical";
import { ground, PAVILION, BRIDGE, shoreAt, POLY_LEN, terrainHeight } from "./terrain";
import { nearWaterfall } from "./waterfallMesh";
import { SAKURA } from "./fallingPetals";
import { rockMaterial, patchedDepth } from "./materials";
import { meshOf } from "./structures";
import { petalGeo, buildPondLife } from "./pondFlora";

export function buildVegetation() {
  const V3 = THREE.Vector3;
  // --- Red-leaf Japanese maple leaning over the left shore
  {
    const bx = -4.75, bz = 0.9;
    const tips = growTree({ base: new V3(bx, ground(bx, bz) - 0.1, bz), dir: new V3(0.72, 1.0, -0.12).normalize(), len: 2.1, rad: 0.15, depth: 4,
      children: [5, 3, 3, 2], childStart: [0.45, 0.3, 0.35, 0.4], spread: [0.95, 0.85, 0.7, 0.6], upBias: [0.25, 0.1, 0.05, 0.1],
      lenDecay: 0.62, radDecay: 0.62, wiggle: [0.12, 0.25, 0.3, 0.35], gravity: [0.02, -0.06, -0.08, -0.05] });
    for (const t of tips) {
      const k = t.lvl >= 4 ? 7 : 3;
      for (let i = 0; i < k; i++) {
        const p = t.p.clone().add(new V3(rr(-0.45, 0.45), rr(-0.15, 0.18), rr(-0.45, 0.45)));
        const n = new V3(rr(-0.6, 0.6), 1.6, rr(-0.6, 0.6));
        addCard(LEAVES.maple, p, n, rr(0.42, 0.62), new THREE.Color().setRGB(rr(0.85, 1.1), rr(0.75, 1.0), rr(0.8, 1.0)));
      }
    }
  }
  // --- Tall Japanese black pine on the right, cloud-pruned pads
  {
    const bx = 5.3, bz = -1.3;
    const tips = growTree({ base: new V3(bx, ground(bx, bz) - 0.1, bz), dir: new V3(-0.18, 1, 0.05).normalize(), len: 6.4, rad: 0.24, depth: 2,
      children: [11, 4], childStart: [0.42, 0.35], spread: [1.25, 0.7], upBias: [0.05, 0.15], lenDecay: 0.34, radDecay: 0.45,
      wiggle: [0.09, 0.3, 0.3], gravity: [0.0, -0.04, 0.02] });
    for (const t of tips) {
      const padR = rr(0.45, 0.75), k = 22;
      for (let i = 0; i < k; i++) {
        const a = rand() * 6.28, r = Math.sqrt(rand()) * padR;
        const p = t.p.clone().add(new V3(Math.cos(a) * r, rr(-0.08, 0.16) + (1 - r / padR) * 0.12, Math.sin(a) * r));
        addCard(LEAVES.pine, p, new V3(rr(-0.4, 0.4), 1, rr(-0.4, 0.4)), rr(0.36, 0.5), new THREE.Color().setRGB(rr(0.85, 1.05), rr(0.9, 1.05), rr(0.85, 1.0)));
      }
    }
  }
  // --- Background deciduous trees, red maples and a flowering tree; tall conifers behind
  const BG = [[-9, -4, 8, 'green'], [-8.8, 3.8, 6.5, 'maple'], [-10, -10.5, 9, 'green'], [-5.5, -12.5, 10, 'green'], [3.6, -13.5, 9.5, 'green'],
    [8.7, -9.8, 7.5, 'maple'], [10.2, -4.2, 9, 'green'], [9.6, 3.8, 7.5, 'green'], [-12.5, 8.5, 8, 'green'], [12, 9.5, 7, 'green'],
    [-6.4, -7.6, 5.5, 'pink'], [7.2, -6.6, 6.5, 'green'], [-14, -1, 10, 'green'], [15, -1, 10, 'green'], [0.5, -15.5, 11, 'green'], [-3.2, -16.5, 9, 'green'], [6.4, 7.8, 6, 'green']];
  for (const [x, z, h, kind] of BG) {
    const tips = growTree({ base: new V3(x, ground(x, z) - 0.2, z), dir: new V3(rr(-0.1, 0.1), 1, rr(-0.1, 0.1)).normalize(), len: h * 0.45, rad: 0.05 + h * 0.022, depth: 3,
      children: [6, 3, 3], childStart: [0.35, 0.3, 0.3], spread: [0.8, 0.8, 0.7], upBias: [0.5, 0.35, 0.3], lenDecay: 0.58, radDecay: 0.6,
      wiggle: [0.08, 0.25, 0.3], gravity: [0, 0.02, -0.02] });
    const tint = kind === 'green' ? [rr(0.8, 1.15), rr(0.9, 1.1), rr(0.75, 1.0)] : [1, 1, 1];
    for (const t of tips) {
      const k = 6;
      for (let i = 0; i < k; i++) {
        const p = t.p.clone().add(randDir().multiplyScalar(rr(0.2, 0.9)));
        const n = randDir().add(new V3(0, 0.8, 0));
        if (kind === 'pink') addCard(LEAVES.sakura, p, n, rr(0.6, 0.85), new THREE.Color().setRGB(rr(0.98, 1.06), rr(0.84, 0.94), rr(0.88, 0.98)));
        else if (kind === 'maple') addCard(LEAVES.maple, p, n, rr(0.8, 1.1), new THREE.Color().setRGB(rr(0.9, 1.15), rr(0.6, 0.9), rr(0.7, 0.9)));
        else addCard(LEAVES.green, p, n, rr(0.95, 1.35), new THREE.Color().setRGB(tint[0] * rr(0.9, 1.1), tint[1] * rr(0.9, 1.1), tint[2] * rr(0.9, 1.1)));
      }
    }
  }
  // distant ring of trees that closes the garden in (lower detail: two branch levels, big cards)
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rr(-0.08, 0.08), r = rr(19, 27), x = Math.sin(a) * r, z = Math.cos(a) * r * 0.95 - 2;
    if (z > 8 && Math.abs(x) < 6) continue;                      // keep the near-shore view open
    const h = rr(8, 13);
    const tips = growTree({ base: new V3(x, ground(x, z) - 0.2, z), dir: new V3(rr(-0.1, 0.1), 1, rr(-0.1, 0.1)).normalize(), len: h * 0.5, rad: 0.1 + h * 0.02, depth: 2,
      children: [8, 4], childStart: [0.3, 0.25], spread: [0.8, 0.8], upBias: [0.45, 0.3], lenDecay: 0.6, radDecay: 0.6, wiggle: [0.08, 0.25], gravity: [0, 0.02] });
    const tint = [rr(0.75, 1.1), rr(0.85, 1.1), rr(0.7, 1.0)];
    for (const t of tips) for (let k = 0; k < 5; k++) {
      addCard(LEAVES.green, t.p.clone().add(randDir().multiplyScalar(rr(0.3, 1.3))), randDir().add(new V3(0, 0.6, 0)), rr(1.5, 2.1),
        new THREE.Color().setRGB(tint[0] * rr(0.9, 1.1), tint[1] * rr(0.9, 1.1), tint[2] * rr(0.9, 1.1)));
    }
  }
  const CONIFERS = [[-11, -14, 14], [-7, -17.5, 15], [5.5, -17.5, 13], [11.5, -13.5, 12], [14.5, -6, 13], [-15.5, -8, 12], [-2.5, -20, 16]];
  for (const [x, z, h] of CONIFERS) {
    const gy = ground(x, z);
    BARK.push(taperTube(new THREE.CatmullRomCurve3([new V3(x, gy - 0.2, z), new V3(x + 0.1, gy + h * 0.5, z), new V3(x, gy + h * 0.95, z)]), 16, 8, 0.28, 0.04, 1));
    for (let y = 1.2; y < h; y += 0.15) {
      const rad = Math.pow(1 - y / h, 0.85) * 2.1 + 0.25, cnt = Math.round(rad * 5 + 2);
      for (let i = 0; i < cnt; i++) {
        const a = rand() * 6.28, r = rad * Math.sqrt(rr(0.3, 1));
        addCard(LEAVES.conifer, new V3(x + Math.cos(a) * r, gy + y, z + Math.sin(a) * r), new V3(Math.cos(a), 0.9, Math.sin(a)), rr(1.2, 1.7),
          new THREE.Color().setRGB(rr(0.75, 0.95), rr(0.85, 1.0), rr(0.8, 1.0)));
      }
    }
  }

  // ===== Cherry trees (Somei-yoshino and a weeping shidare-zakura), cloud-pruned niwaki, potted bonsai =====
  const OCC = [[-4.75, 0.9, 1.3], [5.3, -1.3, 1.5], [-4.3, -3.3, 0.6], [3.65, -6.9, 0.6], [PAVILION.x, PAVILION.z, PAVILION.r + 0.8],
    [-5.6, 1.9, 1.0], [4.9, 0.2, 0.8], [-3.4, -7.8, 0.9], [3.6, -8.2, 0.75], [5.4, 4.4, 1.0], [-6.2, -2.4, 1.1], [-1.6, 7.6, 0.8]];
  for (const [x, z] of BG) OCC.push([x, z, 1.2]);
  const free = (x, z, r) => !OCC.some(([ox, oz, or]) => Math.hypot(x - ox, z - oz) < or + r) && !nearWaterfall(x, z, 1.6 + r)
    && !(Math.abs(z - BRIDGE.z) < 1.0 + r && Math.abs(x) > BRIDGE.half - 0.4 && Math.abs(x) < BRIDGE.half + 3.0)
    && Math.hypot(x + 0.24, z - 5.3) > 2.2 + r;
  const SAK_BARK = [];
  SAKURA.spawn = [];
  const sakuraTree = (x, z, h, weeping) => {
    const gy = ground(x, z), nb = BARK.length;
    const lean = new V3(-sdfGradX(x, z), 0, -sdfGradZ(x, z)).multiplyScalar(0.28);          // lean toward the water
    const tips = weeping
      ? growTree({ base: new V3(x, gy - 0.1, z), dir: new V3(lean.x * 0.5, 1, lean.z * 0.5).normalize(), len: h * 0.42, rad: 0.12 + h * 0.012, depth: 4,
          children: [5, 3, 3, 2], childStart: [0.6, 0.3, 0.2, 0.2], spread: [1.05, 0.9, 0.5, 0.35], upBias: [0.45, 0.35, -0.4, -0.8],
          lenDecay: 0.78, radDecay: 0.6, wiggle: [0.08, 0.2, 0.12, 0.12], gravity: [0.0, -0.02, -0.28, -0.45] })
      : growTree({ base: new V3(x, gy - 0.1, z), dir: new V3(lean.x, 1, lean.z).normalize(), len: h * 0.36, rad: 0.1 + h * 0.013, depth: 4,
          children: [5, 3, 3, 2], childStart: [0.55, 0.3, 0.3, 0.3], spread: [1.05, 0.85, 0.75, 0.6], upBias: [0.3, 0.18, 0.12, 0.1],
          lenDecay: 0.66, radDecay: 0.62, wiggle: [0.1, 0.25, 0.3, 0.35], gravity: [0.0, -0.03, -0.05, -0.06] });
    SAK_BARK.push(...BARK.splice(nb));
    const col = () => new THREE.Color().setRGB(rr(0.98, 1.06), rr(0.84, 0.94), rr(0.88, 0.98));
    if (weeping) {
      // flowers strung along the hanging whips, denser toward their tips
      for (const b of tips.branches) {
        if (b.lvl < 2) continue;
        for (let t = 0.15; t <= 1.0; t += 0.1) {
          const p = b.curve.getPointAt(t), n = randDir().add(new V3(0, 0.3, 0));
          addCard(LEAVES.sakura, p.add(randDir().multiplyScalar(0.05)), n, rr(0.22, 0.34), col());
          if (rand() < 0.3) SAKURA.spawn.push(p.clone());
        }
      }
    } else {
      for (const t of tips) {
        const k = t.lvl >= 4 ? 11 : 5;
        for (let i = 0; i < k; i++) {
          const p = t.p.clone().add(new V3(rr(-0.36, 0.36), rr(-0.14, 0.24), rr(-0.36, 0.36)));
          addCard(LEAVES.sakura, p, new V3(rr(-0.8, 0.8), 1.2, rr(-0.8, 0.8)), rr(0.38, 0.56), col());
          if (i === 0) SAKURA.spawn.push(p.clone());
        }
      }
      // blossom also clothes the outer limbs themselves, not only the twig ends
      for (const b of tips.branches) {
        if (b.lvl < 2) continue;
        for (let t = 0.3; t < 1.0; t += 0.2) addCard(LEAVES.sakura, b.curve.getPointAt(t).add(randDir().multiplyScalar(0.12)), randDir().add(new V3(0, 0.9, 0)), rr(0.32, 0.46), col());
      }
    }
    OCC.push([x, z, 0.8]);
  };
  const sdfGradX = (x, z) => (sdf(x + 0.05, z) - sdf(x - 0.05, z)) / 0.1, sdfGradZ = (x, z) => (sdf(x, z + 0.05) - sdf(x, z - 0.05)) / 0.1;
  sakuraTree(5.3, 2.6, 4.4, false);
  sakuraTree(-6.9, -1.0, 4.6, true);
  sakuraTree(-3.6, -10.4, 4.8, false);
  sakuraTree(5.4, -8.7, 4.2, false);
  sakuraTree(-6.6, 3.3, 3.8, false);
  sakuraTree(1.9, -12.2, 4.0, true);

  // cloud-pruned niwaki: an S-curved trunk, a few near-horizontal limbs, each ending in a flat-bottomed foliage cloud
  const padBase = rockGeo(5.1, 3, -0.2);
  const padGeos = [];
  const cloudPad = (c, rx, ry, rz, cardSize) => {
    const g = padBase.clone(), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const s2 = 1 + 0.06 * fbm3(p.getX(i) * 3 + c.x, p.getY(i) * 3, p.getZ(i) * 3 + c.z, 2, 3); p.setXYZ(i, p.getX(i) * rx * s2, p.getY(i) * ry * s2, p.getZ(i) * rz * s2); }
    g.computeVertexNormals(); g.translate(c.x, c.y, c.z); padGeos.push(g);
    const n = Math.round(24 + rx * rz * 260);
    for (let i = 0; i < n; i++) {
      const d = randDir(); if (d.y < 0) d.y *= -0.25;
      const nn = new V3(d.x / rx, d.y / ry, d.z / rz).normalize();
      addCard(LEAVES.pine, new V3(c.x + d.x * rx, c.y + d.y * ry, c.z + d.z * rz).addScaledVector(nn, cardSize * 0.08), nn.clone().add(new V3(0, 0.6, 0)), cardSize * rr(0.8, 1.1),
        new THREE.Color().setRGB(rr(0.8, 1.0), rr(0.9, 1.08), rr(0.8, 0.95)));
    }
  };
  const niwaki = (x, z, h, scale = 1) => {
    const gy = ground(x, z), ph = rand() * 6;
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new V3(x + Math.sin(t * 3.4 + ph) * 0.13 * t * scale, gy - 0.05 + t * h, z + Math.cos(t * 2.9 + ph) * 0.11 * t * scale)); }
    const trunk = new THREE.CatmullRomCurve3(pts);
    BARK.push(taperTube(trunk, 30, 10, 0.05 + 0.03 * h * scale, 0.02 * scale, 1.2));
    const top = trunk.getPointAt(1);
    cloudPad(top.clone().add(new V3(0, 0.05 * scale, 0)), 0.3 * scale, 0.17 * scale, 0.28 * scale, 0.26 * scale);
    const nL = 4 + (rand() * 3 | 0);
    for (let k = 0; k < nL; k++) {
      const t = lerp(0.32, 0.86, k / (nL - 1)), s = trunk.getPointAt(t), a = k * 2.4 + ph, L = (0.35 + 0.45 * (1 - t)) * scale * rr(0.85, 1.15);
      const e = new V3(s.x + Math.cos(a) * L, s.y + rr(0.02, 0.1) * scale, s.z + Math.sin(a) * L);
      const mid = new V3(s.x + Math.cos(a) * L * 0.5, s.y - 0.03 * scale, s.z + Math.sin(a) * L * 0.5);
      BARK.push(taperTube(new THREE.CatmullRomCurve3([s, mid, e]), 10, 7, 0.028 * scale, 0.012 * scale, 1.2));
      const pr = (0.2 + 0.18 * (1 - t)) * scale;
      cloudPad(e.clone().add(new V3(0, 0.04 * scale, 0)), pr, pr * 0.45, pr * rr(0.8, 1.0), 0.22 * scale);
    }
    OCC.push([x, z, 0.9 * scale]);
  };
  niwaki(-2.5, -9.9, 1.9); niwaki(5.0, -5.2, 1.6); niwaki(-4.2, 5.8, 1.7); niwaki(2.6, -10.6, 1.4, 0.85);

  // potted bonsai on a granite display bench by the bridge
  {
    const bx = 3.95, bz = -2.75, gy = ground(bx, bz), yaw = 0.35;
    const benchParts = [roundedBox(0.95, 0.07, 0.34, 0.012, 11).translate(0, 0.395, 0), roundedBox(0.14, 0.36, 0.3, 0.015, 12).translate(-0.33, 0.18, 0), roundedBox(0.14, 0.36, 0.3, 0.015, 13).translate(0.33, 0.18, 0)];
    const bench = new THREE.Mesh(mergeGeos(benchParts), WORLD.granite); bench.position.set(bx, gy - 0.01, bz); bench.rotation.y = yaw;
    bench.castShadow = bench.receiveShadow = true; setLayer(bench, LAYER.ABOVE); scene.add(bench);
    const potMat = [physical({ color: 0x2f3d4c, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 }, { key: 'potglaze' }), physical({ color: 0x5b3a28, roughness: 0.8 }, { key: 'potclay' })];
    const soilMat = rockMaterial(TEX.moss ? TEX.moss : TEX.hedge, { key: 'bonsaimoss', scale: 6, moss: 1.0, rough: 0.95, nrm: 0.8 });
    [[-0.22, 0, 0.34, 0.24, 0], [0.24, 0.3, 0.3, 0.22, 1]].forEach(([ox, ry, pw, pd, mi], k) => {
      const c = Math.cos(yaw), s = Math.sin(yaw), px = bx + ox * c, pz = bz - ox * s, py = gy + 0.43;
      const pot = new THREE.Mesh(mergeGeos([roundedBox(pw, 0.075, pd, 0.012, 20 + k).translate(0, 0.0375 + 0.012, 0),
        roundedBox(0.04, 0.014, 0.04, 0.004, 1).translate(pw * 0.36, 0.006, pd * 0.34), roundedBox(0.04, 0.014, 0.04, 0.004, 2).translate(-pw * 0.36, 0.006, pd * 0.34),
        roundedBox(0.04, 0.014, 0.04, 0.004, 3).translate(pw * 0.36, 0.006, -pd * 0.34), roundedBox(0.04, 0.014, 0.04, 0.004, 4).translate(-pw * 0.36, 0.006, -pd * 0.34)]), potMat[mi]);
      pot.position.set(px, py, pz); pot.rotation.y = yaw + ry; pot.castShadow = pot.receiveShadow = true; setLayer(pot, LAYER.ABOVE); scene.add(pot);
      const soil = new THREE.Mesh(new THREE.BoxGeometry(pw - 0.03, 0.012, pd - 0.03).translate(0, 0.085, 0), soilMat); soil.position.copy(pot.position); soil.rotation.y = pot.rotation.y; soil.receiveShadow = true; setLayer(soil, LAYER.ABOVE); scene.add(soil);
      // informal-upright trunk with a dramatic lean, three to four branches and small foliage clouds
      const b0 = new V3(px, py + 0.085, pz), ph = k * 2.1 + 0.5, H = k ? 0.25 : 0.31;
      const pts = [];
      for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new V3(b0.x + Math.sin(t * 4.2 + ph) * 0.06 * t + t * 0.05, b0.y + t * H, b0.z + Math.cos(t * 3.6 + ph) * 0.05 * t)); }
      const trunk = new THREE.CatmullRomCurve3(pts);
      BARK.push(taperTube(trunk, 24, 9, 0.04, 0.011, 3));
      // exposed surface roots (nebari)
      for (let r = 0; r < 5; r++) { const a = r * 1.26 + ph, e = new V3(b0.x + Math.cos(a) * 0.07, b0.y - 0.004, b0.z + Math.sin(a) * 0.07); BARK.push(taperTube(new THREE.CatmullRomCurve3([b0.clone().add(new V3(0, 0.03, 0)), b0.clone().add(new V3(Math.cos(a) * 0.03, 0.008, Math.sin(a) * 0.03)), e]), 6, 5, 0.012, 0.003, 3)); }
      const top = trunk.getPointAt(1);
      cloudPad(top.clone().add(new V3(0, 0.02, 0)), 0.1, 0.055, 0.09, 0.09);
      for (let j = 0; j < 4; j++) {
        const t = 0.36 + j * 0.15, sp = trunk.getPointAt(t), a = j * 2.3 + ph, L = 0.11 + 0.09 * (1 - t);
        const e = new V3(sp.x + Math.cos(a) * L, sp.y + 0.02, sp.z + Math.sin(a) * L);
        BARK.push(taperTube(new THREE.CatmullRomCurve3([sp, new V3(sp.x + Math.cos(a) * L * 0.5, sp.y - 0.01, sp.z + Math.sin(a) * L * 0.5), e]), 6, 5, 0.009, 0.004, 3));
        cloudPad(e.clone().add(new V3(0, 0.015, 0)), 0.08, 0.038, 0.07, 0.08);
      }
    });
    OCC.push([bx, bz, 0.7]);
  }
  if (padGeos.length) meshOf(padGeos, rockMaterial(TEX.hedge, { key: 'hedge', hedge: true, scale: 2.6, nrm: 1.4, rough: 0.72, bloom: 0 }), LAYER.ABOVE);

  // --- Clipped azalea mounds (green, three in bloom)
  const AZ = [[3.7, 3.4, 0.7, 0.5, 0.6, null], [4.2, 1.5, 0.9, 0.6, 0.8, 0xe8702a], [3.9, 5.7, 0.6, 0.48, 0.6, null], [4.0, -2.1, 0.6, 0.48, 0.55, null],
    [3.2, -5.4, 0.8, 0.6, 0.7, 0xc0186a], [-3.0, -5.4, 0.7, 0.5, 0.7, null], [-3.5, -2.3, 0.55, 0.45, 0.5, 0xe9869f], [-4.4, 3.4, 0.7, 0.5, 0.6, null],
    [-4.9, -1.2, 0.6, 0.45, 0.6, null], [2.6, -7.3, 0.7, 0.52, 0.6, null], [-2.0, -7.5, 0.6, 0.5, 0.6, null], [6.3, -3.6, 1.0, 0.75, 0.9, null], [-6.5, -4.2, 1.1, 0.8, 1.0, null], [2.2, 7.4, 0.8, 0.55, 0.7, null]];
  // more clipped shrubs: satsuki azalea mounds (some in bloom, white / pink / magenta / coral), low o-karikomi groups and boxwood balls
  {
    const blooms = [0xe9869f, 0xf4eef0, 0xc0186a, 0xe8702a, 0xf2a6c2];
    for (const [x, z, r] of AZ) OCC.push([x, z, r + 0.15]);
    let n = 0, guard = 0;
    while (n < 38 && guard++ < 6000) {
      const x = rr(-8.5, 8.5), z = rr(-12, 8.5), sd = sdf(x, z);
      if (sd < 0.9 || sd > 5.5) continue;
      const kind = rand(), group = kind < 0.25 ? 3 : 1;
      const r0 = kind > 0.8 ? rr(0.22, 0.32) : rr(0.4, 0.75);
      if (!free(x, z, r0 * (group > 1 ? 1.8 : 1))) continue;
      const bloom = kind > 0.8 ? null : rand() < 0.35 ? blooms[(rand() * blooms.length) | 0] : null;
      for (let g = 0; g < group; g++) {
        const a = g * 2.2 + rand(), d = g ? r0 * rr(0.8, 1.1) : 0, rx = r0 * (g ? rr(0.6, 0.8) : 1);
        const yy = kind > 0.8 ? rx * 0.95 : rx * rr(0.62, 0.75);
        AZ.push([x + Math.cos(a) * d, z + Math.sin(a) * d, rx, yy, rx * rr(0.85, 1.05), g ? null : bloom]);
      }
      OCC.push([x, z, r0 * (group > 1 ? 1.8 : 1)]); n++;
    }
  }
  const hedgeGreen = [];
  const base = rockGeo(3.3, 4, -0.25);
  for (const [ax, az, rx, ry, rz, bloom] of AZ) {
    if (nearWaterfall(ax, az, 1.5)) continue;
    let x = ax, z = az; const sd = sdf(x, z);
    if (sd < Math.max(rx, rz) + 0.35) { const g = 0.02, gx = (sdf(x + g, z) - sdf(x - g, z)) / (2 * g), gz = (sdf(x, z + g) - sdf(x, z - g)) / (2 * g), push = Math.max(rx, rz) + 0.35 - sd; x += gx * push; z += gz * push; }
    const gy = ground(x, z);
    const geo = base.clone(); const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const s2 = 1 + 0.04 * fbm3(p.getX(i) * 3 + x, p.getY(i) * 3, p.getZ(i) * 3, 2, 7); p.setXYZ(i, p.getX(i) * rx * s2 * 0.82, p.getY(i) * ry * s2 * 0.82, p.getZ(i) * rz * s2 * 0.82); }
    geo.computeVertexNormals(); geo.translate(x, gy + ry * 0.12, z);
    if (bloom) {
      const m = rockMaterial(TEX.hedge, { key: 'hedge', hedge: true, scale: 2.6, nrm: 1.4, rough: 0.72, bloom: 1, bloomColor: bloom }); WORLD.bloomMats.push(m);
      const mesh = new THREE.Mesh(geo, m); mesh.castShadow = mesh.receiveShadow = true; setLayer(mesh, LAYER.ABOVE); scene.add(mesh);
    } else hedgeGreen.push(geo);
    // leafy shell to break the silhouette (+ flower cards on blooming mounds)
    for (let i = 0; i < 80; i++) {
      const d = randDir(); if (d.y < -0.15) d.y = -d.y * 0.3;
      const e = new V3(d.x * rx * 0.82, d.y * ry * 0.82, d.z * rz * 0.82);
      const n = new V3(d.x / rx, d.y / ry, d.z / rz).normalize();
      const pp = e.add(new V3(x, gy + ry * 0.12, z)).addScaledVector(n, 0.02);
      addCard(LEAVES.shrub, pp, n, rr(0.2, 0.3), new THREE.Color().setRGB(rr(0.85, 1.1), rr(0.9, 1.1), rr(0.85, 1.0)));
      if (bloom && i % 2 === 0) addCard(LEAVES.bloom, pp.clone().addScaledVector(n, 0.03), n, rr(0.22, 0.32), new THREE.Color(bloom).multiplyScalar(rr(0.9, 1.15)));
    }
  }
  if (hedgeGreen.length) meshOf(hedgeGreen, rockMaterial(TEX.hedge, { key: 'hedge', hedge: true, scale: 2.6, nrm: 1.4, rough: 0.72, bloom: 0 }), LAYER.ABOVE);

  buildBotanical(OCC, free, V3);

  // --- Bark (all trees in one mesh)
  const barkMat = physical({ map: TEX.bark.map, normalMap: TEX.bark.normalMap, normalScale: new THREE.Vector2(1.5, 1.5), roughness: 0.92, color: 0xb8aaa0, envMapIntensity: 0.6 },
    { key: 'bark', wind: 'world', windWeight: 'clamp((wPos4.y - 1.5) * 0.05, 0.0, 0.35)' });
  const barkMesh = meshOf(BARK, barkMat, LAYER.ABOVE);
  barkMesh.customDepthMaterial = patchedDepth({ key: 'barkd', wind: true, windWeight: 'clamp((wPos4.y - 1.5) * 0.05, 0.0, 0.35)' });
  if (SAK_BARK.length) {
    const sm = physical({ map: TEX.sakuraBark.map, normalMap: TEX.sakuraBark.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.8, envMapIntensity: 0.6 },
      { key: 'barksak', wind: 'world', windWeight: 'clamp((wPos4.y - 1.5) * 0.05, 0.0, 0.35)' });
    const sbm = meshOf(SAK_BARK, sm, LAYER.ABOVE);
    sbm.customDepthMaterial = patchedDepth({ key: 'barkd', wind: true, windWeight: 'clamp((wPos4.y - 1.5) * 0.05, 0.0, 0.35)' });
  }

  // --- Leaf-card instanced meshes (alpha-tested, double sided, translucent, wind-swayed)
  const cardGeo = new THREE.PlaneGeometry(1, 1, 4, 4);
  { const cp = cardGeo.attributes.position; for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i); cp.setZ(i, 0.2 * (x * x + y * y) - 0.05 * y); } cardGeo.computeVertexNormals(); }   // cupped, not flat
  const leafSets = [['maple', TEX.mapleLeaves, 0.45, 0x8a2a2a], ['pine', TEX.pineNeedles, 0.22, 0x5a7040], ['green', TEX.greenLeaves, 0.35, 0x86a050],
    ['conifer', TEX.conifer, 0.18, 0x4a6040], ['shrub', TEX.shrubLeaves, 0.25, 0x6a8a40], ['bloom', TEX.bloomLeaves, 0.4, 0xffc0d0], ['sakura', TEX.sakura, 0.95, 0xffd0dc], ['hydrangea', TEX.hydrangea, 0.55, 0xd0d8ff], ['bigleaf', TEX.bigleaf, 0.4, 0x90b060], ['camellia', TEX.camellia, 0.25, 0x406030], ['kikyo', TEX.kikyo, 0.5, 0xb0a0f0]];
  WORLD.leafMats = [];
  for (const [name, tex, transl, sheen] of leafSets) {
    const list = LEAVES[name]; if (!list.length) continue;
    const ww = 'clamp((wPos4.y - 0.2) * 0.2, 0.0, 1.3)';
    const mat = physical({ map: tex, alphaTest: 0.45, alphaToCoverage: P.quality === 'High', side: THREE.DoubleSide, roughness: 0.62, envMapIntensity: 0.55 },
      { key: 'leaf', leaf: true, wind: 'world', windWeight: ww, uniforms: { uTransl: { value: transl }, uDecid: { value: { maple: 0.6, green: 1, bigleaf: 1, shrub: 0.35 }[name] || 0 } },
        fsMap: 'diffuseColor.a *= smoothstep(0.2, 0.45, abs(dot(normalize(vNormal), normalize(vViewPosition))));' });   // hide cards seen edge-on
    WORLD.leafMats.push(mat);
    const im = new THREE.InstancedMesh(cardGeo, mat, list.length);
    list.forEach((e, i) => { im.setMatrixAt(i, e.m); im.setColorAt(i, e.c); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    // low card shells sit on shadow-casting mounds already: their own shadow pass isn't worth its cost
    const low = ['bigleaf', 'hydrangea', 'kikyo', 'camellia'].includes(name);
    WORLD.leafMesh[name] = im;
    seasonal(im, { maple: 'SRA', green: 'SRA', sakura: 'SRA', bloom: 'SR', hydrangea: 'SRA', bigleaf: 'SRA', kikyo: 'SR' }[name] || 'SRAW');
    im.castShadow = !low; im.receiveShadow = true; if (low) WORLD.noReflect.push(im);
    im.customDepthMaterial = patchedDepth({ key: 'leafd', wind: true, windWeight: ww }, tex, 0.45);
    im.computeBoundingSphere();
    setLayer(im, LAYER.ABOVE); scene.add(im);
  }

  // --- Shade plants along the banks: ferns (arching pinnate fronds) and variegated hostas
  {
    const M = new THREE.Matrix4(), Qb = new THREE.Quaternion(), Eb = new THREE.Euler(), Sb = new THREE.Vector3(), Pb = new THREE.Vector3();
    const fcv = makeCanvas(256, 512), fg = fcv.getContext('2d');
    fg.strokeStyle = '#3f5a22'; fg.lineWidth = 5; fg.beginPath(); fg.moveTo(128, 512); fg.lineTo(128, 6); fg.stroke();
    for (let k = 0; k < 26; k++) {
      const y = 500 - k * 19, len = 118 * Math.sin(Math.PI * Math.min(1, (k + 2) / 27)) * (1 - k / 34);
      for (const sd of [-1, 1]) {
        fg.fillStyle = `hsl(${88 + k * 0.8 + (sd > 0 ? 3 : 0)}, 45%, ${24 + k * 0.5}%)`;
        for (let j = 0; j < 9; j++) { const t = j / 9, x = 128 + sd * (8 + t * len), yy = y - t * 22 - 6, r = (1 - t) * 8 + 3; fg.beginPath(); fg.ellipse(x, yy, r * 1.1, r * 0.8, sd * 0.4, 0, Math.PI * 2); fg.fill(); }
      }
    }
    const fernTex = canvasTex(fcv);
    const fernMat = physical({ map: fernTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0xa8c070) },
      { key: 'fern', leaf: true, wind: 'local', windWeight: 'uv.y * uv.y * 0.6', uniforms: { uTransl: { value: 0.45 } } });
    const frond = (L, W) => {
      const nu = 10, pos = [], uv = [], idx = [];
      for (let i = 0; i <= nu; i++) { const t = i / nu, y = L * (0.9 * t - 0.75 * t * t * t), x = L * 0.85 * t, w = W * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05));
        pos.push(x, y, -w / 2, x, y, w / 2); uv.push(0, t, 1, t); }
      for (let i = 0; i < nu; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
    };
    const fernGeo = frond(0.55, 0.2), fm = [], fc = [];
    const spots = [[-4.1, 1.9], [-4.3, -0.4], [-3.7, -2.9], [-2.4, -6.4], [2.6, -6.2], [4.6, -2.4], [4.2, 4.6], [-3.6, 4.4], [1.2, 6.6], [-5.2, 2.8]];
    for (const [cx0, cz0] of spots) {
      if (nearWaterfall(cx0, cz0, 1.2)) continue;
      let cx = cx0, cz = cz0; const sd = sdf(cx, cz); if (sd < 0.45) { const e = 0.03, gx = (sdf(cx + e, cz) - sdf(cx - e, cz)) / (2 * e), gz = (sdf(cx, cz + e) - sdf(cx, cz - e)) / (2 * e); cx += gx * (0.6 - sd); cz += gz * (0.6 - sd); }
      const n = 10 + (rand() * 6 | 0), gy = ground(cx, cz) - 0.01;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rr(-0.2, 0.2), sc = rr(0.7, 1.15);
        Pb.set(cx + Math.cos(a) * 0.04, gy, cz - Math.sin(a) * 0.04); Eb.set(0, a, rr(-0.15, 0.25), 'YXZ'); Qb.setFromEuler(Eb); Sb.set(sc, sc * rr(0.85, 1.15), sc);
        fm.push(M.compose(Pb, Qb, Sb).clone()); fc.push(new THREE.Color().setRGB(rr(0.85, 1.1), rr(0.9, 1.1), rr(0.8, 1.0)));
      }
    }
    const fim = new THREE.InstancedMesh(fernGeo, fernMat, fm.length);
    fm.forEach((mm, i) => { fim.setMatrixAt(i, mm); fim.setColorAt(i, fc[i]); });
    fim.castShadow = fim.receiveShadow = true; fim.customDepthMaterial = patchedDepth({ key: 'fernd', wind: true, windWeight: 'uv.y * uv.y * 0.6' }, fernTex, 0.45);
    fim.computeBoundingSphere(); setLayer(fim, LAYER.ABOVE); scene.add(fim);
    // hostas: broad heart-shaped leaves with creamy margins and curved parallel veins
    const hcv = makeCanvas(256, 256), hg2 = hcv.getContext('2d');
    hg2.fillStyle = '#e6e2b8'; hg2.beginPath(); hg2.moveTo(128, 250); hg2.bezierCurveTo(250, 200, 240, 40, 128, 6); hg2.bezierCurveTo(16, 40, 6, 200, 128, 250); hg2.fill();
    hg2.fillStyle = '#3d6a3a'; hg2.beginPath(); hg2.moveTo(128, 236); hg2.bezierCurveTo(228, 196, 220, 52, 128, 22); hg2.bezierCurveTo(36, 52, 28, 196, 128, 236); hg2.fill();
    hg2.strokeStyle = 'rgba(20,50,25,0.45)'; hg2.lineWidth = 2;
    for (let k = -5; k <= 5; k++) { hg2.beginPath(); hg2.moveTo(128, 240); hg2.quadraticCurveTo(128 + k * 22, 130, 128 + k * 4, 24); hg2.stroke(); }
    const hostaMat = physical({ map: canvasTex(hcv), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, clearcoat: 0.25, sheen: 0.3, sheenColor: new THREE.Color(0xc0e0b0) },
      { key: 'hosta', leaf: true, wind: 'local', windWeight: 'uv.y * 0.3', uniforms: { uTransl: { value: 0.35 } } });
    const hleaf = petalGeo(0.22, 0.075, 0.05, 1.2); hleaf.rotateX(-0.3);
    { const hu = hleaf.attributes.uv; for (let i = 0; i < hu.count; i++) hu.setXY(i, hu.getX(i), hu.getY(i)); }
    const hm = [];
    for (const [cx, cz] of [[-4.6, -1.6], [5.1, 1.5], [-2.2, -7.7], [2.9, 6.1], [-5.4, 0.6], [6.4, -1.2]]) {
      if (sdf(cx, cz) < 0.5) continue;
      const gy = ground(cx, cz);
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 + rr(-0.2, 0.2); Pb.set(cx, gy + 0.02, cz); Eb.set(rr(-0.5, -0.1), a, 0, 'YXZ'); Qb.setFromEuler(Eb); const sc = rr(0.8, 1.2); Sb.set(sc, sc, sc); hm.push(M.compose(Pb, Qb, Sb).clone()); }
    }
    const him = new THREE.InstancedMesh(hleaf, hostaMat, hm.length);
    hm.forEach((mm, i) => him.setMatrixAt(i, mm));
    him.castShadow = him.receiveShadow = true; him.computeBoundingSphere(); setLayer(him, LAYER.ABOVE); scene.add(him);
  }
  // --- Ornamental grasses (land) and iris at the waterline
  const blade = (h, w, bend, segs = 6) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, y = h * t * (1 - 0.15 * t * t), x = bend * t * t, wd = w * Math.pow(1 - t, 0.7) + 0.002;
      pos.push(x, y, -wd / 2, x, y, wd / 2); uv.push(0, t, 1, t);
    }
    for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const grassM = [], irisM = [], grassC = [], irisC = [];
  const M = new THREE.Matrix4(), Qb = new THREE.Quaternion(), Eb = new THREE.Euler(), Sb = new THREE.Vector3(), Pb = new THREE.Vector3();
  const grassSpots = [0.06, 0.12, 0.2, 0.27, 0.33, 0.45, 0.52, 0.6, 0.66, 0.74, 0.97];
  for (const u of grassSpots) {
    const sh = shoreAt(u * POLY_LEN), d = rr(0.45, 0.8), cx = sh.x + sh.nx * d, cz = sh.z + sh.nz * d;
    if (Math.abs(cz - BRIDGE.z) < 0.9 && Math.abs(cx) < BRIDGE.half + 0.4) continue;
    const gy = ground(cx, cz);
    for (let i = 0; i < 70; i++) {
      const a = rand() * 6.28, r = Math.sqrt(rand()) * 0.22;
      Pb.set(cx + Math.cos(a) * r, gy - 0.02, cz + Math.sin(a) * r);
      Eb.set(0, a + rr(-0.4, 0.4), 0); Qb.setFromEuler(Eb);
      const hs = rr(0.7, 1.15); Sb.set(1, hs, 1);
      grassM.push(M.compose(Pb, Qb, Sb).clone()); grassC.push(new THREE.Color().setRGB(rr(0.85, 1.1), rr(0.85, 1.05), rr(0.7, 0.95)));
    }
  }
  // Japanese water iris (Iris ensata / laevigata): equitant fans of sword leaves rising from the shallows
  const irisSpots = [0.78, 0.84, 0.9, 0.57, 0.64, 0.99];
  const irisClumps = [];
  for (const u of irisSpots) {
    const sh = shoreAt(u * POLY_LEN), cx = sh.x - sh.nx * 0.28, cz = sh.z - sh.nz * 0.28;
    irisClumps.push({ x: cx, z: cz, nx: sh.nx, nz: sh.nz }); WORLD.irisClumps = irisClumps;
    const fans = 4 + (rand() * 2 | 0);
    for (let f = 0; f < fans; f++) {
      const a = rand() * 6.28, r = Math.sqrt(rand()) * 0.11, fanYaw = rand() * Math.PI, nL = 4 + (rand() * 3 | 0);
      for (let i = 0; i < nL; i++) {
        const k = nL > 1 ? i / (nL - 1) * 2 - 1 : 0;                    // -1..1 across the fan
        // rooted in the pond floor (never floating in mid-water), tips at the same height above the surface
        const lx = cx + Math.cos(a) * r + k * 0.006, lz = cz + Math.sin(a) * r, floorY = Math.min(WATER_Y - 0.25, terrainHeight(lx, lz) - 0.02);
        Pb.set(lx, floorY, lz);
        Eb.set(k * 0.3 + rr(-0.05, 0.05), fanYaw + (rand() < 0.5 ? 0 : Math.PI), 0, 'YXZ'); Qb.setFromEuler(Eb);
        Sb.set(1, (1 - Math.abs(k) * 0.3) * rr(0.85, 1.12) - 0.25 - floorY, 1);
        irisM.push(M.compose(Pb, Qb, Sb).clone()); irisC.push(new THREE.Color().setRGB(rr(0.88, 1.04), rr(0.9, 1.05), rr(0.86, 1.0)));
      }
    }
  }
  const bladeMatFor = (tex, key, H) => {
    const ww = `pow(clamp(position.y / ${H.toFixed(2)}, 0.0, 1.0), 1.6)`;
    const m = physical({ map: tex, side: THREE.DoubleSide, roughness: 0.6, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xb0c070), envMapIntensity: 0.6 },
      { key, leaf: true, decid: 0.7, wind: 'local', windWeight: ww, uniforms: { uTransl: { value: 0.35 } } });
    return [m, patchedDepth({ key: key + 'd', wind: true, windWeight: ww })];
  };
  const mkBlades = (geo, tex, key, H, mats, cols, layer) => {
    const [m, dm] = bladeMatFor(tex, key, H);
    const im = new THREE.InstancedMesh(geo, m, mats.length);
    mats.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, cols[i]); });
    im.castShadow = im.receiveShadow = true; im.customDepthMaterial = dm; im.computeBoundingSphere();
    setLayer(im, layer); scene.add(im);
  };
  mkBlades(blade(0.62, 0.018, 0.32), TEX.blade, 'grass', 0.62, grassM, grassC, LAYER.ABOVE);
  // short lawn tufts scattered around the pond so the ground holds up in close-ups
  {
    const parts = [];
    for (let b = 0; b < 7; b++) { const g = blade(rr(0.045, 0.1), rr(0.003, 0.005), rr(0.005, 0.03), 3); g.rotateY(rand() * Math.PI * 2); g.translate(rr(-0.02, 0.02), 0, rr(-0.02, 0.02)); parts.push(g); }
    const tuft = mergeGeos(parts);
    const [tm] = bladeMatFor(TEX.blade, 'tuft', 0.1);
    const mats = [], cols = [];
    const avoid = [[PAVILION.x, PAVILION.z, PAVILION.r + 0.9]];
    let guard = 0;
    while (mats.length < 2800 && guard++ < 40000) {
      const x = rr(-9, 9), z = rr(-12, 10), sd = sdf(x, z);
      if (sd < 0.35 || sd > 6.5 || nearWaterfall(x, z, 1.0) || avoid.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)) continue;
      if (Math.abs(z - BRIDGE.z) < 0.9 && Math.abs(Math.abs(x) - BRIDGE.half) < 0.6) continue;
      const clumpy = fbm3(x * 0.8, 1, z * 0.8, 2, 44);
      if (clumpy < -0.05 && rand() < 0.7) continue;
      Pb.set(x, ground(x, z) - 0.005, z); Eb.set(rr(-0.1, 0.1), rand() * 6.28, rr(-0.1, 0.1)); Qb.setFromEuler(Eb); const sc = rr(0.7, 1.4); Sb.set(sc, sc * rr(0.8, 1.3), sc);
      mats.push(M.compose(Pb, Qb, Sb).clone()); cols.push(new THREE.Color().setRGB(rr(0.62, 0.85), rr(0.72, 0.95), rr(0.5, 0.7)));
    }
    const im = new THREE.InstancedMesh(tuft, tm, mats.length);
    mats.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, cols[i]); });
    im.receiveShadow = true; im.computeBoundingSphere(); setLayer(im, LAYER.ABOVE); scene.add(im);
  }
  // sword leaf: parallel-sided with a keeled midrib, tapering only in the last quarter to a sharp tip; tips arch over
  const irisLeaf = (() => {
    const segs = 10, pos = [], uv = [], idx = [], h = 1.0, w = 0.024;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, y = h * t * (1 - 0.1 * t * t), x = 0.16 * Math.pow(t, 2.2), wd = w * (0.75 + 0.25 * smoothstep(0, 0.12, t)) * (1 - smoothstep(0.62, 1.0, t)) + 0.0008;
      const keel = 0.0035 * (1 - t);
      pos.push(x, y, -wd / 2, x - keel, y, 0, x, y, wd / 2); uv.push(0, t, 0.5, t, 1, t);
    }
    for (let i = 0; i < segs; i++) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  })();
  mkBlades(irisLeaf, TEX.iris, 'irisleaf', 1.0, irisM, irisC, LAYER.BOTH);
  buildIrisFlowers(irisClumps);

  buildPondLife();
}

