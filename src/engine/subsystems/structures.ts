// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets } from "../geometry";
import { $, progress, toast } from "../state";
import { WORLD, BRIDGE, terrainHeight, PAVILION } from "./terrain";
import { physical, WOOD_VS, WOOD_ROUGH } from "./materials";
import { TEX } from "./textures";
import { scene } from "./lighting";
/* ------------------------------------------------------------------ 8. BRIDGE + PAVILION */
export function woodMaterials() {
  const tint = new THREE.Color(0xe2c4ad);
  WORLD.wood = physical({ map: TEX.wood.map, normalMap: TEX.wood.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.66, color: tint, envMapIntensity: 0.7 },
    { key: 'wood', wood: true, vsPars: WOOD_VS, vsBegin: 'vBox = aBox; vHalf = aHalf;', fsPars: 'varying vec3 vBox;\nvarying vec4 vHalf;\n', fsRough: WOOD_ROUGH, uniforms: { uWeather: { value: 0.35 } } });
  WORLD.rail = physical({ map: TEX.wood.map, normalMap: TEX.wood.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.5, color: tint,
    clearcoat: 0.3, clearcoatRoughness: 0.4, anisotropy: 0.4, envMapIntensity: 0.8 }, { key: 'rail', wood: true, vsPars: WOOD_VS, vsBegin: 'vBox = aBox; vHalf = aHalf;', fsPars: 'varying vec3 vBox;\nvarying vec4 vHalf;\n', fsRough: WOOD_ROUGH, uniforms: { uWeather: { value: 1.0 } } });
}
export function meshOf(geos, mat, layer, cast = true) {
  const m = new THREE.Mesh(mergeGeos(geos), mat); m.castShadow = cast; m.receiveShadow = true; setLayer(m, layer); scene.add(m); return m;
}
export function buildBridge() {
  const Z0 = BRIDGE.z, H = BRIDGE.half, W = BRIDGE.width;
  const deckY = (x) => 0.3 + 0.6 * (1 - (x / H) ** 2);
  const slope = (x) => Math.atan(-1.2 * x / (H * H));
  WORLD.deckY = deckY;
  const deck = [], rail = [], piers = [];
  const NS = 22;
  const along = (list, hOff, th, wd, zc) => {
    for (let i = 0; i < NS; i++) {
      const xa = -H + (2 * H) * i / NS, xb = -H + (2 * H) * (i + 1) / NS;
      const ya = deckY(xa) + hOff, yb = deckY(xb) + hOff, len = Math.hypot(xb - xa, yb - ya);
      const g = woodBox(len + 0.006, th, wd); g.rotateZ(Math.atan2(yb - ya, xb - xa)); g.translate((xa + xb) / 2, (ya + yb) / 2, zc); list.push(g);
    }
  };
  // stringers
  for (const zo of [-W / 2 + 0.07, W / 2 - 0.07, 0]) along(deck, -0.135, 0.2, 0.09, Z0 + zo);
  // deck planks, grain running across the bridge
  for (let x = -H + 0.07; x < H - 0.05;) {
    const g = woodBox(W + 0.12, 0.035, 0.125, 1, 2); g.rotateY(Math.PI / 2); g.rotateZ(slope(x)); g.translate(x, deckY(x) - 0.0175, Z0); deck.push(g);
    x += 0.14 * Math.cos(slope(x));
  }
  // posts with pyramid caps, top & bottom rails, square balusters
  const postX = [-H + 0.1, -H * 0.5, 0, H * 0.5, H - 0.1];
  for (const side of [-1, 1]) {
    const zc = Z0 + side * (W / 2 + 0.02);
    for (const px of postX) {
      const h = 0.98, g = woodBox(h, 0.1, 0.1); g.rotateZ(Math.PI / 2); g.translate(px, deckY(px) - 0.06 + h / 2, zc); rail.push(g);
      const cap = new THREE.ConeGeometry(0.085, 0.09, 4, 1); cap.rotateY(Math.PI / 4); cap.translate(px, deckY(px) - 0.06 + h + 0.045, zc); rail.push(cap);
    }
    along(rail, 0.84, 0.07, 0.1, zc);
    along(rail, 0.12, 0.05, 0.06, zc);
    for (let bx = -H + 0.2; bx < H - 0.15; bx += 0.15) {
      if (postX.some((px) => Math.abs(px - bx) < 0.08)) continue;
      const h = 0.66, g = woodBox(h, 0.032, 0.032); g.rotateZ(Math.PI / 2); g.translate(bx, deckY(bx) + 0.48, zc); rail.push(g);
    }
  }
  // piers standing in the water + cross beams
  for (const px of [-1.15, 1.15]) {
    for (const side of [-1, 1]) {
      const zc = Z0 + side * (W / 2 - 0.07), bottom = terrainHeight(px, zc) - 0.05, top = deckY(px) - 0.23, h = top - bottom;
      const g = woodBox(h, 0.14, 0.14); g.rotateZ(Math.PI / 2); g.translate(px, bottom + h / 2, zc); piers.push(g);
    }
    const cb = woodBox(W + 0.1, 0.14, 0.12); cb.rotateY(Math.PI / 2); cb.translate(px, deckY(px) - 0.3, Z0); piers.push(cb);
  }
  meshOf(deck, WORLD.wood, LAYER.ABOVE);
  meshOf(rail, WORLD.rail, LAYER.ABOVE);
  meshOf(piers, WORLD.wood, LAYER.BOTH);
}

