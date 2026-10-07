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
import { KOI } from "./koi";
import { TURTLE } from "./turtle";
import { CTRL } from "./controls";
import { FROG } from "./frog";
import { ground } from "./terrain";
import { cycleWeather } from "./weather";
import { DRAGON } from "./dragonflies";
import { wfWorld } from "./waterfallMesh";
import { onCameraMode, GUI_CTRL, updateFreeCamera } from "./controls";
import { FEED } from "./handMesh";
import { STROKE } from "./stroke";
const _up = new THREE.Vector3(0, 1, 0);

// Closed Catmull-Rom path: low over the near shore looking at the bridge, glide right, descend through the
// surface to fish-eye level, look up into Snell's window, rise back out and return.
export const PATH = {
  pos: new THREE.CatmullRomCurve3([
    [-0.6, 0.4, 5.3], [0.6, 0.42, 4.9], [1.7, 0.44, 3.9], [2.05, 0.36, 2.5], [1.75, 0.16, 1.5], [1.25, -0.2, 0.75],
    [0.55, -0.55, 0.05], [-0.25, -0.62, -0.75], [-0.75, -0.55, -1.7], [-0.7, -0.45, -2.35], [-0.35, -0.2, -1.7],
    [-0.1, 0.22, -0.75], [0.1, 0.62, 0.6], [-0.45, 0.62, 2.8], [-0.75, 0.3, 3.15], [-0.62, 0.15, 4.33],
  ].map((p) => new THREE.Vector3(...p)), true, 'centripetal'),
  look: new THREE.CatmullRomCurve3([
    [0.3, 0.9, -3.6], [0.6, 0.85, -3.5], [0.7, 0.6, -3.0], [0.4, 0.0, -1.0], [0.2, -0.45, -0.6], [-0.2, -0.65, -1.2],
    [-0.8, -0.62, -1.9], [-1.1, -0.55, -2.9], [-0.9, -0.2, -3.4], [-0.5, 1.2, -3.0], [0.0, 0.9, -2.8],
    [0.3, 0.8, -3.2], [0.3, 0.8, -3.6], [-0.4, 0.4, -1.0], [-1.0, 0.08, 3.8], [-1.05, 0.04, 3.86],
  ].map((p) => new THREE.Vector3(...p)), true, 'centripetal'),
  T: 88, t: 0, blend: 1,
};
// Above-water tour (default): past the bridge, down onto the koi, the waterfall, the lotus, and a close pass by the frog
PATH.above = {
  pos: new THREE.CatmullRomCurve3([[-0.6, 0.4, 5.3], [0.6, 0.45, 4.9], [1.05, 0.3, 2.85], [2.2, 0.85, 1.3], [1.2, 1.15, 0.1], [0.1, 0.95, -1.3],
    [-1.25, 0.6, -0.95], [-1.75, 0.48, 0.75], [-1.25, 0.36, 2.6], [-0.62, 0.16, 4.33]].map((p) => new THREE.Vector3(...p)), true, 'centripetal'),
  look: new THREE.CatmullRomCurve3([[0.3, 0.9, -3.6], [0.9, 0.5, -1.5], [1.45, 0.12, 1.75], [0.3, -0.25, 0.2], [0.0, -0.35, -0.9], [-1.4, 0.2, -2.0],
    [-3.0, 0.35, -1.95], [-2.8, 0.3, 0.0], [-1.05, 0.03, 3.85], [-1.05, 0.04, 3.86]].map((p) => new THREE.Vector3(...p)), true, 'centripetal'),
  T: 100,
};
const _pp = new THREE.Vector3(), _pl = new THREE.Vector3(), _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion();
// A directed tour, cut like a short film: an aerial establishing crane over the whole garden, down into the bamboo
// grove, along the fence, under the wisteria, past the weeping cherry to the waterfall, the lotus, low over the koi,
// the turtle's rock, the flower beds, the bonsai, up into the cherry blossom, a close look at the frog, an optional
// dive, and an aerial pull-back. Cuts dip through black; letterbox bars and a lower-third caption name each place.
export const MOVIE = { shots: [], i: 0, t: 0, fade: 0 };
export function buildMovie() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z), L = (a, b, u) => a.clone().lerp(b, u);
  const orbit = (c, r, h, a0, a1) => (u) => { const a = lerp(a0, a1, u); return V(c.x + Math.cos(a) * r, h, c.z + Math.sin(a) * r); };
  const B = () => WORLD.botany || {};
  const frogP = () => { const p = new THREE.Vector3(); if (FROG.root) FROG.root.getWorldPosition(p); return p; };
  MOVIE.shots = [
    // 1 — the garden from above
    { cap: 'The garden from above', T: 13, pos: (u) => V(Math.sin(lerp(-0.5, 0.35, u)) * 9, lerp(17, 12.5, u), Math.cos(lerp(-0.5, 0.35, u)) * 9 + 1), look: () => V(0, 0, -1.8) },
    // 2 — the pond and its water
    { cap: 'The koi pond', T: 11, pos: (u) => L(V(-0.35, 0.62, 5.4), V(0.15, 0.36, 3.3), u), look: (u) => L(V(0.2, 0.5, -3.6), V(0.0, 0.2, -3.2), u) },
    { cap: 'Koi', T: 11, start: () => { const fs = KOI.fish.slice(0, Math.min(P.fishCount, KOI.fish.length)); MOVIE.koi = fs.reduce((b, f) => (f.p.y > b.p.y && sdf(f.p.x, f.p.z) < -0.8 ? f : b), fs[0]); },
      pos: (u) => { const f = MOVIE.koi || KOI.fish[0], a = f.heading + 2.4 + u * 0.6; return V(f.p.x + Math.cos(a) * 0.8, WATER_Y + lerp(0.6, 0.38, u), f.p.z - Math.sin(a) * 0.8); }, look: () => (MOVIE.koi || KOI.fish[0]).p.clone() },
    { cap: 'Sacred lotus (hasu)', T: 10, pos: orbit(V(-2.62, 0, -0.15), 0.95, 0.62, 0.35, 1.3), look: () => V(-2.62, 0.5, -0.1) },
    // 3 — bamboo and sakura
    { cap: 'Bamboo grove — Phyllostachys', T: 12, pos: (u) => V(lerp(-5.9, -6.4, u), lerp(8.5, 1.5, Math.pow(u, 0.85)), lerp(-10.2, -11.4, u)), look: (u) => V(-9.4, lerp(7.0, 2.6, u), lerp(-10.8, -11.6, u)) },
    { cap: 'Weeping cherry (shidare-zakura)', T: 10, pos: (u) => L(V(-4.6, 1.15, -3.3), V(-5.3, 1.3, -2.5), u), look: (u) => L(V(-6.9, 2.3, -1.0), V(-6.9, 1.8, -1.0), u) },
    { cap: 'Cherry blossom', T: 11, pos: (u) => L(V(8.4, 0.9, 4.4), V(7.7, 1.15, 3.3), u), look: (u) => L(V(5.0, 1.9, 2.6), V(4.6, 1.6, 2.1), u) },
    // 4 — the pond's creatures, then below the surface
    { cap: 'Pond frog', T: 10, pos: (u) => { const p = frogP(), a = FROG.baseYaw + lerp(-0.4, 0.5, u); return V(p.x + Math.cos(a) * lerp(0.42, 0.24, u), p.y + lerp(0.14, 0.07, u), p.z - Math.sin(a) * lerp(0.42, 0.24, u)); }, look: () => frogP().add(V(0, 0.03, 0)), skip: () => !FROG.root || !WORLD.frogPad.mesh.visible },
    { cap: 'Yellow-bellied slider', T: 9, pos: (u) => { const T0 = TURTLE.pos, a = TURTLE.yaw + 1.9 + u * 0.4, r = lerp(0.8, 0.5, u); return V(T0.x + Math.cos(a) * r, Math.max(WATER_Y + 0.35, T0.y + lerp(0.4, 0.22, u)), T0.z - Math.sin(a) * r); }, look: () => V(TURTLE.pos.x, TURTLE.pos.y + 0.04, TURTLE.pos.z), skip: () => !TURTLE.root || TURTLE.off },
    { cap: 'Beneath the surface', T: 13, under: true, pos: (u) => L(V(0.6, 0.35, 2.0), V(0.2, -0.5, 0.7), smoothstep(0, 0.45, u)).add(V(-u * 0.6, 0, -u * 0.8 * smoothstep(0.45, 1, u))), look: (u) => L(V(0.0, -0.3, 0.6), V(-0.6, -0.55, -1.4), u), skip: () => SH.uIce.value > 0.5 },
    // 5 — and back to the pond
    { cap: '', T: 11, pos: (u) => L(V(0.1, 0.4, 3.6), V(-0.3, 0.6, 5.6), u), look: (u) => L(V(0.1, 0.25, -3.2), V(0.2, 0.5, -3.6), u) },
  ];
}
export function updateMovie(dt, t) {
  if (!MOVIE.shots.length) buildMovie();
  let sh = MOVIE.shots[MOVIE.i];
  let guard = 0;
  while (sh.skip && sh.skip() && guard++ < MOVIE.shots.length) { MOVIE.i = (MOVIE.i + 1) % MOVIE.shots.length; MOVIE.t = 0; sh = MOVIE.shots[MOVIE.i]; }
  if (MOVIE.started !== sh) { MOVIE.started = sh; if (sh.start) sh.start(); }
  MOVIE.t += dt * P.pathSpeed;
  const u = clamp(MOVIE.t / sh.T, 0, 1), e = lerp(u, u * u * (3 - 2 * u), 0.55);
  const p = sh.pos(e), l = sh.look(e);
  p.x += Math.sin(t * 0.37) * 0.01; p.y += Math.sin(t * 0.53) * 0.007;          // faint hand-held drift
  if (!sh.under) {                                                              // never inside the ground or the water
    const sd = sdf(p.x, p.z), floor = sd < 0 ? WATER_Y + 0.12 : ground(p.x, p.z) + 0.3;
    p.y = Math.max(p.y, floor);
  }
  camera.position.copy(p); camera.lookAt(l);
  const fin = 0.5, fout = 0.5;
  MOVIE.fade = clamp(Math.max(1 - MOVIE.t / fin, (MOVIE.t - (sh.T - fout)) / fout), 0, 1);
  const cap = document.getElementById('caption');
  if (cap) { if (cap.textContent !== sh.cap) cap.textContent = sh.cap; cap.style.opacity = sh.cap ? String(clamp(Math.min((MOVIE.t - 0.8) / 0.8, (sh.T - 1.2 - MOVIE.t) / 0.8), 0, 1) * 0.92) : '0'; }
  if (MOVIE.t >= sh.T) { MOVIE.i = (MOVIE.i + 1) % MOVIE.shots.length; MOVIE.t = 0; if (MOVIE.i === 0 && P.tourSeasons) cycleWeather(); }
}
export function updateCinematic(dt, t) {
  if (P.movie) { updateMovie(dt, t); return; }
  PATH.t += dt * P.pathSpeed;
  const route = P.stayAbove ? PATH.above : PATH;                      // the underwater dive is optional
  if (route === PATH.above && FROG.root && !FROG.jump) {               // the closing frog shot follows the frog to whichever pad it is on
    FROG.root.getWorldPosition(_pl);
    route.look.points[8].set(_pl.x, _pl.y + 0.03, _pl.z); route.look.points[9].set(_pl.x, _pl.y + 0.04, _pl.z + 0.01);
    route.pos.points[8].set(_pl.x - 0.2, 0.36, _pl.z - 1.25); route.pos.points[9].set(_pl.x + 0.43, 0.16, _pl.z + 0.48);
  }
  const u = ((PATH.t / route.T) % 1 + 1) % 1;
  route.pos.getPoint(u, _pp); route.look.getPoint(u, _pl);
  _pp.x += Math.sin(t * 0.37) * 0.012; _pp.y += Math.sin(t * 0.53) * 0.008;   // faint hand-held drift
  _pm.lookAt(_pp, _pl, _up); _pq.setFromRotationMatrix(_pm);
  if (PATH.blend < 1) {                                                        // ease in from the free camera
    PATH.blend = Math.min(1, PATH.blend + dt / 2.5);
    const k = 1 - Math.exp(-dt * 2.5 / Math.max(0.05, 1 - PATH.blend));
    camera.position.lerp(_pp, k); camera.quaternion.slerp(_pq, k);
  } else { camera.position.copy(_pp); camera.quaternion.copy(_pq); }
}
// Follow-koi camera: shadows one fish from above the water (the classic top-down koi view), easing smoothly
export const FOLLOW = { idx: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };
export function updateFollow(dt) {
  const f = KOI.fish[FOLLOW.idx % Math.max(1, Math.min(P.fishCount, KOI.fish.length))];
  if (!f) return;
  const fx = Math.cos(f.heading), fz = -Math.sin(f.heading), sz = f.size;
  const tp = _pp.set(f.p.x - fx * sz * 1.2 + fz * sz * 0.9, Math.max(WATER_Y + 0.28, f.p.y + sz * 1.9), f.p.z - fz * sz * 1.2 - fx * sz * 0.9);
  const tl = _pl.set(f.p.x + fx * sz * 0.2, f.p.y, f.p.z + fz * sz * 0.2);
  if (!FOLLOW.init) { FOLLOW.pos.copy(camera.position); FOLLOW.look.copy(tl); FOLLOW.init = true; }
  FOLLOW.pos.lerp(tp, 1 - Math.exp(-dt * 1.4)); FOLLOW.look.lerp(tl, 1 - Math.exp(-dt * 3));
  camera.position.copy(FOLLOW.pos); camera.lookAt(FOLLOW.look);
}
// Turtle camera: a three-quarter view from its side; stays above the water and looks down through it while it swims
export function updateFollowTurtle(dt) {
  const T = TURTLE; if (!T.root) return;
  const fx = Math.cos(T.yaw), fz = -Math.sin(T.yaw), under = T.pos.y < WATER_Y - 0.08;
  const d = under ? 0.5 : 0.36, side = 0.8;
  const tp = _pp.set(T.pos.x + fx * d * 0.55 + fz * d * side, under ? WATER_Y + 0.42 : T.pos.y + 0.16, T.pos.z + fz * d * 0.55 - fx * d * side);
  const tl = _pl.set(T.pos.x + fx * 0.05, T.pos.y + 0.035, T.pos.z + fz * 0.05);
  if (!FOLLOW.initT) { FOLLOW.tpos = camera.position.clone(); FOLLOW.tlook = tl.clone(); FOLLOW.initT = true; }
  FOLLOW.tpos.lerp(tp, 1 - Math.exp(-dt * 1.2)); FOLLOW.tlook.lerp(tl, 1 - Math.exp(-dt * 3));
  camera.position.copy(FOLLOW.tpos); camera.lookAt(FOLLOW.tlook);
}
// One-click close-up views (switch to free-fly and glide there)
export const VIEWS = {
  'Frog': () => { const p = new THREE.Vector3(); FROG.root.getWorldPosition(p); const y = FROG.baseYaw + 0.35; return [new THREE.Vector3(p.x + Math.cos(y) * 0.2, p.y + 0.07, p.z - Math.sin(y) * 0.2), new THREE.Vector3(p.x, p.y + 0.035, p.z)]; },
  'Dragonfly': () => { const D = DRAGON.list.find((d) => d.state === 'perch') || DRAGON.list[0], p = D.p, y = D.yaw + 2.2;
    return [new THREE.Vector3(p.x + Math.cos(y) * 0.13, p.y + 0.06, p.z - Math.sin(y) * 0.13), p.clone()]; },
  'Bamboo grove': () => [new THREE.Vector3(-5.6, 1.5, -11.2), new THREE.Vector3(-9.2, 2.8, -10.6)],
  'Wisteria arbor': () => { const [x, z] = WORLD.botany.arbor || [7.2, 0.6], g = ground(x, z); return [new THREE.Vector3(x - 2.2, g + 1.35, z + 1.6), new THREE.Vector3(x, g + 1.9, z)]; },
  'Hydrangeas': () => { const [x, z] = WORLD.botany.hyd[0] || [4, 4], g = ground(x, z); return [new THREE.Vector3(x + 1.1, g + 1.0, z + 1.1), new THREE.Vector3(x, g + 0.55, z)]; },
  'Spider lilies': () => { const [x, z] = WORLD.botany.lily[0] || [0, 6], g = ground(x, z); return [new THREE.Vector3(x + 0.6, g + 0.55, z + 0.6), new THREE.Vector3(x, g + 0.4, z)]; },
  'Peonies': () => { const [x, z] = WORLD.botany.peony[0] || [3, 5], g = ground(x, z); return [new THREE.Vector3(x + 0.9, g + 0.8, z + 0.9), new THREE.Vector3(x, g + 0.45, z)]; },
  'Camellia': () => { const [x, z] = WORLD.botany.cam[0] || [5, 5], g = ground(x, z); return [new THREE.Vector3(x + 1.6, g + 1.2, z + 1.6), new THREE.Vector3(x, g + 0.7, z)]; },
  'Water lilies': () => [new THREE.Vector3(-1.45, 0.3, 2.25), new THREE.Vector3(-1.85, 0.0, 1.5)],
  'Bridge timber': () => [new THREE.Vector3(0.9, 1.05, -2.85), new THREE.Vector3(0.3, 0.7, -3.55)],
  'Stone & moss': () => [new THREE.Vector3(-3.0, 0.55, 2.7), new THREE.Vector3(-3.5, 0.05, 2.0)],
  'Lotus': () => [new THREE.Vector3(-2.0, 0.55, 0.5), new THREE.Vector3(-2.65, 0.4, -0.1)],
  'Underwater': () => [new THREE.Vector3(0.4, -0.55, 1.2), new THREE.Vector3(-0.3, -0.6, -0.5)],
  'Lily roots (underwater)': () => [new THREE.Vector3(-0.3, -0.42, 3.05), new THREE.Vector3(-1.05, -0.78, 3.95)],
  'Waterfall': () => [wfWorld(1.45, 0.55, 0.62), wfWorld(-0.45, 0, 0.35)],
};
export const TWEEN = { t: 1, from: new THREE.Vector3(), to: new THREE.Vector3(), q0: new THREE.Quaternion(), q1: new THREE.Quaternion() };
export function goToView(name) {
  if (name === 'Turtle') { P.cameraMode = 'Follow turtle'; FOLLOW.initT = false; onCameraMode(); return; }
  const v = VIEWS[name]; if (!v) return;
  const [pos, look] = v();
  P.cameraMode = 'Manual'; if (GUI_CTRL.cam) GUI_CTRL.cam.updateDisplay();
  TWEEN.from.copy(camera.position); TWEEN.q0.copy(camera.quaternion); TWEEN.to.copy(pos);
  _pm.lookAt(pos, look, _up); TWEEN.q1.setFromRotationMatrix(_pm); TWEEN.t = 0;
  toast(name);
}
export function updateCamera(dt, t) {
  if (P.holdCamera || (P.cleanView && P.cameraMode !== 'Manual')) return;   // hold the shot: nothing moves the camera
  if (TWEEN.t < 1) {
    TWEEN.t = Math.min(1, TWEEN.t + dt / 1.8); const k = TWEEN.t * TWEEN.t * (3 - 2 * TWEEN.t);
    camera.position.lerpVectors(TWEEN.from, TWEEN.to, k); camera.quaternion.slerpQuaternions(TWEEN.q0, TWEEN.q1, k);
    if (TWEEN.t >= 1) { const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); CTRL.yaw = e.y; CTRL.pitch = e.x; }
    return;
  }
  const crouch = FEED.shot && FEED.active ? FEED.shot : STROKE.active && STROKE.shot ? STROKE.shot : null;
  if (crouch) {                                          // feeding / stroking: ease to the crouched shore view in any mode
    _pm.lookAt(crouch.pos, crouch.look, _up); _pq.setFromRotationMatrix(_pm);
    const k = 1 - Math.exp(-dt * 2.2);
    camera.position.lerp(crouch.pos, k); camera.quaternion.slerp(_pq, k);
    return;
  }
  if (P.cameraMode === 'Follow koi') { updateFollow(dt); return; }
  if (P.cameraMode === 'Follow turtle') { updateFollowTurtle(dt); return; }
  FOLLOW.init = false; FOLLOW.initT = false;
  if (P.cameraMode === 'Manual') updateFreeCamera(dt);
  else if (FEED.shot) {                                   // feeding shot: ease over to a framed view of the spot
    _pm.lookAt(FEED.shot.pos, FEED.shot.look, _up); _pq.setFromRotationMatrix(_pm);
    const k = 1 - Math.exp(-dt * 1.6);
    camera.position.lerp(FEED.shot.pos, k); camera.quaternion.slerp(_pq, k);
  } else updateCinematic(dt, t);
}

/* --- Suspended particles (only while submerged): points wrapped in a box that follows the camera */
