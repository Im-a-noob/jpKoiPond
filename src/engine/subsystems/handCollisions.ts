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
import { waterHeightAt, addDrop } from "./water";
import { FEED } from "./handMesh";
import { KOI } from "./koi";
import { crInterp, KOI_TOP, KOI_BOT, KOI_W } from "./koiGeometry";
import { terrainHeight } from "./terrain";
const _qk = new THREE.Quaternion(), _ek = new THREE.Euler(), _sk = new THREE.Vector3();

/* ------------------------------------------------------------------ 13g. HAND COLLISIONS */
// The hand is a rigid-bodied rig posed by animation; before every frame is drawn it is pushed clear of anything
// solid it would pass through: koi bodies (the exact analytic body the vertex shader draws: section profile,
// girth, the swimming spine wave and the fish's roll/pitch), the pond floor and banks, and the rocks.
export const HANDCOL = { pts: [], o: new THREE.Vector3(), ray: new THREE.Raycaster(), inv: new THREE.Matrix4(), m: new THREE.Matrix4(), v: new THREE.Vector3(), down: new THREE.Vector3(0, -1, 0) };
HANDCOL.ray.layers.enableAll();
// the koi body surface in the fish's local frame (length 1): top and bottom of the section at (s, lateral z)
export function koiSpan(f, s, lz) {
  if (s < 0 || s > 1) return null;
  const bulk = smoothstep(0.03, 0.16, s) * (1 - 0.5 * smoothstep(0.7, 1.0, s));
  const top = crInterp(KOI_TOP, s) * (1 + 0.06 * bulk), bot = crInterp(KOI_BOT, s) * (1 + 0.06 * bulk), w = crInterp(KOI_W, s) * (1 + 0.2 * bulk);
  const gm = smoothstep(0.08, 0.35, s) * (1 - smoothstep(0.72, 1.0, s)), g = lerp(1, f.girth, gm);
  const A = f.amp * (0.05 + 0.95 * s * s), lat = A * Math.sin(s * 5.7 - f.phase) + f.bend * (s - 0.3) * (s - 0.3);
  const z = Math.abs(lz - lat), W = w * g;
  if (z > W) return { W, top: g * (top + bot) / 2, bot: g * (top + bot) / 2, out: z - W };
  const sn = Math.pow(z / W, 1 / 0.9), c = Math.sqrt(Math.max(0, 1 - sn * sn)), yc = (top + bot) / 2;
  return { W, top: g * (yc + (top - yc) * Math.pow(c, 0.92)), bot: g * (yc - (yc - bot) * Math.pow(c, 0.88)), out: 0 };
}
// a point on the koi's back (top of the body the shader draws, on the swimming spine) at fraction s snout->tail
export function koiBackPoint(f, s, out) {
  const A = f.amp * (0.05 + 0.95 * s * s), lat = A * Math.sin(s * 5.7 - f.phase) + f.bend * (s - 0.3) * (s - 0.3);
  const sp = koiSpan(f, s, lat);
  HANDCOL.m.compose(f.p, _qk.setFromEuler(_ek.set(f.roll, f.heading, f.pitch, 'YZX')), _sk.setScalar(f.size));
  return out.set(0.5 - s, (sp ? sp.top : 0.1) + 0.002, lat).applyMatrix4(HANDCOL.m);
}
// how far (world metres, straight up) a sphere at p with radius r must rise to clear this koi
export function koiLift(f, p, r) {
  HANDCOL.m.compose(f.p, _qk.setFromEuler(_ek.set(f.roll, f.heading, f.pitch, 'YZX')), _sk.setScalar(f.size));
  HANDCOL.inv.copy(HANDCOL.m).invert();
  const l = HANDCOL.v.copy(p).applyMatrix4(HANDCOL.inv), rl = r / f.size;
  const sp = koiSpan(f, 0.5 - l.x, l.z);
  if (!sp || sp.out > rl) return 0;
  const clear = Math.sqrt(Math.max(0, rl * rl - sp.out * sp.out));
  if (l.y > sp.top + clear || l.y < sp.bot - clear) return 0;
  return (sp.top + clear - l.y) * f.size;
}
export function handSamplePoints(H) {
  const P = HANDCOL.pts; P.length = 0;
  const add = (o, x, y, z, r) => { const v = new THREE.Vector3(x, y, z); o.localToWorld(v); P.push([v, r]); };
  for (const name of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
    const j = H.J[name];
    add(H.tips[name], 0, 0, 0, 0.0075);
    add(j[2], 0, 0, 0, 0.0085); add(j[1], 0, 0, 0, 0.009); add(j[0], 0, 0, 0, 0.0095);
    add(j[2], 0.012, 0, 0, 0.008); add(j[1], 0.015, 0, 0, 0.0085);
  }
  for (const [x, z] of [[0.015, 0.03], [0.015, -0.03], [0.045, 0.034], [0.045, -0.03], [0.07, 0.02], [0.07, -0.02], [0.04, 0]]) add(H.palm, x, -0.004, z, 0.013);
  for (const x of [-0.04, -0.12, -0.2, -0.28]) add(H.root, x, 0.002, 0, 0.03 + (-x) * 0.02);
  return P;
}
// Resolve the posed hand against the scene; returns the lift applied (and how much of it came from a koi)
export function resolveHandCollisions(H, skipFish, state, dt) {
  let total = 0, fishLift = 0;
  const y0 = H.root.position.y;
  for (let iter = 0; iter < 4; iter++) {
    H.root.updateMatrixWorld(true);
    const pts = handSamplePoints(H);
    let lift = 0, fl = 0;
    const fishes = skipFish ? [] : KOI.fish.slice(0, Math.min(P.fishCount, KOI.fish.length)).filter((f) => f.p.distanceTo(H.root.position) < f.size + 0.45);
    const solids = (WORLD.solids || []).filter((m) => m.visible);
    for (const [p, r] of pts) {
      for (const f of fishes) { const d = koiLift(f, p, r); if (d > lift) { lift = d; fl = d; } }
      const floor = terrainHeight(p.x, p.z) + r;                    // pond floor or bank
      if (floor - p.y > lift) lift = floor - p.y;
      if (solids.length) {
        HANDCOL.ray.set(HANDCOL.o.set(p.x, p.y + 0.6, p.z), HANDCOL.down); HANDCOL.ray.far = 0.6 + r;
        const hit = HANDCOL.ray.intersectObjects(solids, false)[0];
        if (hit && hit.point.y + r - p.y > lift) lift = hit.point.y + r - p.y;
      }
    }
    if (lift <= 1e-4) break;
    H.root.position.y += lift + 0.001; total += lift + 0.001; fishLift = Math.max(fishLift, fl);
  }
  if (state && dt > 0) {
    // filter the correction: rises quickly, relaxes slowly, and never lets more than 2 mm of overlap through
    const k = total > state.lift ? 1 - Math.exp(-dt * 30) : 1 - Math.exp(-dt * 4);
    state.lift = lerp(state.lift, total, k);
    H.root.position.y = y0 + Math.max(state.lift, total - 0.002);
  }
  H.root.updateMatrixWorld(true);
  return { total, fishLift };
}