export function buildPavilion() {
  const C = PAVILION, R = C.r, baseTop = 0.62, floorY = baseTop + 0.06;
  const corner = (k, rad) => { const a = (30 + 60 * k) * DEG; return [C.x + rad * Math.sin(a), C.z + rad * Math.cos(a)]; };
  // granite plinth + entry steps
  const plinth = new THREE.CylinderGeometry(R + 0.45, R + 0.55, 0.62, 6, 1); plinth.rotateY(Math.PI / 6); plinth.translate(C.x, baseTop - 0.31, C.z);
  const step1 = roundedBox(1.4, 0.2, 0.45, 0.02, 7); step1.translate(C.x, 0.3, C.z + R + 0.62);
  const step2 = roundedBox(1.2, 0.2, 0.4, 0.02, 8); step2.translate(C.x, 0.48, C.z + R + 0.35);
  const stone = new THREE.Mesh(mergeGeos([weld(plinth), step1, step2].map((g) => { if (!g.attributes.normal) g.computeVertexNormals(); return g; })), WORLD.granite);
  stone.geometry.computeVertexNormals(); stone.castShadow = stone.receiveShadow = true; setLayer(stone, LAYER.ABOVE); scene.add(stone);

  const wood = [], rail = [];
  const floor = new THREE.CylinderGeometry(R + 0.22, R + 0.22, 0.06, 6); floor.rotateY(Math.PI / 6); floor.translate(C.x, baseTop + 0.03, C.z); wood.push(floor);
  const postH = 2.35;
  for (let k = 0; k < 6; k++) {
    const [x, z] = corner(k, R * 0.95);
    const g = woodBox(postH, 0.15, 0.15); g.rotateZ(Math.PI / 2); g.translate(x, floorY + postH / 2, z); rail.push(g);
    const [x2, z2] = corner(k + 1, R * 0.95), dx = x2 - x, dz = z2 - z, len = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx);
    const beam = woodBox(len + 0.16, 0.2, 0.13); beam.rotateY(yaw); beam.translate((x + x2) / 2, floorY + postH - 0.08, (z + z2) / 2); wood.push(beam);
    const tie = woodBox(len, 0.08, 0.08); tie.rotateY(yaw); tie.translate((x + x2) / 2, floorY + postH - 0.42, (z + z2) / 2); wood.push(tie);
    if (k === 5) continue; // open side faces the bridge (+z)
    for (const [hOff, th] of [[0.72, 0.06], [0.1, 0.05]]) { const r2 = woodBox(len, th, 0.08); r2.rotateY(yaw); r2.translate((x + x2) / 2, floorY + hOff, (z + z2) / 2); rail.push(r2); }
    const nb = Math.floor(len / 0.14);
    for (let b = 1; b < nb; b++) {
      const t = b / nb, bx = lerp(x, x2, t), bz = lerp(z, z2, t), g2 = woodBox(0.58, 0.03, 0.03); g2.rotateZ(Math.PI / 2); g2.translate(bx, floorY + 0.41, bz); rail.push(g2);
    }
    // bench along the inside
    const [ix, iz] = corner(k, R * 0.78), [ix2, iz2] = corner(k + 1, R * 0.78);
    const bench = woodBox(Math.hypot(ix2 - ix, iz2 - iz) * 0.9, 0.05, 0.32); bench.rotateY(yaw); bench.translate((ix + ix2) / 2, floorY + 0.42, (iz + iz2) / 2); wood.push(bench);
  }
  meshOf(wood, WORLD.wood, LAYER.ABOVE);
  meshOf(rail, WORLD.rail, LAYER.ABOVE);
  buildRoof(C, floorY + postH - 0.02);
}
// Hexagonal hip roof: concave pitch, upturned eaves at the corners, tiled top, timber underside & fascia, hip ridges, finial
export function buildRoof(C, eaveBase) {
  const RR = 2.85, apexY = eaveBase + 1.7, drop = 1.55, NA = 16, NRr = 14;
  const cornerXZ = (k) => { const a = (30 + 60 * k) * DEG; return [RR * Math.sin(a), RR * Math.cos(a)]; };
  const surf = (k, r, a, off = 0) => {
    const [x0, z0] = cornerXZ(k), [x1, z1] = cornerXZ(k + 1);
    const ex = lerp(x0, x1, a), ez = lerp(z0, z1, a), corner = Math.pow(Math.abs(2 * a - 1), 3);
    const y = apexY - drop * (1 - Math.pow(Math.max(0, 1 - r), 1.8)) + 0.42 * corner * Math.pow(r, 3.2) + 0.05 * Math.pow(r, 4) + off;
    return [C.x + ex * r, y, C.z + ez * r];
  };
  const top = { pos: [], uv: [], idx: [] }, under = { pos: [], uv: [], idx: [] };
  for (let k = 0; k < 6; k++) {
    const b0 = top.pos.length / 3;
    for (let ir = 0; ir <= NRr; ir++) for (let ia = 0; ia <= NA; ia++) {
      const r = ir / NRr, a = ia / NA, p = surf(k, r, a), q = surf(k, r, a, -0.07);
      top.pos.push(...p); under.pos.push(...q);
      top.uv.push((a - 0.5) * r * 3.4, r * 2.6); under.uv.push((a - 0.5) * r * 6, r * 4);
    }
    for (let ir = 0; ir < NRr; ir++) for (let ia = 0; ia < NA; ia++) {
      const v00 = b0 + ir * (NA + 1) + ia, v01 = v00 + 1, v10 = v00 + NA + 1, v11 = v10 + 1;
      top.idx.push(v00, v10, v01, v01, v10, v11);
      under.idx.push(v00, v01, v10, v01, v11, v10);
    }
  }
  const mk = (o) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2)); g.setIndex(o.idx); g.computeVertexNormals(); return g; };
  TEX.roof.map.wrapS = TEX.roof.map.wrapT = THREE.RepeatWrapping;
  const roofMat = physical({ map: TEX.roof.map, normalMap: TEX.roof.normalMap, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.55, clearcoat: 0.12, clearcoatRoughness: 0.5, envMapIntensity: 0.8 }, { key: 'roof' });
  const roof = new THREE.Mesh(mk(top), roofMat); roof.castShadow = roof.receiveShadow = true; setLayer(roof, LAYER.ABOVE); scene.add(roof);
  const ceil = new THREE.Mesh(mk(under), WORLD.wood); ceil.receiveShadow = true; setLayer(ceil, LAYER.ABOVE); scene.add(ceil);
  // fascia boards, hip ridges
  const fas = [], ridges = [];
  for (let k = 0; k < 6; k++) {
    const pts = [];
    for (let i = 0; i <= NA; i++) pts.push(new THREE.Vector3(...surf(k, 1, i / NA, -0.05)));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = taperTube(curve, NA, 4, 0.06, 0.06, 2); fas.push(tube);
    const hip = [];
    for (let i = 0; i <= 10; i++) hip.push(new THREE.Vector3(...surf(k, i / 10 * 1.02, 0, 0.05)));
    ridges.push(taperTube(new THREE.CatmullRomCurve3(hip), 20, 8, 0.075, 0.05, 3));
  }
  meshOf(fas, WORLD.wood, LAYER.ABOVE);
  const ridgeMat = physical({ color: 0x2b2f33, roughness: 0.5, map: TEX.roof.map, envMapIntensity: 0.8 }, { key: 'ridge' });
  meshOf(ridges, ridgeMat, LAYER.ABOVE);
  // finial (hōju)
  const bronze = physical({ color: 0x8a6e45, map: TEX.boulder.map, roughness: 0.4, metalness: 0.75, envMapIntensity: 1.0 }, { key: 'bronze' });
  const f1 = new THREE.SphereGeometry(0.13, 20, 14); f1.translate(C.x, apexY + 0.2, C.z);
  const f2 = new THREE.ConeGeometry(0.07, 0.2, 16); f2.translate(C.x, apexY + 0.39, C.z);
  const f3 = new THREE.CylinderGeometry(0.1, 0.16, 0.14, 12); f3.translate(C.x, apexY + 0.05, C.z);
  meshOf([f1, f2, f3], bronze, LAYER.ABOVE);
}

