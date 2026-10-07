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
import { IRIS } from "./iris";
import { shoreAt, POLY_LEN, BRIDGE, ground } from "./terrain";
import { TURTLE } from "./turtle";

/* ------------------------------------------------------------------ 9g. DRAGONFLIES */
// Three Japanese pond species: the red aki-akane (Sympetrum), the pruinose-blue shiokara-tombo (Orthetrum) and the
// large green ginyanma (Anax). SDF body (compound eyes, frons, slanted synthorax, ten-segment abdomen, folded legs),
// four veined, iridescent wings with a dark pterostigma. They patrol the pond in darts and hovers, skim the water,
// and (except the hawker Anax) settle on iris bud tips, sunny coping stones and the turtle's rock, taking off if the
// camera comes too close. Perched on a stalk, they ride its wind sway (CPU mirror of the shader wind).
export const DRAGON = { list: [], perches: [] };
export const DF_SPECIES = [
  { name: 'aki-akane', scale: 1.0, perch: true, speed: 0.8, eye: 0x6a2a1a },
  { name: 'aki-akane', scale: 0.95, perch: true, speed: 0.75, eye: 0x6a2a1a },
  { name: 'shiokara-tombo', scale: 1.25, perch: true, speed: 0.9, eye: 0x2a5a6a },
  { name: 'ginyanma', scale: 1.7, perch: false, speed: 1.3, eye: 0x3a7a5a },
];
export function windOffsetJS(p, w, out) {
  // mirror of windOffset() in UW_VS_PARS
  const t = SH.uTime.value, wd = SH.uWindDir.value, uW = SH.uWind.value, uG = SH.uGust.value;
  const ph = (p.x * wd.x + p.z * wd.y) * 0.35;
  const gustWave = 0.55 + 0.45 * Math.sin(t * 0.9 - ph * 1.3) * Math.sin(t * 0.37 - ph * 0.6 + 1.7);
  const sway = Math.sin(t * 1.25 + ph + p.y * 0.3) * 0.55 + Math.sin(t * 2.3 + ph * 1.7) * 0.25;
  const amp = uW * (0.35 + uG * gustWave);
  const ox = wd.x * (amp * 0.6 + amp * 0.5 * sway) * w, oz = wd.y * (amp * 0.6 + amp * 0.5 * sway) * w;
  const fr = (p.x * 3.1) - Math.floor(p.x * 3.1);
  const fl = Math.sin(t * (6.5 + fr * 3.0) + p.x * 4.1 + p.y * 3.3 + p.z * 5.7) * 0.018 * (0.3 + uW) * w;
  return out.set(ox + fl, -Math.abs(ox + oz) * 0.18 * w + fl * 0.6, oz - fl);
}
export function dragonflySDF() {
  const S = SDFK, P3 = [0, 0, 0];
  return (p) => {
    const x = p[0], y = p[1], z = Math.abs(p[2]); P3[0] = x; P3[1] = y; P3[2] = z;
    // head: frons and face between the eyes (the eyes themselves are separate glossy spheres)
    let d = S.ellipsoid(P3, [0.0096, -0.0006, 0], [0.0024, 0.0028, 0.0036]);
    d = S.smin(d, S.sphere(P3, [0.0071, 0.0, 0], 0.0019), 0.001);                                   // prothorax
    // synthorax, slanted back
    const c = Math.cos(0.45), s = Math.sin(0.45), tx = x - 0.0018, ty = y + 0.0003;
    d = S.smin(d, S.ellipsoid([tx * c - ty * s, tx * s + ty * c, z], [0, 0, 0], [0.0052, 0.0046, 0.0036]), 0.0012);
    // abdomen: ten segments with intersegmental grooves, swollen S1-3, slender middle, slight club at S7-8
    const ax = -0.0035, L = 0.03;
    if (x < ax + 0.002) {
      const u = clamp((ax - x) / L, 0, 1);
      const r = (0.0021 * (1 - smoothstep(0.0, 0.22, u)) + 0.00135 + 0.00032 * Math.exp(-(((u - 0.74) / 0.1) ** 2))) * (1 - 0.35 * smoothstep(0.9, 1.0, u));
      const seg = u * 10, groove = Math.exp(-(((seg - Math.round(seg)) / 0.09) ** 2)) * (u > 0.02 ? 1 : 0);
      const cy = -0.0004 - 0.0016 * u * u;                                                           // droops a little toward the tip
      const da = Math.hypot(y - cy, z) - r * (1 - 0.1 * groove);
      const cap = Math.max(x - (ax + 0.002), ax - L - x);                                             // ends
      d = S.smin(d, Math.max(da, cap), 0.0014);
    }
    // anal appendages
    d = S.smin(d, S.cone(P3, [-0.0335, -0.002, 0.0004], [-0.0365, -0.0022, 0.0009], 0.0004, 0.00022), 0.0003);
    // six legs folded forward under the thorax, spiny
    for (const [lx, a] of [[0.0048, 0.55], [0.0022, 0.35], [-0.0004, 0.15]]) {
      const hip = [lx, -0.0032, 0.0012], knee = [lx + 0.0035 * Math.cos(a), -0.0068, 0.0032], foot = [lx + 0.0062, -0.0084, 0.0022];
      d = S.smin(d, S.cone(P3, hip, knee, 0.00045, 0.0003), 0.0004);
      d = S.smin(d, S.cone(P3, knee, foot, 0.0003, 0.00016), 0.0002);
    }
    return d;
  };
}
export const DF_VS = 'varying vec3 vDL;\n';
export const DF_FS_PARS = /* glsl */`
varying vec3 vDL;
uniform float uSp;
float dh(float n){ return fract(sin(n) * 43758.5453); }
`;
export const DF_MAP = /* glsl */`
vec3 p = vDL;
float abd = step(p.x, -0.003);
float u = clamp((-0.0035 - p.x) / 0.03, 0.0, 1.0);
float seg = u * 10.0, fs = fract(seg);
float ring = 1.0 - smoothstep(0.0, 0.12, min(fs, 1.0 - fs));
float top = smoothstep(-0.0015, 0.0012, p.y);
float legs = step(p.y, -0.0034) * step(-0.002, p.x);
vec3 col;
if (uSp < 0.5) {             // aki-akane: scarlet abdomen with dark segment lines and a black lateral keel, red-brown thorax
  vec3 abdC = mix(vec3(0.62, 0.1, 0.06), vec3(0.78, 0.16, 0.08), top);
  abdC = mix(abdC, vec3(0.12, 0.03, 0.02), clamp(ring * 0.7 + (1.0 - smoothstep(0.0, 0.0006, abs(p.y + 0.0006 + 0.0014 * u * u))) * step(0.3, u) * 0.5, 0.0, 1.0));
  vec3 thC = mix(vec3(0.42, 0.16, 0.08), vec3(0.6, 0.26, 0.12), top);
  thC = mix(thC, vec3(0.08, 0.04, 0.03), smoothstep(0.7, 0.9, sin(p.x * 2200.0 + p.y * 1600.0)) * 0.6);
  col = mix(thC, abdC, abd);
  col = mix(col, vec3(0.75, 0.3, 0.16), step(0.0075, p.x) * 0.8);                              // red face
} else if (uSp < 1.5) {      // shiokara-tombo: pale blue-grey bloom on S1-7, black S8-10, dark thorax
  vec3 abdC = mix(vec3(0.3, 0.37, 0.43), vec3(0.46, 0.54, 0.62), top);
  abdC = mix(abdC, vec3(0.05, 0.05, 0.06), clamp(smoothstep(0.66, 0.72, u) + ring * 0.35, 0.0, 1.0));
  vec3 thC = mix(vec3(0.12, 0.12, 0.1), vec3(0.34, 0.38, 0.42), top * 0.6);
  col = mix(thC, abdC, abd);
  col = mix(col, vec3(0.62, 0.62, 0.58), step(0.985, u));                                           // pale appendages
} else {                     // ginyanma: grass-green thorax, sky-blue S2, brown abdomen with dark dorsal marks
  vec3 thC = mix(vec3(0.32, 0.55, 0.14), vec3(0.5, 0.72, 0.2), top);
  vec3 abdC = mix(vec3(0.34, 0.24, 0.14), vec3(0.5, 0.36, 0.2), top);
  abdC = mix(abdC, vec3(0.2, 0.55, 0.78), (1.0 - smoothstep(0.08, 0.2, u)));
  abdC = mix(abdC, vec3(0.08, 0.06, 0.04), clamp(ring * 0.6 + smoothstep(0.6, 0.9, sin(fs * 6.2832) * top) * 0.5, 0.0, 1.0) * step(0.2, u));
  col = mix(thC, abdC, abd);
  col = mix(col, vec3(0.45, 0.62, 0.3), step(0.0075, p.x));
}
col = mix(col, vec3(0.05, 0.04, 0.035), legs);
diffuseColor.rgb = pow(clamp(col, 0.0, 1.0), vec3(2.2));
`;
export function dragonflyWingTex(hind, amber) {
  // span along x (root at left), chord along y (leading edge at the top); membrane faint, veins dark, pterostigma
  const W = 512, H = 128, cv = makeCanvas(W, H), g = cv.getContext('2d');
  const R = mulberry32(hind ? 91 : 57);
  const outline = new Path2D();
  const chordAt = (t) => (hind ? 0.46 + 0.5 * Math.exp(-(((t - 0.18) / 0.22) ** 2)) : 0.42 + 0.12 * Math.sin(Math.PI * Math.min(1, t * 1.2))) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 6)));
  outline.moveTo(0, 18);
  for (let i = 0; i <= 64; i++) { const t = i / 64; outline.lineTo(t * W, 14 + (1 - t) * 4); }
  for (let i = 64; i >= 0; i--) { const t = i / 64; outline.lineTo(t * W, 14 + chordAt(t) * (H - 20)); }
  outline.closePath();
  g.save(); g.clip(outline);
  const base = g.createLinearGradient(0, 0, W, 0);
  base.addColorStop(0, amber ? 'rgba(200,120,30,0.5)' : 'rgba(170,180,190,0.14)'); base.addColorStop(0.16, 'rgba(180,188,198,0.07)'); base.addColorStop(1, 'rgba(190,196,206,0.05)');
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  // crossvein network: irregular cells, finer toward the trailing edge and the tip
  g.strokeStyle = 'rgba(30,26,22,0.55)'; g.lineWidth = 0.8;
  for (let i = 0; i < 520; i++) {
    const x = R() * W, y = 14 + R() * (H - 14), l = 4 + R() * 7;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 3, y + l); g.stroke();
  }
  for (let k = 0; k < 9; k++) {                               // longitudinal veins
    const y0 = 16 + k * (H - 30) / 9;
    g.strokeStyle = `rgba(25,20,16,${0.75 - k * 0.05})`; g.lineWidth = k < 2 ? 2.2 : 1.1;
    g.beginPath(); g.moveTo(0, 17 + k * 2); g.quadraticCurveTo(W * 0.4, y0 + k * 1.5, W, 16 + k * 5 * (hind ? 1.2 : 1)); g.stroke();
  }
  g.fillStyle = 'rgba(25,18,12,0.95)'; g.fillRect(W * 0.84, 14, W * 0.07, 7);            // pterostigma
  g.fillStyle = 'rgba(30,22,16,0.9)'; g.fillRect(W * 0.52, 14, 3, 9);                    // nodus
  g.restore();
  g.strokeStyle = 'rgba(20,16,12,0.9)'; g.lineWidth = 1.2; g.stroke(outline);
  const t = canvasTex(cv); t.anisotropy = 4; return t;
}
export function buildDragonflies() {
  // perches: iris bud tips (sway with the wind), sunny coping stones, the turtle's rock
  for (const b of IRIS.buds || []) DRAGON.perches.push({ p: b.p.clone().addScaledVector(b.t, 0.092), stalk: true, yawFree: true });
  for (let s = 0.05; s < 0.7; s += 0.035) { const sh = shoreAt(s * POLY_LEN); DRAGON.perches.push({ p: new THREE.Vector3(sh.x + sh.nx * 0.12, 0.181, sh.z + sh.nz * 0.12), stone: true, yaw: Math.atan2(sh.nz, -sh.nx) }); }
  if (TURTLE.B) DRAGON.perches.push({ p: TURTLE.B.clone().add(new THREE.Vector3(0.1, 0.012, -0.12)), stone: true, rock: true });
  const geo = surfaceNets(dragonflySDF(), [-0.039, -0.0105, -0.0062], [0.0135, 0.0062, 0.0062], 0.00022);
  const eyeGeo = new THREE.SphereGeometry(0.0031, 20, 14);
  const wingFore = [dragonflyWingTex(false, false), dragonflyWingTex(false, true)], wingHind = [dragonflyWingTex(true, false), dragonflyWingTex(true, true)];
  const wingGeo = (span, chord) => { const g = new THREE.PlaneGeometry(span, chord, 6, 2); g.translate(span / 2, -chord / 2 + chord * 0.08, 0); g.rotateX(-Math.PI / 2); return g; };   // root at the origin, span along +x, lying flat
  DF_SPECIES.forEach((sp, i) => {
    const bodyMat = physical({ roughness: 0.4, clearcoat: 0.45, clearcoatRoughness: 0.25, envMapIntensity: 0.8 }, {
      key: 'dfbody', uniforms: { uSp: { value: sp.name === 'aki-akane' ? 0 : sp.name === 'shiokara-tombo' ? 1 : 2 } }, vsPars: DF_VS, vsBegin: 'vDL = position;', fsPars: DF_FS_PARS, fsMap: DF_MAP });
    const eyeMat = physical({ color: sp.eye, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.5, iridescenceIOR: 1.4, envMapIntensity: 1.5 }, { key: 'dfeye' });
    const amber = sp.name === 'aki-akane' ? 1 : 0;
    const mkWingMat = (tex) => physical({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.1, metalness: 0, iridescence: 0.7, iridescenceIOR: 1.3,
      iridescenceThicknessRange: [250, 650], envMapIntensity: 0.55, specularIntensity: 0.6 }, { key: 'dfwing' });
    const root = new THREE.Group(), body = new THREE.Group();
    const bm = new THREE.Mesh(geo, bodyMat); bm.castShadow = true; body.add(bm);
    for (const s of [1, -1]) { const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(0.0086, 0.0014, s * 0.0027); e.scale.set(1, 1.05, 0.95); body.add(e); }
    const wings = [];
    const span = 0.029, chord = 0.0075;
    for (const [hind, s] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
      const hinge = new THREE.Group(); hinge.position.set(hind ? -0.0006 : 0.0026, 0.0042, s * 0.0008);
      const m = new THREE.Mesh(wingGeo(hind ? span * 0.96 : span, hind ? chord * 1.25 : chord), mkWingMat(hind ? wingHind[amber] : wingFore[amber]));
      m.rotation.y = -s * Math.PI / 2;                                  // span out to the side (+z right / -z left)
      if (s < 0) m.scale.z = -1;
      m.renderOrder = 3; hinge.add(m); body.add(hinge);
      wings.push({ hinge, hind, s, mat: m.material });
    }
    root.add(body); root.scale.setScalar(sp.scale);
    setLayer(root, LAYER.ABOVE); scene.add(root);
    let x, z, g = 0; do { x = rr(-2.5, 2.5); z = rr(-4.5, 4.5); } while (sdf(x, z) > -0.3 && g++ < 50);
    DRAGON.list.push({ sp, root, body, wings, p: new THREE.Vector3(x, WATER_Y + rr(0.3, 0.8), z), v: new THREE.Vector3(), target: new THREE.Vector3(), state: 'fly', timer: rr(0.5, 3),
      legs: 0, yaw: rand() * 6.28, pitch: 0, roll: 0, flap: rand() * 6, hops: 0, perch: null, cool: rr(4, 12) });
  });
}
const _dv = new THREE.Vector3(), _dw = new THREE.Vector3(), _dq = new THREE.Quaternion();
export function dfNewTarget(D) {
  const over = rand() < 0.8;
  let x, z, g = 0;
  do { x = D.p.x + rr(-2.2, 2.2); z = D.p.z + rr(-2.2, 2.2); } while ((over ? sdf(x, z) > -0.2 : sdf(x, z) > 1.5) && g++ < 40);
  if (g >= 40) { x = rr(-2, 2); z = rr(-4, 4); }
  const skim = rand() < 0.3;
  D.target.set(x, WATER_Y + (skim ? rr(0.06, 0.14) : rr(0.25, 1.1)), z);
  if (Math.abs(z - BRIDGE.z) < 1.0 && Math.abs(x) < BRIDGE.half + 0.3) D.target.z = BRIDGE.z + Math.sign(z - BRIDGE.z || 1) * 1.2;   // not under the bridge deck
}
export function updateDragonflies(t, dt) {
  if (!DRAGON.list.length || dt <= 0 || DRAGON.off) return;
  for (const D of DRAGON.list) {
    D.timer -= dt; D.cool -= dt;
    const camD = camera.position.distanceTo(D.p);
    if (D.state === 'fly' || D.state === 'hover') {
      if (D.state === 'fly') {
        _dv.subVectors(D.target, D.p); const dist = _dv.length();
        const spd = D.sp.speed * (dist > 0.6 ? 1 : 0.4 + dist);
        _dv.normalize().multiplyScalar(spd);
        const acc = 3.5 * D.sp.scale;
        _dw.subVectors(_dv, D.v); const dl = _dw.length(); if (dl > acc * dt) _dw.multiplyScalar(acc * dt / dl);
        D.v.add(_dw);
        if (dist < 0.12) { D.state = 'hover'; D.timer = rr(0.4, 1.8); D.hops++; }
      } else {
        D.v.multiplyScalar(Math.exp(-dt * 6));
        D.v.x += rr(-1, 1) * dt * 0.8; D.v.y += rr(-1, 1) * dt * 0.5; D.v.z += rr(-1, 1) * dt * 0.8;
        if (D.timer < 0) {
          if (D.sp.perch && D.hops > 3 && D.cool < 0 && DRAGON.perches.length) {
            // pick a free perch within reach
            const cand = DRAGON.perches.filter((q) => !q.busy && q.p.distanceTo(D.p) < 4 && !(q.rock && TURTLE.pos.distanceTo(q.p) < 0.25));
            if (cand.length) { D.perch = cand[(rand() * cand.length) | 0]; D.perch.busy = true; D.state = 'approach'; D.hops = 0; continue; }
          }
          D.state = 'fly'; dfNewTarget(D);
        }
      }
      D.p.addScaledVector(D.v, dt);
      // never into the water or the ground
      const floor = sdf(D.p.x, D.p.z) < 0 ? WATER_Y + 0.04 : ground(D.p.x, D.p.z) + 0.15;
      if (D.p.y < floor) { D.p.y = floor; D.v.y = Math.abs(D.v.y) * 0.3; }
      if (D.p.y > 2.2) D.v.y -= dt * 2;
      if (Math.abs(D.p.z - BRIDGE.z) < BRIDGE.width / 2 + 0.25 && Math.abs(D.p.x) < BRIDGE.half + 0.2 && D.p.y < 1.45) D.v.y += dt * 4;   // hop over the bridge
      if (D.state === 'fly' && D.v.lengthSq() > 0.01) {
        const yw = Math.atan2(-D.v.z, D.v.x); let dy = yw - D.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        D.yaw += dy * (1 - Math.exp(-dt * 10)); D.roll = lerp(D.roll, clamp(-dy * 2, -0.6, 0.6), 1 - Math.exp(-dt * 8));
        D.pitch = lerp(D.pitch, clamp(D.v.y * 0.6, -0.4, 0.4), 1 - Math.exp(-dt * 6));
      } else { D.roll = lerp(D.roll, 0, 1 - Math.exp(-dt * 5)); D.pitch = lerp(D.pitch, 0.12, 1 - Math.exp(-dt * 5)); }
    } else if (D.state === 'approach' || D.state === 'perch') {
      const q = D.perch; _dw.copy(q.p);
      if (q.stalk) _dw.add(windOffsetJS(q.p, Math.pow(clamp((q.p.y - WATER_Y) / 0.9, 0, 1), 1.5) * 0.5, _dv));
      _dw.y += 0.0078 * D.sp.scale;                                   // legs on the perch, not the body
      if (D.state === 'approach') {
        _dv.subVectors(_dw, D.p); const dist = _dv.length();
        const spd = Math.min(D.sp.speed, 0.15 + dist * 2);
        D.v.lerp(_dv.normalize().multiplyScalar(spd), 1 - Math.exp(-dt * 6));
        D.p.addScaledVector(D.v, dt);
        const yw = Math.atan2(-D.v.z, D.v.x); let dy = yw - D.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        if (dist > 0.05) D.yaw += dy * (1 - Math.exp(-dt * 8));
        D.pitch = lerp(D.pitch, 0, 1 - Math.exp(-dt * 5)); D.roll = lerp(D.roll, 0, 1 - Math.exp(-dt * 5));
        if (dist < 0.01) { D.state = 'perch'; D.timer = rr(5, 14); D.v.set(0, 0, 0); }
      } else {
        D.p.lerp(_dw, 1 - Math.exp(-dt * 20));
        D.pitch = lerp(D.pitch, q.stalk ? 0.18 : 0.0, 1 - Math.exp(-dt * 4)); D.roll = lerp(D.roll, 0, 1 - Math.exp(-dt * 4));
        if (rand() < dt * 0.4) D.yaw += rr(-0.4, 0.4);                  // shuffles to face the sun
        if (D.timer < 0 || camD < 0.12) { q.busy = false; D.perch = null; D.state = 'fly'; D.cool = rr(10, 25); dfNewTarget(D); D.v.set(0, 1.2, 0).add(_dv.set(rr(-0.4, 0.4), 0, rr(-0.4, 0.4))); }
      }
    }
    D.root.position.copy(D.p);
    D.root.rotation.set(D.roll, D.yaw, D.pitch, 'YZX');
    // wings: a blur of fast strokes in flight (fore and hind out of phase), still when perched
    const flying = D.state !== 'perch';
    D.flap += dt * (flying ? 2 * Math.PI * 27 : 0);
    for (const w of D.wings) {
      let a;
      if (flying) a = 0.18 + 0.75 * Math.sin(D.flap + (w.hind ? 1.6 : 0));
      else a = D.sp.name === 'aki-akane' ? -0.12 : -0.03;                 // resting: level, the red darter's tilted slightly down and forward
      const sweep = flying ? 0 : (w.hind ? -0.12 : D.sp.name === 'aki-akane' ? 0.35 : 0.12);
      w.hinge.rotation.set(-w.s * a, w.s * sweep, 0, 'XYZ');
      w.mat.opacity = flying ? 0.55 : 1;
    }
  }
}

