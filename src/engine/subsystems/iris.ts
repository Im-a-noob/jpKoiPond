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
import { terrainHeight } from "./terrain";
import { patchedDepth } from "./materials";
/* ------------------------------------------------------------------ 9a2. JAPANESE IRIS FLOWERS */
// Hanashobu: every bloom sits on its own flowering stalk: a green scape rising above the leaves, two spathe bracts,
// the ovary and perianth tube, then 3 broad drooping falls (yellow signal in a white halo, violet veining),
// 3 small upright standards and 3 petaloid style arms arching over the falls. Buds on some stalks.
// Petal atlas regions (u across): falls 0-0.5, standards 0.5-0.66, style arms 0.66-0.83, green parts 0.83-1.
export function irisAtlas() {
  const W = 512, H = 256, cv = makeCanvas(W, H), g = cv.getContext('2d');
  const R = Math.random;
  // --- falls
  let gr = g.createLinearGradient(0, H, 0, 0);
  gr.addColorStop(0, '#a09a52'); gr.addColorStop(0.08, '#7a4c8e'); gr.addColorStop(0.3, '#72388c'); gr.addColorStop(0.75, '#642e82'); gr.addColorStop(1, '#723e90');
  g.fillStyle = gr; g.fillRect(0, 0, 256, H);
  const edge = g.createLinearGradient(0, 0, 256, 0);
  edge.addColorStop(0, 'rgba(170,120,190,0.35)'); edge.addColorStop(0.2, 'rgba(0,0,0,0)'); edge.addColorStop(0.8, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(170,120,190,0.35)');
  g.fillStyle = edge; g.fillRect(0, 0, 256, H);
  const vein = (x0, x1, y0, y1, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(x0, H - y0); const n = 10; for (let i = 1; i <= n; i++) { const t = i / n; g.lineTo(lerp(x0, x1, t) + Math.sin(t * 9 + x0) * 1.2, H - lerp(y0, y1, t)); } g.stroke(); };
  for (let i = 0; i < 70; i++) { const x = 4 + i * 3.6 + R() * 2; vein(x, x + (x - 128) * 0.08, 0, H * (0.75 + R() * 0.25), `rgba(38,10,78,${0.25 + R() * 0.25})`, 0.8 + R() * 0.7); }
  for (let i = 0; i < 34; i++) { const x = 80 + R() * 96; vein(x, x + (x - 128) * 0.35, 8, H * (0.28 + R() * 0.3), `rgba(245,240,255,${0.35 + R() * 0.3})`, 0.7 + R() * 0.8); }
  // white halo + yellow signal (a tapering blaze along the midline)
  let rg = g.createRadialGradient(128, H - 96, 4, 128, H - 96, 78); rg.addColorStop(0, 'rgba(250,248,255,0.95)'); rg.addColorStop(0.55, 'rgba(236,228,250,0.55)'); rg.addColorStop(1, 'rgba(236,228,250,0)');
  g.save(); g.translate(128, H - 96); g.scale(0.55, 1.3); g.translate(-128, -(H - 96)); g.fillStyle = rg; g.fillRect(0, 0, 256, H); g.restore();
  g.save(); g.translate(128, H - 96); g.scale(0.26, 1.25);
  rg = g.createRadialGradient(0, 0, 2, 0, 0, 58); rg.addColorStop(0, '#f6b820'); rg.addColorStop(0.6, '#f3cf3a'); rg.addColorStop(1, 'rgba(243,207,58,0)');
  g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 58, 0, Math.PI * 2); g.fill(); g.restore();
  for (let i = 0; i < 9; i++) { const x = 118 + i * 2.5; vein(x, x, 30, 150, 'rgba(120,60,20,0.35)', 0.7); }
  // --- standards
  gr = g.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, '#9a86b0'); gr.addColorStop(0.3, '#7a4a9c'); gr.addColorStop(1, '#6a3a90');
  g.fillStyle = gr; g.fillRect(256, 0, 84, H);
  for (let i = 0; i < 22; i++) { const x = 258 + i * 3.7; vein(x, x + (x - 298) * 0.1, 0, H * (0.7 + R() * 0.3), `rgba(40,12,80,${0.3 + R() * 0.2})`, 0.8); }
  // --- style arms (pale lavender, darker midline, fringed crest at the tip)
  gr = g.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, '#e2dae8'); gr.addColorStop(0.5, '#c0a4d6'); gr.addColorStop(1, '#9a70b8');
  g.fillStyle = gr; g.fillRect(340, 0, 86, H);
  vein(383, 383, 0, H, 'rgba(90,50,150,0.6)', 3);
  for (let i = 0; i < 10; i++) { const x = 346 + i * 8; vein(x, x, H * 0.2, H, 'rgba(110,70,170,0.3)', 0.8); }
  // --- green parts: ovary, tube, spathes (papery bronze tips)
  gr = g.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, '#3c6426'); gr.addColorStop(0.55, '#5c8436'); gr.addColorStop(0.82, '#8c9046'); gr.addColorStop(1, '#b09a68');
  g.fillStyle = gr; g.fillRect(426, 0, 86, H);
  for (let i = 0; i < 16; i++) { const x = 428 + i * 5.3; vein(x, x, 0, H, 'rgba(20,40,10,0.22)', 0.8); }
  const t = canvasTex(cv); t.anisotropy = 4; return t;
}
// A petal surface: centre line swept in the (radial, up) plane with a varying angle, cupped and ruffled across.
export function irisPetal(o) {
  const nu = o.nu || 14, nv = o.nv || 8, pos = [], uv = [], idx = [];
  let r = o.r0 || 0, y = o.y0 || 0;
  const ds = o.L / nu;
  for (let i = 0; i <= nu; i++) {
    const u = i / nu, th = lerp(o.th0, o.th1, Math.pow(u, o.thP || 1.2));
    const nx = -Math.sin(th), ny = Math.cos(th);
    const wBody = u < o.wMax ? o.haft + (1 - o.haft) * Math.pow(Math.sin(Math.PI * 0.5 * u / o.wMax), 1.4) : Math.sqrt(Math.max(0, 1 - Math.pow((u - o.wMax) / (1 - o.wMax), 2.2)));
    const w = o.W * wBody + 0.0004;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv * 2 - 1;
      let h = -o.cup * v * v * Math.min(1, u * 2) + (o.groove || 0) * Math.exp(-v * v * 12) * (1 - u);
      h += (o.ruffle || 0) * Math.sin(v * Math.PI * 2.5 + u * 7 + (o.seed || 0)) * Math.pow(Math.abs(v), 1.6) * smoothstep(0.3, 1, u);
      if (o.crest) h += o.crest * smoothstep(0.78, 1, u) * (0.4 + Math.abs(v));      // style-arm crest flips up
      pos.push(r + nx * h, y + ny * h, v * w);
      uv.push(lerp(o.ux0, o.ux1, v * 0.5 + 0.5), u);
    }
    r += Math.cos(th) * ds; y += Math.sin(th) * ds;
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
export function irisLathe(profile, ux0, ux1, seg = 10) {             // profile: [[radius, y], ...] bottom to top
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  const g = new THREE.LatheGeometry(pts, seg), uvA = g.attributes.uv;
  for (let i = 0; i < uvA.count; i++) uvA.setX(i, lerp(ux0, ux1, uvA.getX(i)));
  return g;
}
export function irisBracts(len, h0, seed) {                            // two spathe bracts sheathing the ovary, pointed and papery at the tip
  const out = [];
  for (let k = 0; k < 2; k++) {
    const b = irisPetal({ L: len, W: 0.009, haft: 0.9, wMax: 0.35, th0: 1.5, th1: 1.28 + k * 0.08, cup: 0.004, ux0: 0.84, ux1: 0.99, nu: 6, nv: 4, seed });
    b.translate(0.0035, h0, 0); b.rotateY(k * Math.PI + seed); out.push(b);
  }
  return out;
}
export function irisFlowerGeo(variant) {
  const parts = [], F = 0.83, G0 = 0.84, G1 = 0.99;
  // ovary + perianth tube (starts exactly at the stalk tip: y = 0)
  parts.push(irisLathe([[0.0032, 0], [0.0042, 0.006], [0.0048, 0.018], [0.0036, 0.028], [0.0024, 0.032], [0.0026, 0.042], [0.0036, 0.047]], G0, G1, 10));
  parts.push(...irisBracts(0.048, -0.004, variant * 1.3));
  const top = 0.046, spin = variant * 0.4;
  for (let k = 0; k < 3; k++) {
    const ang = k * Math.PI * 2 / 3 + spin;
    const fall = irisPetal({ L: 0.074 + variant * 0.004, W: 0.05, haft: 0.14, wMax: 0.62, th0: 0.5, th1: -0.95, thP: 1.3, cup: 0.006, groove: -0.002, ruffle: 0.0022, ux0: 0, ux1: 0.5, seed: k * 2.1 + variant });
    fall.translate(0.002, top, 0); fall.rotateY(ang); parts.push(fall);
    const style = irisPetal({ L: 0.036, W: 0.0095, haft: 0.6, wMax: 0.7, th0: 0.62, th1: 0.2, cup: -0.002, crest: 0.004, ux0: 0.66, ux1: F, nu: 8, nv: 4, seed: k });
    style.translate(0.0025, top + 0.004, 0); style.rotateY(ang); parts.push(style);
    const std = irisPetal({ L: 0.036, W: 0.016, haft: 0.25, wMax: 0.55, th0: 1.25, th1: 0.62, cup: 0.003, ruffle: 0.001, ux0: 0.5, ux1: 0.66, nu: 8, nv: 5, seed: k + 5 });
    std.translate(0.002, top + 0.002, 0); std.rotateY(ang + Math.PI / 3); parts.push(std);
  }
  return mergeGeos(parts);
}
export function irisBudGeo() {
  const parts = [irisLathe([[0.0032, 0], [0.0045, 0.02], [0.006, 0.04], [0.0068, 0.058], [0.005, 0.075], [0.0015, 0.09], [0.0002, 0.095]], 0.5, 0.66, 10)];
  parts.push(...irisBracts(0.07, -0.004, 0.7));
  return mergeGeos(parts);
}
export const IRIS = { flowers: [], buds: [] };
export function buildIrisFlowers(clumps) {
  const atlas = irisAtlas();
  const stems = [], flowerM = [[], [], []], budM = [], cols = [[], [], []], _t = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const WY = WATER_Y.toFixed(3);
  // stalk sway and the bloom at its tip share one wind evaluation, so the flower never separates from its stem
  const ww = `pow(clamp((wWindP.y - ${WY}) / 0.9, 0.0, 1.0), 1.5) * 0.5`;
  for (const c of clumps) {
    const n = 2 + (rand() * 2 | 0), buds = 1 + (rand() * 2 | 0);
    for (let s = 0; s < n + buds; s++) {
      const isBud = s >= n, a = rand() * 6.28, r = rr(0.02, 0.1);
      const bx = c.x + Math.cos(a) * r, bz = c.z + Math.sin(a) * r;
      const H = isBud ? rr(0.55, 0.7) : rr(0.66, 0.86);
      // lean outward over the water (toward the light), a gentle S-curve
      const lx = -c.nx * rr(0.04, 0.12) + rr(-0.04, 0.04), lz = -c.nz * rr(0.04, 0.12) + rr(-0.04, 0.04);
      const fy = Math.min(WATER_Y - 0.25, terrainHeight(bx, bz) - 0.02);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(bx, fy, bz), new THREE.Vector3(bx + lx * 0.15, WATER_Y + H * 0.3, bz + lz * 0.15),
        new THREE.Vector3(bx + lx * 0.6, WATER_Y + H * 0.72, bz + lz * 0.6), new THREE.Vector3(bx + lx, WATER_Y + H, bz + lz)]);
      stems.push(taperTube(curve, 18, 7, 0.0048, 0.0031, 2));
      // a clasping stem leaf part-way up the scape
      const t0 = rr(0.45, 0.6), p0 = curve.getPointAt(t0), yaw = rand() * 6.28;
      const sl = irisPetal({ L: rr(0.12, 0.18), W: 0.012, haft: 0.9, wMax: 0.3, th0: 1.45, th1: 1.05, cup: 0.003, ux0: 0, ux1: 1, nu: 8, nv: 4 });
      sl.translate(0.004, 0, 0); sl.rotateY(yaw); sl.translate(p0.x, p0.y, p0.z); stems.push(sl);
      const tip = curve.getPointAt(1); curve.getTangentAt(1, _t);
      const q = new THREE.Quaternion().setFromUnitVectors(_up, _t).multiply(new THREE.Quaternion().setFromAxisAngle(_up, rand() * 6.28));
      const sc = rr(0.92, 1.1);
      const m = new THREE.Matrix4().compose(tip, q, new THREE.Vector3(sc, sc, sc));
      if (isBud) { budM.push(m); IRIS.buds.push({ p: tip.clone(), t: _t.clone() }); }
      else {
        const v = rand() * 3 | 0; flowerM[v].push(m);
        cols[v].push(new THREE.Color().setHSL(rr(-0.02, 0.03) + 0.0, 0, 0).setRGB(rr(0.9, 1.05), rr(0.9, 1.0), rr(0.95, 1.08)));
        IRIS.flowers.push({ p: tip.clone(), q: q.clone() });
      }
    }
  }
  // stalks + stem leaves (world-space merge; uv.x of the stem leaf spans the iris-leaf texture)
  const stemMat = physical({ map: TEX.iris, color: 0xc8dca8, side: THREE.DoubleSide, roughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(0xc0d890) },
    { key: 'irisstem', leaf: true, wind: 'world', windWeight: ww, uniforms: { uTransl: { value: 0.3 } } });
  const stemMesh = new THREE.Mesh(mergeGeos(stems), stemMat);
  stemMesh.castShadow = stemMesh.receiveShadow = true; stemMesh.customDepthMaterial = patchedDepth({ key: 'irisstemd', wind: true, windWeight: ww });
  setLayer(stemMesh, LAYER.BOTH); scene.add(stemMesh);
  // blooms: wind evaluated at the instance origin (= stalk tip)
  const origin = '(modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz';
  const fm = physical({ map: atlas, side: THREE.DoubleSide, roughness: 0.46, color: 0xe6dcea, sheen: 0.45, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xd8c0e8), envMapIntensity: 0.55 },
    { key: 'irisflower2', leaf: true, wind: 'world', windPos: origin, windWeight: ww, uniforms: { uTransl: { value: 0.6 } } });
  const fdm = patchedDepth({ key: 'irisflowerd', wind: true, windPos: origin, windWeight: ww });
  const put = (geo, mats, colors) => {
    if (!mats.length) return;
    const im = new THREE.InstancedMesh(geo, fm, mats.length);
    mats.forEach((mm, i) => { im.setMatrixAt(i, mm); if (colors) im.setColorAt(i, colors[i]); });
    im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = fdm; im.computeBoundingSphere(); setLayer(im, LAYER.ABOVE); scene.add(im);
    seasonal(im, 'SR');
  };
  for (let v = 0; v < 3; v++) put(irisFlowerGeo(v), flowerM[v], cols[v]);
  put(irisBudGeo(), budM, null);
}