export const SPLASH = { n: 260, p: null, v: null, life: null, geo: null, pts: null, next: 0 };
export function buildSplashes() {
  SPLASH.p = new Float32Array(SPLASH.n * 3); SPLASH.v = new Float32Array(SPLASH.n * 3); SPLASH.life = new Float32Array(SPLASH.n);
  SPLASH.geo = new THREE.BufferGeometry();
  SPLASH.geo.setAttribute('position', new THREE.BufferAttribute(SPLASH.p, 3));
  SPLASH.geo.setAttribute('aLife', new THREE.BufferAttribute(SPLASH.life, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: { value: 1 }, uColor: { value: new THREE.Color() } },
    vertexShader: /* glsl */`
      // === SPLASH DROPLETS: size-attenuated points, fading with remaining life
      attribute float aLife; uniform float uScale; varying float vL;
      void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aLife > 0.0 ? uScale * (0.5 + aLife) / max(-mv.z, 0.05) : 0.0; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; varying float vL;
      void main(){ vec2 q = gl_PointCoord - 0.5; float r = dot(q, q); if (r > 0.25 || vL <= 0.0) discard;
        float rim = smoothstep(0.12, 0.25, r), spec = smoothstep(0.03, 0.0, dot(q - vec2(-0.12, -0.12), q - vec2(-0.12, -0.12)));
        gl_FragColor = vec4(uColor * (0.55 + rim * 0.6) + spec * 2.5, (0.35 + rim * 0.5) * min(1.0, vL * 3.0)); }`,
  });
  SPLASH.pts = new THREE.Points(SPLASH.geo, m); SPLASH.pts.frustumCulled = false; SPLASH.pts.renderOrder = 6;
  setLayer(SPLASH.pts, LAYER.ABOVE); scene.add(SPLASH.pts);
}
