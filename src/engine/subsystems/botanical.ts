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
import { irisPetal } from "./iris";
import { rockMaterial, patchedDepth } from "./materials";
import { ground, POLY_LEN, shoreAt, BRIDGE } from "./terrain";
import { randDir, addCard, BARK, LEAVES } from "./trees";
import { meshOf } from "./structures";
import { nearWaterfall } from "./waterfallMesh";
/* ------------------------------------------------------------------ 9h. BOTANICAL PLANTING + BAMBOO */
// A Japanese stroll-garden planting (after seasonal garden references): a Phyllostachys bamboo grove behind a
// kenninji-gaki fence and a clump by the waterfall, mophead hydrangeas (ajisai) in blue / purple / pink, a wisteria
// arbor (fujidana) hung with lavender racemes, tree peonies (botan), drifts of red spider lily (higanbana) along the
// banks, camellias (tsubaki) with whole fallen flowers on the ground, and clumps of balloon flower (kikyo).
export function bambooCulmTex() {
  // one internode per repeat: smooth waxy green, fine vertical striations, white bloom band below the node, node ridge
  const W = 64, H = 256, cv = makeCanvas(W, H), g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, H, 0, 0);
  gr.addColorStop(0, '#46692a'); gr.addColorStop(0.5, '#557a30'); gr.addColorStop(0.84, '#5e8236'); gr.addColorStop(0.9, '#a9b690'); gr.addColorStop(0.95, '#8ea070'); gr.addColorStop(0.975, '#3e5a22'); gr.addColorStop(0.99, '#8a9a5a'); gr.addColorStop(1, '#46692a');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(${i % 2 ? '230,240,200' : '20,40,10'},${0.05 + Math.random() * 0.06})`; g.lineWidth = 0.8; const x = Math.random() * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(200,190,120,${Math.random() * 0.12})`; g.fillRect(Math.random() * W, Math.random() * H * 0.8 + H * 0.05, 2 + Math.random() * 5, 8 + Math.random() * 30); }
  const t = canvasTex(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
export function splitBambooTex() {
  const W = 64, H = 512, cv = makeCanvas(W, H), g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#8a7a50'); gr.addColorStop(0.5, '#b8a672'); gr.addColorStop(1, '#8a7a50');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(70,55,30,${0.08 + Math.random() * 0.1})`; g.lineWidth = 0.8; const x = Math.random() * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (const y of [70, 205, 350, 470]) { g.fillStyle = 'rgba(60,45,25,0.55)'; g.fillRect(0, y, W, 3); g.fillStyle = 'rgba(220,210,170,0.4)'; g.fillRect(0, y + 3, W, 2); }
  const t = canvasTex(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
export function wisteriaTex() {
  // a raceme: open lavender pea flowers at the top, paler and greener buds toward the pointed tip
  const W = 128, H = 512, cv = makeCanvas(W, H), g = cv.getContext('2d');
  g.strokeStyle = '#5a6a3a'; g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H * 0.97); g.stroke();
  for (let i = 0; i < 150; i++) {
    const t = Math.pow(Math.random(), 0.8), y = 8 + t * (H - 24), half = (1 - t) * W * 0.42 + 6, x = W / 2 + (Math.random() * 2 - 1) * half;
    const open = 1 - t, s = 5 + open * 7;
    const light = 55 + t * 22, sat = 45 - t * 15, hue = 265 - t * 30;
    g.fillStyle = `hsl(${hue},${sat}%,${light}%)`; g.beginPath(); g.ellipse(x, y, s * 0.9, s * 0.7, Math.random(), 0, 6.28); g.fill();
    if (open > 0.45) { g.fillStyle = `hsl(55,70%,70%)`; g.beginPath(); g.arc(x, y - s * 0.2, s * 0.18, 0, 6.28); g.fill(); g.fillStyle = `hsl(${hue - 10},${sat + 10}%,${light - 18}%)`; g.beginPath(); g.ellipse(x, y + s * 0.35, s * 0.5, s * 0.3, 0, 0, 6.28); g.fill(); }
  }
  const t = canvasTex(cv); t.anisotropy = 4; return t;
}
export function paintGeo(geo, col) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}
export function spiderLilyGeo() {
  // Lycoris radiata: leafless scape topped by an umbel of ~6 flowers; six narrow, wavy, strongly recurved tepals
  // and six very long upcurved stamens per flower
  const parts = [], red = new THREE.Color(0xc0121c), dark = new THREE.Color(0x3a0a0a), stemC = new THREE.Color(0x4f6a2a), V3 = THREE.Vector3;
  const H = 0.46;
  parts.push(paintGeo(taperTube(new THREE.CatmullRomCurve3([new V3(0, 0, 0), new V3(0.004, H * 0.5, 0), new V3(0, H, 0)]), 8, 5, 0.0038, 0.003, 3), stemC));
  for (let f = 0; f < 6; f++) {
    // each flower is built around its own +Y axis, then turned to face outward and up from the top of the scape
    const az = f * 1.047 + 0.2, dir = new V3(Math.cos(az) * 0.8, 0.55, Math.sin(az) * 0.8).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir);
    const base = new V3(0, H + 0.004, 0), fb = base.clone().addScaledVector(dir, 0.02);
    parts.push(paintGeo(taperTube(new THREE.CatmullRomCurve3([base, base.clone().addScaledVector(dir, 0.01).add(new V3(0, 0.004, 0)), fb]), 3, 4, 0.0014, 0.0012, 3), stemC));
    for (let k = 0; k < 6; k++) {
      const tp = irisPetal({ L: 0.042, W: 0.0034, haft: 0.6, wMax: 0.4, th0: 0.35, th1: -2.0, thP: 1.1, cup: -0.0008, ruffle: 0.0005, ux0: 0, ux1: 1, nu: 18, nv: 4, seed: k + f * 6 });
      tp.rotateY(k * 1.047 + f); tp.applyQuaternion(q); tp.translate(fb.x, fb.y, fb.z); parts.push(paintGeo(tp, red));
    }
    for (let k = 0; k < 6; k++) {
      const a = k * 1.047 + 0.5, pts = [];
      for (let i = 0; i <= 5; i++) { const t = i / 5, rad = 0.004 + 0.022 * t * (1 - 0.35 * t); pts.push(new V3(Math.cos(a) * rad, 0.07 * t, Math.sin(a) * rad)); }
      const st = taperTube(new THREE.CatmullRomCurve3(pts), 8, 3, 0.0005, 0.0004, 3); st.applyQuaternion(q); st.translate(fb.x, fb.y, fb.z); parts.push(paintGeo(st, red));
      const tip = pts[5].clone().applyQuaternion(q).add(fb), an = new THREE.SphereGeometry(0.0012, 5, 4); an.scale(1.8, 0.8, 0.8); an.translate(tip.x, tip.y, tip.z); parts.push(paintGeo(an, dark));
    }
  }
  return mergeGeos(parts);
}
export function peonyFlowerGeo() {
  // Paeonia suffruticosa: a large bowl of ~26 broad ruffled petals (outer spreading, inner cupped) and a golden boss
  const parts = [];
  const whorls = [[8, 0.07, 0.032, 0.2, 0.55], [9, 0.064, 0.03, 0.62, 0.95], [9, 0.05, 0.024, 1.05, 1.5]];
  let k = 0;
  whorls.forEach(([n, L, W, t0, t1], wi) => { for (let i = 0; i < n; i++, k++) {
    const pg = irisPetal({ L: L * rr(0.9, 1.08), W: W * rr(0.9, 1.1), haft: 0.3, wMax: 0.66, th0: t0 + rr(-0.08, 0.08), th1: t1 + rr(-0.12, 0.12), thP: 1.2, cup: -0.007, ruffle: 0.0035, ux0: 0, ux1: 1, nu: 12, nv: 10, seed: k * 1.7, r0: 0.012, y0: wi * 0.006 });
    pg.rotateY(k * 2.39996); parts.push(pg); } });
  return mergeGeos(parts);
}
export function peonyPetalTex() {
  const W = 128, H = 256, cv = makeCanvas(W, H), g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, '#9a2050'); gr.addColorStop(0.16, '#e0a0b8'); gr.addColorStop(0.5, '#fbe4ec'); gr.addColorStop(1, '#fff4f7');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 22; i++) { const x0 = W * (i + 0.5) / 22; g.strokeStyle = 'rgba(190,90,130,0.16)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(W / 2 + (x0 - W / 2) * 0.3, H); g.quadraticCurveTo(x0, H * 0.5, x0 + (x0 - W / 2) * 0.1, 0); g.stroke(); }
  return canvasTex(cv);
}
export function buildBotanical(OCC, free, V3) {
  let nr0 = 0;
  const BOT = WORLD.botany = { hyd: [], cam: [], peony: [], kikyo: [], arbor: null, lily: [] };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3();
  const find = (pred, r, tries = 3000) => { for (let i = 0; i < tries; i++) { const x = rr(-11, 11), z = rr(-13, 9.5); if (pred(x, z, sdf(x, z)) && free(x, z, r)) return [x, z]; } return null; };
  const hedge = rockMaterial(TEX.hedge, { key: 'hedge', hedge: true, scale: 2.6, nrm: 1.4, rough: 0.72, bloom: 0 });
  const blob = rockGeo(7.7, 3, -0.3);
  const mounds = [];
  const mound = (x, z, rx, ry, rz, lift = 0.1) => { const gy = ground(x, z), g = blob.clone(); g.scale(rx, ry, rz); g.translate(x, gy + ry * lift, z); mounds.push(g); return gy + ry * lift; };
  const shell = (list, x, y0, z, rx, ry, rz, n, size, col) => {
    for (let i = 0; i < n; i++) { const d = randDir(); if (d.y < -0.1) d.y = -d.y * 0.3;
      const nn = new V3(d.x / rx, d.y / ry, d.z / rz).normalize();
      addCard(list, new V3(x + d.x * rx, y0 + d.y * ry, z + d.z * rz).addScaledVector(nn, 0.02), nn.clone().add(new V3(0, 0.4, 0)), size * rr(0.85, 1.15), col()); }
  };
  const green = () => new THREE.Color().setRGB(rr(0.85, 1.08), rr(0.9, 1.08), rr(0.85, 1.0));
  const darkGreen = () => new THREE.Color().setRGB(rr(0.6, 0.78), rr(0.7, 0.85), rr(0.55, 0.7));
  WORLD._free = free;

  // --- Bamboo: a grove behind a kenninji-gaki fence (back left) and a clump beside the waterfall
  const culmTex = bambooCulmTex(), culms = [], nodes = [], branches = [], bambooLeaves = [];
  const culmAt = (x, z, H, r) => {
    const gy = ground(x, z), lean = new V3(rr(-0.06, 0.06), 1, rr(-0.06, 0.06)).normalize(), bend = new V3(rr(-0.3, 0.3), 0, rr(-0.3, 0.3));
    const pts = []; for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new V3(x, gy - 0.05, z).addScaledVector(lean, H * t).addScaledVector(bend, t * t * 0.5)); }
    const curve = new THREE.CatmullRomCurve3(pts), inter = rr(0.26, 0.34);
    // young culms are vivid green, older ones age toward olive-yellow
    const age = rand(), tint = new THREE.Color().setRGB(lerp(0.95, 1.25, age), lerp(1.0, 1.08, age), lerp(0.95, 0.62, age));
    culms.push(paintGeo(taperTube(curve, Math.round(H * 5), 8, r, r * 0.55, 1 / inter), tint));
    const L = curve.getLength();
    for (let s = inter; s < L; s += inter) {
      const t = s / L, p = curve.getPointAt(t), tan = curve.getTangentAt(t), rr0 = lerp(r, r * 0.55, Math.pow(t, 0.8));
      const ring = new THREE.TorusGeometry(rr0 * 1.03, rr0 * 0.07, 3, 10); ring.rotateX(Math.PI / 2); ring.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), tan)); ring.translate(p.x, p.y, p.z); nodes.push(paintGeo(ring, tint));
      if (t > 0.45) {
        for (const side of [1, -1]) {
          if (rand() < 0.35) continue;
          const az = rand() * 6.28 + (side > 0 ? 0 : Math.PI), bl = rr(0.35, 0.8) * (1.2 - t);
          const d0 = new V3(Math.cos(az), rr(0.5, 0.9), Math.sin(az)).normalize();
          const e = p.clone().addScaledVector(d0, bl), mid = p.clone().addScaledVector(d0, bl * 0.5); e.y -= bl * 0.2;
          branches.push(paintGeo(taperTube(new THREE.CatmullRomCurve3([p, mid, e]), 4, 4, 0.006, 0.002, 1), tint));
          for (let k = 0; k < 3; k++) { const q = new V3().lerpVectors(mid, e, k / 2).add(new V3(rr(-0.08, 0.08), rr(-0.12, 0.02), rr(-0.08, 0.08)));
            addCard(bambooLeaves, q, new V3(rr(-0.6, 0.6), 1, rr(-0.6, 0.6)), rr(0.42, 0.62), new THREE.Color().setRGB(rr(0.85, 1.05), rr(0.9, 1.05), rr(0.8, 0.95))); }
        }
      }
    }
  };
  let placed = 0, guard = 0;
  while (placed < 46 && guard++ < 4000) { const x = rr(-11.2, -7.0), z = rr(-13.2, -8.7); if (!free(x, z, 0.1)) continue; culmAt(x, z, rr(5.2, 8.2), rr(0.035, 0.06)); OCC.push([x, z, 0.16]); placed++; }
  const wfC = [-5.35, -5.3];
  for (let i = 0; i < 9; i++) { const x = wfC[0] + rr(-0.45, 0.45), z = wfC[1] + rr(-0.45, 0.45); if (free(x, z, 0.08)) { culmAt(x, z, rr(3.8, 5.5), rr(0.03, 0.045)); OCC.push([x, z, 0.12]); } }
  const culmWind = 'clamp((wPos4.y - 0.8) * 0.07, 0.0, 0.7)';
  const culmMat = physical({ map: culmTex, vertexColors: true, roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.8 }, { key: 'bamboo', wind: 'world', windWeight: culmWind });
  const cm = meshOf(culms.concat(nodes, branches), culmMat, LAYER.ABOVE);
  const poleMat = physical({ map: culmTex, roughness: 0.4, clearcoat: 0.3, envMapIntensity: 0.8 }, { key: 'bamboopole' }); cm.customDepthMaterial = patchedDepth({ key: 'bambood', wind: true, windWeight: culmWind });
  {
    const leafTex = TEX.bambooLeaves, ww = culmWind + ' + 0.12';
    const cardGeo = new THREE.PlaneGeometry(1, 1, 3, 3);
    const mat = physical({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55, envMapIntensity: 0.55 }, { key: 'bambooleaf', leaf: true, wind: 'world', windWeight: ww, uniforms: { uTransl: { value: 0.55 } } });
    const im = new THREE.InstancedMesh(cardGeo, mat, bambooLeaves.length);
    bambooLeaves.forEach((e, i) => { im.setMatrixAt(i, e.m); im.setColorAt(i, e.c); });
    im.castShadow = im.receiveShadow = true; im.customDepthMaterial = patchedDepth({ key: 'bambooleafd', wind: true, windWeight: ww }, leafTex, 0.45); im.computeBoundingSphere();
    setLayer(im, LAYER.ABOVE); scene.add(im);
  }
  // kenninji-gaki: tightly packed vertical split-bamboo slats between charred posts, paired rails tied with black rope
  {
    const x0 = -10.6, x1 = -7.3, zf = -8.35, len = x1 - x0, Hf = 1.75;
    const slatMat = physical({ map: splitBambooTex(), roughness: 0.62, envMapIntensity: 0.6 }, { key: 'slat' });
    const ropeMat = physical({ color: 0x141210, roughness: 0.9 }, { key: 'rope' });
    const slats = [], rails = [], ropes = [];
    for (let x = x0 + 0.05; x < x1 - 0.03; x += 0.042) {
      const gy = ground(x, zf), g = new THREE.BoxGeometry(0.04, Hf, 0.012); g.translate(x, gy + Hf / 2 - 0.02, zf + (Math.round(x / 0.042) % 2 ? 0.003 : -0.003)); slats.push(g);
    }
    const gy0 = ground((x0 + x1) / 2, zf);
    for (const h of [0.32, 0.78, 1.24, 1.62]) for (const side of [1, -1]) {
      const g = new THREE.CylinderGeometry(0.018, 0.018, len, 8, 1, false, side > 0 ? 0 : Math.PI, Math.PI); g.rotateZ(Math.PI / 2); g.translate((x0 + x1) / 2, gy0 + h, zf + side * 0.012); rails.push(g);
      for (let x = x0 + 0.2; x < x1; x += 0.34) { const r = new THREE.BoxGeometry(0.035, 0.03, 0.06); r.translate(x, gy0 + h, zf); ropes.push(r); }
    }
    const cap = new THREE.CylinderGeometry(0.035, 0.035, len + 0.1, 10); cap.rotateZ(Math.PI / 2); cap.translate((x0 + x1) / 2, gy0 + Hf, zf); rails.push(cap);
    const posts = [];
    for (const x of [x0, (x0 + x1) / 2, x1]) { const g = new THREE.CylinderGeometry(0.055, 0.06, Hf + 0.2, 12); g.translate(x, ground(x, zf) + (Hf + 0.2) / 2 - 0.05, zf); posts.push(g); }
    meshOf(slats, slatMat, LAYER.ABOVE); meshOf(rails, poleMat, LAYER.ABOVE); meshOf(ropes, ropeMat, LAYER.ABOVE, false);
    meshOf(posts, physical({ color: 0x3a2e26, roughness: 0.85, map: TEX.bark.map }, { key: 'post' }), LAYER.ABOVE);
    OCC.push([(x0 + x1) / 2, zf, 0.3]);
  }

  // --- Wisteria arbor (fujidana): timber posts and beams, a bamboo-pole lattice, gnarled vines, hanging racemes
  {
    const prefs = [[7.2, 0.6], [6.9, -3.4], [6.6, 4.6], [-5.9, 5.4], [4.6, 7.4]];
    const ok = prefs.find(([x, z]) => free(x, z, 1.25)) || find((x, z, sd) => sd > 2.5 && sd < 7, 1.4);
    if (ok) {
      const [ax, az] = ok, W = 2.6, D = 1.8, Ht = 2.25, gy = ground(ax, az), wood = [];
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const g = woodBox(Ht, 0.11, 0.11); g.rotateZ(Math.PI / 2); g.translate(ax + px * W / 2, gy + Ht / 2 - 0.05, az + pz * D / 2); wood.push(g); }
      for (const pz of [-1, 1]) { const g = woodBox(W + 0.5, 0.12, 0.09); g.translate(ax, gy + Ht, az + pz * D / 2); wood.push(g); }
      for (let i = 0; i < 6; i++) { const g = woodBox(D + 0.4, 0.07, 0.06); g.rotateY(Math.PI / 2); g.translate(ax - W / 2 + i * W / 5, gy + Ht + 0.095, az); wood.push(g); }
      meshOf(wood, WORLD.wood, LAYER.ABOVE);
      const poles = []; for (let i = 0; i < 8; i++) { const g = new THREE.CylinderGeometry(0.014, 0.014, W + 0.3, 8); g.rotateZ(Math.PI / 2); g.translate(ax, gy + Ht + 0.145, az - D / 2 + i * D / 7); poles.push(g); }
      meshOf(poles, poleMat, LAYER.ABOVE);
      // two old vines twisting up the front posts and spreading over the top
      for (const px of [-1, 1]) {
        const b = new V3(ax + px * W / 2 + 0.12, gy - 0.05, az + D / 2 + 0.1), pts = [];
        for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new V3(b.x + Math.cos(t * 9) * 0.08, b.y + t * (Ht + 0.2), b.z + Math.sin(t * 9) * 0.08)); }
        for (let i = 1; i <= 5; i++) pts.push(new V3(b.x - px * i * 0.35, gy + Ht + 0.22 + Math.sin(i) * 0.05, b.z - i * 0.25));
        BARK.push(taperTube(new THREE.CatmullRomCurve3(pts), 60, 8, 0.05, 0.015, 1.2));
      }
      for (let i = 0; i < 110; i++) addCard(LEAVES.green, new V3(ax + rr(-W / 2 - 0.2, W / 2 + 0.2), gy + Ht + rr(0.18, 0.4), az + rr(-D / 2 - 0.2, D / 2 + 0.2)), new V3(rr(-0.3, 0.3), 1, rr(-0.3, 0.3)), rr(0.4, 0.6), new THREE.Color().setRGB(rr(0.9, 1.05), rr(0.95, 1.1), rr(0.7, 0.85)));
      // racemes: two crossed vertical planes each, hanging from the lattice
      const rTex = wisteriaTex();
      const rMat = physical({ map: rTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.55, sheen: 0.5, sheenColor: new THREE.Color(0xe0d0ff) },
        { key: 'wisteria', leaf: true, wind: 'local', windWeight: 'clamp(-position.y * 1.6, 0.0, 0.9)', uniforms: { uTransl: { value: 0.7 } } });
      const rg = mergeGeos([new THREE.PlaneGeometry(0.12, 1, 1, 6).translate(0, -0.5, 0), new THREE.PlaneGeometry(0.12, 1, 1, 6).translate(0, -0.5, 0).rotateY(Math.PI / 2)]);
      const rm = [];
      for (let i = 0; i < 150; i++) { const L = rr(0.3, 0.6); E.set(rr(-0.06, 0.06), rand() * 6.28, rr(-0.06, 0.06)); Q.setFromEuler(E); S.set(rr(0.9, 1.2), L, rr(0.9, 1.2));
        rm.push(new THREE.Matrix4().compose(new V3(ax + rr(-W / 2, W / 2), gy + Ht + 0.12, az + rr(-D / 2, D / 2)), Q, S)); }
      seasonal(instanced(rg, rMat, rm, LAYER.ABOVE, false), 'SR');
      OCC.push([ax, az, 1.6]); BOT.arbor = [ax, az];
    }
  }
  nr0 = scene.children.length;                            // everything below is low planting away from the water
  // --- Hydrangeas (ajisai): big-leaved mounds with ball-shaped mopheads, mostly blue and purple (acid soil), some pink
  const hydColors = [0x6c8ee0, 0x8a78d8, 0x7aa0e8, 0xb07cd0, 0xe48ab0, 0x9fb4f0];
  for (let i = 0; i < 10; i++) {
    const s = find((x, z, sd) => sd > 1.0 && sd < 6, 0.6); if (!s) continue;
    const [x, z] = s, rx = rr(0.5, 0.7), ry = rr(0.5, 0.65), rz = rr(0.5, 0.7), y0 = mound(x, z, rx * 0.8, ry * 0.8, rz * 0.8, 0.2);
    shell(LEAVES.bigleaf, x, y0, z, rx * 0.88, ry * 0.88, rz * 0.88, 190, 0.24, darkGreen);
    const base = new THREE.Color(hydColors[(rand() * hydColors.length) | 0]);
    const heads = 14 + (rand() * 8 | 0);
    for (let h = 0; h < heads; h++) {
      const d = randDir(); if (d.y < 0.05) d.y = 0.05 + rand() * 0.6; d.normalize();
      const c = new V3(x + d.x * rx, y0 + d.y * ry + 0.03, z + d.z * rz), hr = rr(0.08, 0.11);
      const col = base.clone().offsetHSL(rr(-0.03, 0.03), rr(-0.08, 0.05), rr(-0.05, 0.08));
      for (let k = 0; k < 9; k++) { const n = randDir(); if (n.y < -0.3) n.y = -n.y; addCard(LEAVES.hydrangea, c.clone().addScaledVector(n, hr * 0.6), n, hr * rr(1.2, 1.5), col.clone().multiplyScalar(rr(0.9, 1.05))); }
    }
    OCC.push([x, z, 0.75]); BOT.hyd.push([x, z]);
  }

  // --- Camellias: glossy upright shrubs with crimson flowers; whole flowers dropped on the moss below
  const fallen = [];
  const fallenGeo = (() => { const parts = [];
    for (let k = 0; k < 6; k++) { const g = irisPetal({ L: 0.028, W: 0.013, haft: 0.5, wMax: 0.6, th0: 0.55, th1: 0.95, cup: -0.004, ruffle: 0.0008, ux0: 0, ux1: 1, nu: 6, nv: 5, r0: 0.004 }); g.rotateY(k * 1.047 + rr(-0.1, 0.1)); parts.push(paintGeo(g, new THREE.Color(0xa80c22))); }
    const boss = new THREE.CylinderGeometry(0.008, 0.006, 0.014, 12); boss.translate(0, 0.009, 0); parts.push(paintGeo(boss, new THREE.Color(0xf0cc40)));
    return mergeGeos(parts); })();
  for (let i = 0; i < 4; i++) {
    const s = find((x, z, sd) => sd > 2.4 && sd < 6.5, 1.0); if (!s) break;
    const [x, z] = s, rx = rr(0.6, 0.8), ry = rr(0.9, 1.2), rz = rr(0.6, 0.8), y0 = mound(x, z, rx * 0.85, ry * 0.85, rz * 0.85, 0.55);
    shell(LEAVES.camellia, x, y0, z, rx, ry, rz, 120, 0.34, green);
    shell(LEAVES.shrub, x, y0, z, rx * 0.98, ry * 0.98, rz * 0.98, 160, 0.3, darkGreen);
    for (let k = 0; k < 14; k++) { const a = rand() * 6.28, r = rr(0.3, 1.1) * Math.max(rx, rz); const fx = x + Math.cos(a) * r, fz = z + Math.sin(a) * r;
      E.set(rr(-0.3, 0.3), rand() * 6.28, rr(-0.3, 0.3)); Q.setFromEuler(E); S.setScalar(rr(0.9, 1.15)); fallen.push(new THREE.Matrix4().compose(new V3(fx, ground(fx, fz) + 0.002, fz), Q, S)); }
    OCC.push([x, z, 0.95]); BOT.cam.push([x, z]);
  }
  if (fallen.length) instanced(fallenGeo, physical({ vertexColors: true, roughness: 0.45, sheen: 0.5, sheenColor: new THREE.Color(0xff8090) }, { key: 'camfallen' }), fallen, LAYER.ABOVE);

  // --- Tree peonies (botan): leafy bushes carrying big ruffled blooms (white-pink, rose, deep magenta)
  {
    const pMat = physical({ map: peonyPetalTex(), side: THREE.DoubleSide, roughness: 0.5, sheen: 0.8, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xfff0f4), envMapIntensity: 0.6 }, { key: 'peony', leaf: true, uniforms: { uTransl: { value: 0.75 } } });
    const bossGeo = (() => { const parts = []; const b = new THREE.SphereGeometry(0.016, 12, 8); b.scale(1, 0.6, 1); b.translate(0, 0.012, 0); parts.push(b);
      for (let k = 0; k < 40; k++) { const a = k * 2.4, r = rr(0.008, 0.017); const c = new THREE.CylinderGeometry(0.0012, 0.0008, 0.012, 4); c.rotateZ(rr(0.3, 0.9)); c.rotateY(a); c.translate(Math.cos(a) * r, 0.018, Math.sin(a) * r); parts.push(c); } return mergeGeos(parts); })();
    const blooms = [], bosses = [], cols = [], tints = [0xffffff, 0xffd8e4, 0xf29ab8, 0xd8507a, 0xfff4e8];
    for (let i = 0; i < 6; i++) {
      const s = find((x, z, sd) => sd > 1.4 && sd < 4.5, 0.5); if (!s) break;
      const [x, z] = s, rx = rr(0.38, 0.48), ry = rr(0.38, 0.5), y0 = mound(x, z, rx * 0.7, ry * 0.75, rx * 0.7, 0.3);
      shell(LEAVES.bigleaf, x, y0, z, rx, ry, rx, 120, 0.2, darkGreen);
      const tint = new THREE.Color(tints[(rand() * tints.length) | 0]);
      for (let b = 0; b < 4 + (rand() * 3 | 0); b++) {
        const d = randDir(); d.y = Math.abs(d.y) * 0.8 + 0.3; d.normalize();
        const p = new V3(x + d.x * rx * 0.9, y0 + d.y * ry * 0.9 + 0.02, z + d.z * rx * 0.9);
        Q.setFromUnitVectors(new V3(0, 1, 0), d.clone().lerp(new V3(0, 1, 0), 0.5).normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), rand() * 6.28));
        const sc = rr(1.0, 1.25); S.setScalar(sc); blooms.push(new THREE.Matrix4().compose(p, Q, S)); bosses.push(new THREE.Matrix4().compose(p, Q, S)); cols.push(tint.clone().offsetHSL(0, 0, rr(-0.04, 0.03)));
      }
      OCC.push([x, z, 0.5]); BOT.peony.push([x, z]);
    }
    if (blooms.length) {
      const im = instanced(peonyFlowerGeo(), pMat, blooms, LAYER.ABOVE); blooms.forEach((m, i) => im.setColorAt(i, cols[i])); im.instanceColor.needsUpdate = true; seasonal(im, 'SR');
      seasonal(instanced(bossGeo, physical({ color: 0xe8bc2c, roughness: 0.5 }, { key: 'peonyboss' }), bosses, LAYER.ABOVE), 'SR');
    }
  }

  // --- Red spider lilies: drifts of bare scarlet umbels along the banks
  {
    const geo = spiderLilyGeo(), mats = [];
    for (let d = 0; d < 9; d++) {
      const s0 = rand() * POLY_LEN, sh0 = shoreAt(s0);
      if (nearWaterfall(sh0.x, sh0.z, 1.2) || (Math.abs(sh0.z - BRIDGE.z) < 1.2 && Math.abs(sh0.x) > BRIDGE.half - 0.8)) continue;
      const nStem = 14 + (rand() * 10 | 0);
      for (let k = 0; k < nStem; k++) {
        const sh = shoreAt(s0 + rr(-0.7, 0.7)), off = rr(0.7, 2.0), x = sh.x + sh.nx * off + rr(-0.08, 0.08), z = sh.z + sh.nz * off + rr(-0.08, 0.08);
        if (!free(x, z, 0.02)) continue;
        E.set(rr(-0.08, 0.08), rand() * 6.28, rr(-0.08, 0.08)); Q.setFromEuler(E); S.setScalar(rr(0.85, 1.15));
        mats.push(new THREE.Matrix4().compose(new V3(x, ground(x, z) - 0.01, z), Q, S)); BOT.lily.push([x, z]);
      }
    }
    if (mats.length) seasonal(instanced(geo, physical({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.42, sheen: 0.7, sheenColor: new THREE.Color(0xff5050), envMapIntensity: 0.6 },
      { key: 'higanbana', leaf: true, wind: 'local', windWeight: 'clamp(position.y * 1.2, 0.0, 0.5)', uniforms: { uTransl: { value: 0.6 } } }), mats, LAYER.ABOVE), 'SRA');
  }

  // --- Balloon flower (kikyo) clumps
  for (let i = 0; i < 10; i++) {
    const s = find((x, z, sd) => sd > 0.9 && sd < 4.5, 0.3); if (!s) break;
    const [x, z] = s, gy = ground(x, z);
    for (let k = 0; k < 7; k++) addCard(LEAVES.kikyo, new V3(x + rr(-0.15, 0.15), gy + rr(0.2, 0.42), z + rr(-0.15, 0.15)), new V3(rr(-0.7, 0.7), 0.8, rr(-0.7, 0.7)), rr(0.3, 0.4), new THREE.Color(1, 1, 1));
    OCC.push([x, z, 0.3]); BOT.kikyo.push([x, z]);
  }

  if (mounds.length) meshOf(mounds, hedge, LAYER.ABOVE);
  // ground-level plantings well back from the water never show in its reflection (the bank hides them)
  for (const o of scene.children.slice(nr0)) WORLD.noReflect.push(o);
}

