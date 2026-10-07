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
import { terrainHeight } from "./terrain";
/* ------------------------------------------------------------------ 9a3. SACRED LOTUS (Nelumbo nucifera) */
// After botanical references: ~22 broad, concave, spoon-shaped tepals in a spiral of four whorls forming an open bowl
// (outer ones spreading, inner ones upright and incurved), creamy white at the base flushing to rose at the tip and
// margins, with fine parallel veins converging on the tip; a golden, inverted-cone receptacle whose flat top carries
// ~19 pistils; a dense ring of ~170 stamens (slender filaments, long golden anthers, a pale club-shaped appendage);
// reflexed green sepals. Plus a closed teardrop bud and a nodding green seed pod ("showerhead") on their own stalks.
export function lotusPetalTex() {
  const W = 256, H = 512, cv = makeCanvas(W, H), g = cv.getContext('2d');
  let gr = g.createLinearGradient(0, H, 0, 0);
  gr.addColorStop(0, '#efe6c4'); gr.addColorStop(0.18, '#fbf4ec'); gr.addColorStop(0.5, '#fbdfe7'); gr.addColorStop(0.78, '#f2aac2'); gr.addColorStop(0.93, '#e27aa0'); gr.addColorStop(1, '#d4608c');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const eg = g.createLinearGradient(0, 0, W, 0);
  eg.addColorStop(0, 'rgba(226,108,150,0.55)'); eg.addColorStop(0.2, 'rgba(226,108,150,0)'); eg.addColorStop(0.8, 'rgba(226,108,150,0)'); eg.addColorStop(1, 'rgba(226,108,150,0.55)');
  const vm = g.createLinearGradient(0, H, 0, 0); vm.addColorStop(0, 'rgba(0,0,0,0)'); vm.addColorStop(0.45, 'rgba(0,0,0,0.6)'); vm.addColorStop(1, 'rgba(0,0,0,1)');
  g.save(); g.globalAlpha = 1; g.fillStyle = eg; g.globalCompositeOperation = 'source-atop';
  // margins flush only toward the tip
  const tmp = makeCanvas(W, H), tg = tmp.getContext('2d'); tg.fillStyle = eg; tg.fillRect(0, 0, W, H); tg.globalCompositeOperation = 'destination-in'; tg.fillStyle = vm; tg.fillRect(0, 0, W, H);
  g.drawImage(tmp, 0, 0); g.restore();
  // parallel veins converging on the tip, strongest in the pink half
  const vg = g.createLinearGradient(0, H, 0, 0); vg.addColorStop(0, 'rgba(210,120,150,0.04)'); vg.addColorStop(0.5, 'rgba(206,92,132,0.22)'); vg.addColorStop(1, 'rgba(180,60,105,0.4)');
  g.strokeStyle = vg;
  for (let i = 0; i < 34; i++) {
    const x0 = W * (i + 0.5) / 34, xt = W / 2 + (x0 - W / 2) * 0.12;
    g.lineWidth = i % 3 === 0 ? 1.4 : 0.8;
    g.beginPath(); g.moveTo(x0 * 0.7 + W * 0.15, H); g.bezierCurveTo(x0, H * 0.6, x0 + (x0 - W / 2) * 0.05, H * 0.2, xt, 2); g.stroke();
  }
  g.strokeStyle = 'rgba(200,110,140,0.25)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 4); g.stroke();
  // faint satin texture
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`; g.fillRect(Math.random() * W, Math.random() * H, 1, 3 + Math.random() * 6); }
  const t = canvasTex(cv); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
export function lotusPodTopTex() {
  const N = 256, cv = makeCanvas(N, N), g = cv.getContext('2d');
  const gr = g.createRadialGradient(N / 2, N / 2, 4, N / 2, N / 2, N / 2); gr.addColorStop(0, '#9aa24c'); gr.addColorStop(0.85, '#7f8a3a'); gr.addColorStop(1, '#5f6a2a');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  const holes = [[0, 0]]; for (let r = 1; r <= 2; r++) for (let i = 0; i < r * 7; i++) { const a = i / (r * 7) * Math.PI * 2 + r; holes.push([Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3]); }
  for (const [x, y] of holes) {
    const cx = N / 2 + x * N * 0.5, cy = N / 2 + y * N * 0.5, r = N * 0.052;
    g.fillStyle = '#3c4318'; g.beginPath(); g.arc(cx, cy, r, 0, 6.28); g.fill();
    const sg = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r * 0.8); sg.addColorStop(0, '#c4cc78'); sg.addColorStop(1, '#6f7a2e');
    g.fillStyle = sg; g.beginPath(); g.arc(cx, cy, r * 0.72, 0, 6.28); g.fill();
  }
  return canvasTex(cv);
}
export function coloredCyl(r0, r1, len, col, from, dir) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1); g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)); g.translate(from.x, from.y, from.z);
  const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
}
export function buildSacredLotus(stemMat) {
  const tex = lotusPetalTex();
  const petalMat = physical({ map: tex, side: THREE.DoubleSide, roughness: 0.5, sheen: 0.7, sheenRoughness: 0.35, sheenColor: new THREE.Color(0xffe6ee), envMapIntensity: 0.6 },
    { key: 'lotuspetal2', leaf: true, uniforms: { uTransl: { value: 0.85 } } });
  const greenMat = physical({ color: 0x6f8a3c, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0xc8dca0) }, { key: 'lotusgreen', leaf: true, uniforms: { uTransl: { value: 0.4 } } });
  const recMat = physical({ color: 0xd4c24a, roughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(0xfff0a0) }, { key: 'lotusrec' });
  const pistilMat = physical({ color: 0xe9d56a, roughness: 0.45 }, { key: 'lotuspistil' });
  const stamenMat2 = physical({ vertexColors: true, roughness: 0.55, sheen: 0.5, sheenColor: new THREE.Color(0xfff2b0) }, { key: 'lotusstamen2', leaf: true, uniforms: { uTransl: { value: 0.5 } } });
  const V3 = THREE.Vector3;
  const flower = (open) => {
    const grp = new THREE.Group(), parts = [];
    const whorls = [[5, 0.1, 0.034, 0.32, 0.5, 0.024], [6, 0.104, 0.035, 0.62, 0.86, 0.022], [6, 0.098, 0.033, 0.8, 1.0, 0.021], [5, 0.086, 0.029, 0.98, 1.18, 0.021]];   // W = half-width
    let k = 0;
    whorls.forEach(([n, L, W, t0, t1, r0], wi) => {
      for (let i = 0; i < n; i++, k++) {
        const pg = irisPetal({ L: L * rr(0.94, 1.05), W: W * rr(0.92, 1.06), haft: 0.5, wMax: 0.52, th0: lerp(1.35, t0, open) + rr(-0.05, 0.05), th1: lerp(1.6, t1, open) + rr(-0.06, 0.06),
          thP: 1.1, cup: -0.009, ruffle: 0.0005, ux0: 0, ux1: 1, nu: 16, nv: 10, seed: k, r0, y0: wi * 0.005 });
        pg.rotateY(k * 2.39996 + rr(-0.1, 0.1)); parts.push(pg);
      }
    });
    const pm = new THREE.Mesh(mergeGeos(parts), petalMat); pm.castShadow = true; grp.add(pm);
    const sep = [];
    for (let i = 0; i < 3; i++) { const g = irisPetal({ L: 0.034, W: 0.011, haft: 0.5, wMax: 0.5, th0: -0.1, th1: -0.7, cup: -0.004, ux0: 0, ux1: 1, nu: 6, nv: 4, r0: 0.01, y0: -0.012 }); g.rotateY(i * 2.1 + 0.4); sep.push(g); }
    grp.add(new THREE.Mesh(mergeGeos(sep), greenMat));
    // receptacle (inverted cone, flat top) and its pistils
    const rec = new THREE.LatheGeometry([[0.004, -0.03], [0.007, -0.02], [0.013, -0.008], [0.019, 0.004], [0.0225, 0.012], [0.022, 0.0152], [0.014, 0.0168], [0.0001, 0.0172]].map(([r, y]) => new THREE.Vector2(r, y)), 28);
    const rm = new THREE.Mesh(rec, recMat); rm.castShadow = true; grp.add(rm);
    const pis = [];
    for (let r = 0; r <= 2; r++) for (let i = 0; i < Math.max(1, r * 7); i++) { const a = i / Math.max(1, r * 7) * Math.PI * 2 + r, rad = r * 0.0068; const sg = new THREE.SphereGeometry(0.0021, 10, 6); sg.scale(1, 0.7, 1); sg.translate(Math.cos(a) * rad, 0.0178, Math.sin(a) * rad); pis.push(sg); }
    grp.add(new THREE.Mesh(mergeGeos(pis), pistilMat));
    // stamens
    const st = [], cFil = new THREE.Color(0xf2e6b0), cAnt = new THREE.Color(0xe2ae2c), cApp = new THREE.Color(0xf6efd8);
    for (let i = 0; i < 170; i++) {
      const a = i * 2.39996, rad = rr(0.017, 0.022), y = rr(-0.006, 0.006);
      const tilt = rr(0.35, 1.0) * (0.55 + 0.45 * open), d = new V3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize();
      const b = new V3(Math.cos(a) * rad, y, Math.sin(a) * rad), lf = rr(0.008, 0.012), la = rr(0.01, 0.013);
      st.push(coloredCyl(0.00035, 0.0003, lf, cFil, b, d));
      const b2 = b.clone().addScaledVector(d, lf); st.push(coloredCyl(0.0008, 0.0009, la, cAnt, b2, d));
      const b3 = b2.clone().addScaledVector(d, la); st.push(coloredCyl(0.0009, 0.0005, 0.004, cApp, b3, d));
    }
    const sm = new THREE.Mesh(mergeGeos(st), stamenMat2); grp.add(sm);
    return grp;
  };
  const stalk = (x, z, top, r0, seasons = 'SR') => {
    const fy = Math.min(-0.3, terrainHeight(x, z) - 0.02);
    const sm = new THREE.Mesh(taperTube(new THREE.CatmullRomCurve3([new V3(x, fy, z), new V3(x + rr(-0.03, 0.03), (fy + top.y) * 0.5, z + rr(-0.03, 0.03)), top]), 14, 8, r0, r0 * 0.8, 3), stemMat);
    sm.castShadow = true; setLayer(sm, LAYER.BOTH); scene.add(sm); seasonal(sm, seasons);
  };
  // open flower
  const fl = flower(1); fl.position.set(-2.62, WATER_Y + 0.52, -0.15); fl.rotation.set(0.12, 0.3, -0.1); fl.scale.setScalar(1.05);
  setLayer(fl, LAYER.ABOVE); scene.add(fl); seasonal(fl, 'SR'); stalk(-2.62, -0.1, new V3(-2.62, 0.488, -0.15), 0.0065);
  // half-open second flower
  const fl2 = flower(0.35); fl2.position.set(-3.02, WATER_Y + 0.66, 0.36); fl2.rotation.set(-0.08, 1.4, 0.12); fl2.scale.setScalar(0.92);
  setLayer(fl2, LAYER.ABOVE); scene.add(fl2); seasonal(fl2, 'SR'); stalk(-3.0, 0.4, new V3(-3.02, 0.63, 0.36), 0.006);
  // closed bud: three visible petal faces flushed rose at the tip
  const bud = new THREE.LatheGeometry([[0.005, 0], [0.016, 0.012], [0.026, 0.035], [0.028, 0.056], [0.023, 0.08], [0.012, 0.1], [0.0008, 0.118]].map(([r, y]) => new THREE.Vector2(r, y)), 36);
  const bu = bud.attributes.uv; for (let i = 0; i < bu.count; i++) bu.setX(i, bu.getX(i) * 3);
  const bm = new THREE.Mesh(bud, petalMat); bm.castShadow = true; bm.position.set(-2.34, WATER_Y + 0.72, 0.18); bm.rotation.set(0.1, 0, -0.12);
  setLayer(bm, LAYER.ABOVE); scene.add(bm); seasonal(bm, 'SR'); stalk(-2.33, 0.2, new V3(-2.34, 0.72, 0.18), 0.0058);
  // seed pod after the petals have dropped: green showerhead with seeds set in its flat top, nodding on its stalk
  const pod = new THREE.Group();
  const podGeo = new THREE.LatheGeometry([[0.005, -0.04], [0.011, -0.026], [0.021, -0.008], [0.031, 0.007], [0.0345, 0.0145], [0.033, 0.0175], [0.0001, 0.018]].map(([r, y]) => new THREE.Vector2(r, y)), 32);
  const pm = new THREE.Mesh(podGeo, physical({ color: 0x7e8c3c, roughness: 0.55, sheen: 0.35, sheenColor: new THREE.Color(0xd8e6a8) }, { key: 'lotuspod' })); pm.castShadow = true; pod.add(pm);
  const topD = new THREE.Mesh(new THREE.CircleGeometry(0.0335, 40).rotateX(-Math.PI / 2).translate(0, 0.0182, 0), physical({ map: lotusPodTopTex(), roughness: 0.6 }, { key: 'lotuspodtop' })); pod.add(topD);
  pod.position.set(-2.24, WATER_Y + 0.4, -0.3); pod.rotation.set(0.55, 0.8, 0.25);
  setLayer(pod, LAYER.ABOVE); scene.add(pod); seasonal(pod, 'SRA');
  const podBase = new V3(0, -0.04, 0).applyEuler(pod.rotation).add(pod.position);
  stalk(-2.2, -0.24, podBase, 0.0058, 'SRA');
  WORLD.lotusFlower = fl;
}

