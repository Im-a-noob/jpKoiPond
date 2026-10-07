// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets } from "../geometry";
import { $, progress, toast } from "../state";
import { SH, scene, camera, sunState } from "./lighting";
import { WF } from "./waterfallMesh";
import { terrainHeight } from "./terrain";
import { waterHeightAt, addDrop } from "./water";
import { AUDIO } from "./audio";
import { RT } from "../state";
import { SPLASH } from "./handCollisions";
const _sv = new THREE.Vector3(), _fw = new THREE.Vector3(), _sj = new THREE.Vector3();
/* ------------------------------------------------------------------ 13d. BUBBLES + PHYSICAL SPLASH AUDIO */
// Bubbles: silvery spheres (total internal reflection at the air/water interface), oblate and wobbling when big,
// rising at a size-dependent terminal speed (~0.1 m/s at 0.5 mm, ~0.25 m/s at 2 mm) with a zig-zag; entrained by
// splashes (a short downward plume first), released from koi gills after gulping air at the surface, by the turtle's
// plunge and exhalation, and constantly at the foot of the waterfall. They pop at the surface with a tiny ripple.
export const BUB = { n: 700, next: 0, list: [], mesh: null };
export const BUB_VS = /* glsl */`
varying vec3 vN;
varying vec3 vW;
void main(){
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
export const BUB_FS = /* glsl */`
uniform vec3 uSunDirW;
uniform vec3 uInscatter;
uniform vec3 uSunColor;
uniform float uCamUnder;
varying vec3 vN;
varying vec3 vW;
void main(){
  vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 2.2);                              // mirror-bright rim from total internal reflection
  float spec = pow(max(dot(reflect(-v, n), normalize(uSunDirW + vec3(0.0, 0.6, 0.0))), 0.0), 80.0);
  vec3 col = mix(uInscatter * 1.4, vec3(0.78, 0.9, 0.95) * (0.35 + uSunColor * 0.25), rim) + uSunColor * spec * 1.5;
  float dist = length(cameraPosition - vW);
  float a = (0.12 + 0.8 * rim + spec) * exp(-dist * 0.35);
  col = mix(uInscatter, col, exp(-dist * 0.45));
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
}`;
export function buildBubbles() {
  const mat = new THREE.ShaderMaterial({ vertexShader: BUB_VS, fragmentShader: BUB_FS, transparent: true, depthWrite: false,
    uniforms: { uSunDirW: SH.uSunDirW, uInscatter: SH.uInscatter, uSunColor: SH.uSunColor, uCamUnder: SH.uCamUnder } });
  BUB.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), mat, BUB.n);
  BUB.mesh.frustumCulled = false; BUB.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); BUB.mesh.count = 0;
  setLayer(BUB.mesh, LAYER.UNDER); scene.add(BUB.mesh);
  for (let i = 0; i < BUB.n; i++) BUB.list.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, life: 0, ph: 0 });
}
// count bubbles around (x,y,z) within `spread`; radii rMin..rMax (m); initial downward speed `down` (plunge)
export function bubbleBurst(x, y, z, count, spread = 0.03, rMin = 0.0005, rMax = 0.003, down = 0) {
  if (!BUB.mesh) return;
  for (let k = 0; k < count; k++) {
    const b = BUB.list[BUB.next]; BUB.next = (BUB.next + 1) % BUB.n;
    const r = Math.exp(lerp(Math.log(rMin), Math.log(rMax), Math.pow(rand(), 1.6)));
    b.p.set(x + rr(-spread, spread), Math.min(y + rr(-spread, spread) * 0.5, WATER_Y - 0.004), z + rr(-spread, spread));
    b.v.set(rr(-0.05, 0.05), -down * rr(0.4, 1.2), rr(-0.05, 0.05)); b.r = r; b.life = 12; b.ph = rand() * 6.28;
  }
}
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(), _be = new THREE.Euler();
export function updateBubbles(t, dt) {
  if (!BUB.mesh || dt <= 0) return;
  // waterfall plunge: a steady stream
  if (WF.impacts && WF.impacts.length) { BUB.wfT = (BUB.wfT || 0) - dt; if (BUB.wfT < 0) { BUB.wfT = 0.04; for (const I of WF.impacts) if (I.pond) bubbleBurst(I.p.x, WATER_Y - 0.03, I.p.z, 4, 0.07, 0.0005, 0.005, 0.45); } }
  let m = 0;
  for (const b of BUB.list) {
    if (b.life <= 0) continue;
    b.life -= dt;
    const vt = Math.min(0.28, 0.06 + b.r * 110);                        // terminal rise speed
    b.v.y += (vt - b.v.y) * Math.min(1, dt * 5);
    b.v.x *= Math.exp(-dt * 3); b.v.z *= Math.exp(-dt * 3);
    const wob = b.r > 0.0012 ? b.r * 1.6 : 0;                              // zig-zag / spiral of millimetre bubbles
    b.p.x += (b.v.x + Math.cos(t * 9 + b.ph) * wob * 9) * dt; b.p.z += (b.v.z + Math.sin(t * 9 + b.ph) * wob * 9) * dt; b.p.y += b.v.y * dt;
    const floor = terrainHeight(b.p.x, b.p.z) + b.r;
    if (b.p.y < floor) { b.p.y = floor; b.v.y = Math.abs(b.v.y) * 0.2; }
    const surf = waterHeightAt(b.p.x, b.p.z, t);
    if (b.p.y >= surf - b.r) { b.life = 0; if (b.r > 0.002 && rand() < 0.35) addDrop(b.p.x, b.p.z, 0.02, -0.0006); continue; }
    const obl = b.r > 0.0015 ? 0.72 + 0.1 * Math.sin(t * 20 + b.ph) : 1;
    _be.set(0.3 * Math.sin(t * 7 + b.ph), b.ph, 0); _bq.setFromEuler(_be); _bs.set(b.r / Math.sqrt(obl), b.r * obl, b.r / Math.sqrt(obl));
    BUB.mesh.setMatrixAt(m++, _bm.compose(b.p, _bq, _bs));
  }
  BUB.mesh.count = m; BUB.mesh.instanceMatrix.needsUpdate = true;
}
// --- Splash audio from first principles: an impact slap plus a cloud of bubble resonances (Minnaert: f = 3.26 / r)
// that chirp upward as each bubble rises and decay at van den Doel's damping rate; late droplet "plinks" follow.
export function splashSound(size, pan = 0, gain = 1, t0 = 0) {
  const ctx = AUDIO.ctx; if (!ctx || !P.audio) return;
  const now = ctx.currentTime;
  if (now < (AUDIO.splashBusy || 0) && size < 0.6) return;                 // voice limiting in a feeding frenzy
  AUDIO.splashBusy = now + 0.035;
  const t = now + t0, out = ctx.createGain(), pn = ctx.createStereoPanner();
  out.gain.value = gain; pn.pan.value = clamp(pan, -1, 1); out.connect(pn).connect(AUDIO.bus);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = AUDIO.white; f.type = 'bandpass'; f.frequency.value = 2200 - size * 1300; f.Q.value = 0.6;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 + 0.12 * size, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045 + size * 0.14);
  s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 2); s.stop(t + 0.3);
  const bubble = (r, onset, amp) => {
    const f0 = clamp(3.26 / r, 350, 9000), d = 0.13 * f0 + 0.0072 * Math.pow(f0, 1.5), dur = Math.min(0.3, 5 / d);
    const o = ctx.createOscillator(), bg = ctx.createGain();
    o.frequency.setValueAtTime(f0, onset); o.frequency.exponentialRampToValueAtTime(f0 * 1.35, onset + dur);
    bg.gain.setValueAtTime(0.0001, onset); bg.gain.linearRampToValueAtTime(amp, onset + 0.0015); bg.gain.exponentialRampToValueAtTime(0.0001, onset + dur);
    o.connect(bg).connect(out); o.start(onset); o.stop(onset + dur + 0.02);
  };
  const n = Math.round(5 + size * 26);
  for (let i = 0; i < n; i++) {
    const r = Math.exp(lerp(Math.log(0.0006), Math.log(0.0008 + 0.0045 * size), Math.pow(rand(), 1.4)));
    bubble(r, t + Math.pow(rand(), 2) * (0.03 + 0.22 * size), 0.018 * Math.pow(r / 0.002, 0.5) * rr(0.5, 1));
  }
  for (let i = 0; i < Math.round(size * 7); i++) bubble(rr(0.0008, 0.0022), t + 0.12 + rand() * (0.2 + 0.35 * size), 0.008 * rr(0.5, 1));
}
export function splashAt(x, y, z, size) {
  if (!AUDIO.ctx) return;
  _sv.set(x - camera.position.x, y - camera.position.y, z - camera.position.z);
  const d = _sv.length(); if (d > 25) return;
  camera.getWorldDirection(_fw); const right = _sj.crossVectors(_fw, camera.up).normalize();
  splashSound(size, _sv.dot(right) / Math.max(d, 0.3) * 0.8, 1 / (1 + d * 0.45));
}

export function spawnSplash(x, z, energy, y0 = WATER_Y, silent = false) {
  if (!SPLASH.p) return;
  if (!silent) splashAt(x, y0, z, clamp(energy * 0.6, 0.12, 1));
  if (y0 <= WATER_Y + 0.02) bubbleBurst(x, WATER_Y - 0.01, z, Math.round(3 + energy * 14), 0.02 + energy * 0.03, 0.0004, 0.0015 + energy * 0.002, 0.15 + energy * 0.35);
  const cnt = Math.round(4 + energy * 8);
  for (let k = 0; k < cnt; k++) {
    const i = SPLASH.next; SPLASH.next = (SPLASH.next + 1) % SPLASH.n;
    const a = rand() * Math.PI * 2, sp = rr(0.15, 0.55) * energy;
    SPLASH.p.set([x + Math.cos(a) * 0.02, y0 + 0.005, z + Math.sin(a) * 0.02], i * 3);
    SPLASH.v.set([Math.cos(a) * sp * 0.5, rr(0.5, 1.3) * energy, Math.sin(a) * sp * 0.5], i * 3);
    SPLASH.life[i] = rr(0.6, 1.0);
  }
}
export function updateSplashes(dt) {
  if (!SPLASH.p) return;
  let any = false;
  for (let i = 0; i < SPLASH.n; i++) {
    if (SPLASH.life[i] <= 0) continue;
    any = true;
    SPLASH.v[i * 3 + 1] -= 9.81 * dt;
    SPLASH.p[i * 3] += SPLASH.v[i * 3] * dt; SPLASH.p[i * 3 + 1] += SPLASH.v[i * 3 + 1] * dt; SPLASH.p[i * 3 + 2] += SPLASH.v[i * 3 + 2] * dt;
    SPLASH.life[i] -= dt * 1.4;
    if (SPLASH.p[i * 3 + 1] < WATER_Y) { SPLASH.life[i] = 0; if (rand() < 0.3) addDrop(SPLASH.p[i * 3], SPLASH.p[i * 3 + 2], 0.025, -0.001); }
  }
  SPLASH.pts.visible = any;
  if (any) {
    SPLASH.geo.attributes.position.needsUpdate = true; SPLASH.geo.attributes.aLife.needsUpdate = true;
    const u = SPLASH.pts.material.uniforms;
    u.uScale.value = 0.006 * RT.h / (2 * Math.tan(camera.fov * DEG / 2));
    u.uColor.value.copy(SH.uInscatter.value).multiplyScalar(6).add(new THREE.Color(0.35, 0.38, 0.4).multiplyScalar(0.4 + sunState.intensity * 0.25));
  }
}

