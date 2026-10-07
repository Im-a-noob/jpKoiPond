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
import { padSurfaceY } from "./pondFlora";
import { waterHeightAt, addDrop } from "./water";
import { audioEvent } from "./audio";
import { splashAt, bubbleBurst } from "./bubbles";
import { KOI_BODY_POST } from "./koiShaders";
import { spawnSplash } from "./bubbles";

/* --- The frog: a Japanese pond frog (Pelophylax nigromaculatus, "tonosama-gaeru") sitting on a pad. SDF-modelled
       anatomy, procedural skin (green-to-olive with black blotches, pale vertebral stripe, cream dorsolateral folds and
       lip line, barred limbs, cream belly), gold eyes with horizontal pupils, blinking lids, breathing throat, idle life. */
export const FROG_PIVOT = [0.012, 0.031, 0];      // neck pivot for head turns
export const FROG_VS = /* glsl */`
varying vec3 vLoc;
varying vec3 vLocN;
uniform float uBreath;
uniform float uCroak;
uniform vec2 uHead;
vec3 fRotY(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
vec3 fRotZ(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }
float frogHeadW(vec3 p){ return smoothstep(0.004, 0.024, p.x) * smoothstep(0.014, 0.03, p.y); }
`;
export const FROG_VS_NORMAL = /* glsl */`
vLocN = objectNormal;
{ float hw = frogHeadW(position); objectNormal = fRotZ(fRotY(objectNormal, uHead.x * hw), uHead.y * hw); }
`;
export const FROG_VS_BEGIN = /* glsl */`
vLoc = position;
{
  // throat pumps with each breath and balloons into paired vocal sacs when croaking; flanks breathe slowly
  float thr = smoothstep(0.018, 0.0, length((position - vec3(0.03, 0.021, 0.0)) * vec3(1.0, 1.5, 0.9)));
  float sacs = smoothstep(0.012, 0.0, length((vec3(position.x, position.y, abs(position.z)) - vec3(0.016, 0.028, 0.019))));
  transformed += vLocN * (thr * (0.0008 * (0.5 + 0.5 * sin(uBreath)) + 0.004 * uCroak) + sacs * 0.006 * uCroak);
  float fl = smoothstep(0.024, 0.0, length((position - vec3(-0.012, 0.024, 0.0)) * vec3(1.0, 1.0, 0.75)));
  transformed += vLocN * fl * 0.0006 * sin(uBreath * 0.23);
  float hw = frogHeadW(position);
  vec3 q = transformed - vec3(${FROG_PIVOT.join(', ')});
  q = fRotZ(fRotY(q, uHead.x * hw), uHead.y * hw);
  transformed = vec3(${FROG_PIVOT.join(', ')}) + q;
}
`;
export const FROG_FS_PARS = /* glsl */`
varying vec3 vLoc;
varying vec3 vLocN;
float fh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fh(i), fh(i + vec3(1,0,0)), f.x), mix(fh(i + vec3(0,1,0)), fh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fh(i + vec3(0,0,1)), fh(i + vec3(1,0,1)), f.x), mix(fh(i + vec3(0,1,1)), fh(i + vec3(1,1,1)), f.x), f.y), f.z); }
float segDist(vec3 p, vec3 a, vec3 b){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
`;
export const FROG_MAP = /* glsl */`
vec3 lp = vLoc, ap = vec3(lp.x, lp.y, abs(lp.z));
vec3 ln = normalize(vLocN);
float mott = fnoise(lp * 300.0) * 0.6 + fnoise(lp * 800.0) * 0.4;
// black blotches (irregular, larger on the back, bars on the limbs)
float bl = fnoise(lp * 165.0 + 3.1) * 0.65 + fnoise(lp * 340.0 + 7.0) * 0.35;
float limbs = smoothstep(0.016, 0.024, ap.z) * (1.0 - smoothstep(0.024, 0.03, lp.y));
float bars = smoothstep(0.55, 0.8, sin(dot(ap.xz, vec2(620.0, 260.0)) + bl * 3.0) * 0.5 + 0.5) * limbs;
float blot = max(smoothstep(0.66, 0.7, bl + mott * 0.05) * (1.0 - limbs), bars * 0.85);
float dorsal = smoothstep(-0.5, 0.2, ln.y) * smoothstep(0.004, 0.016, lp.y);
// green on the head and shoulders grading to olive-bronze toward the rump
vec3 green = mix(vec3(0.30, 0.46, 0.12), vec3(0.48, 0.6, 0.2), mott);
vec3 olive = mix(vec3(0.36, 0.34, 0.14), vec3(0.48, 0.44, 0.2), mott);
vec3 back = mix(olive, green, smoothstep(-0.02, 0.025, lp.x));
vec3 cream = mix(vec3(0.88, 0.85, 0.7), vec3(0.95, 0.93, 0.82), mott);
vec3 col = mix(cream, back, dorsal);
col = mix(col, vec3(0.07, 0.06, 0.035), blot * dorsal * 0.85);
// pale vertebral stripe, cream-bronze dorsolateral folds
float vert = (1.0 - smoothstep(0.0012, 0.0024, ap.z)) * smoothstep(0.03, 0.036, lp.y) * smoothstep(0.05, 0.035, lp.x);
col = mix(col, vec3(0.62, 0.72, 0.36), vert * 0.85);
float fold = 1.0 - smoothstep(0.0012, 0.0026, min(segDist(ap, vec3(0.02, 0.0375, 0.0118), vec3(-0.004, 0.0335, 0.0138)), segDist(ap, vec3(-0.004, 0.0335, 0.0138), vec3(-0.026, 0.0275, 0.0152))));
col = mix(col, vec3(0.78, 0.7, 0.42), fold * 0.8);
// cream upper-lip line along the jaw, brown tympanum disc behind the eye
float lip = 1.0 - smoothstep(0.0008, 0.0022, segDist(ap, vec3(0.058, 0.0276, 0.0), vec3(0.012, 0.0302, 0.0205)) - 0.0012);
col = mix(col, cream * vec3(1.0, 0.97, 0.85), lip * step(0.0282, lp.y) * 0.8);
float tymp = 1.0 - smoothstep(0.0036, 0.0046, length(ap - vec3(0.0165, 0.0365, 0.0205)));
col = mix(col, vec3(0.32, 0.24, 0.12), tymp * 0.85);
// cream belly and throat, flesh-toned toe tips
float belly = smoothstep(0.1, -0.5, ln.y) + smoothstep(0.018, 0.0, length((lp - vec3(0.03, 0.02, 0.0)) * vec3(1.0, 1.4, 0.8)));
col = mix(col, cream, clamp(belly, 0.0, 1.0) * 0.95);
float toe = smoothstep(0.004, 0.0022, lp.y) * smoothstep(0.03, 0.045, length(lp.xz));
col = mix(col, vec3(0.72, 0.6, 0.4), toe * 0.6);
diffuseColor.rgb = pow(clamp(col, 0.0, 1.0), vec3(2.2));
`;
// Fine granular skin (smooth on the back, grainier on the flanks) as a derivative bump
export const FROG_NORMAL = /* glsl */`
{
  float flank = smoothstep(0.1, 0.7, abs(normalize(vLocN).z));
  float hgt = (fnoise(vLoc * 900.0) * (0.35 + 0.65 * flank) + fnoise(vLoc * 2200.0) * 0.25 + smoothstep(0.6, 0.85, fnoise(vLoc * 330.0)) * 0.5 * flank) * 0.00022;
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  float dhx = dFdx(hgt), dhy = dFdy(hgt);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad);
}
`;
export const FROG = { root: null };
export function frogEyeTexture() {
  // polar texture: rows = angle from the gaze axis, columns = azimuth; horizontal oval pupil in a gold iris
  const W = 256, H = 128, cv = makeCanvas(W, H), g = cv.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const th = y / H, ph = (x / W) * Math.PI * 2;
    const pupilR = 0.13 * (1 + 0.55 * Math.cos(2 * ph)), iris = 0.42;
    let c;
    if (th < pupilR) c = [6, 6, 6];
    else if (th < iris) {
      const t = (th - pupilR) / (iris - pupilR), vein = hash3i(x >> 1, y >> 1, 3, 1);
      c = mix3(mix3([205, 150, 40], [238, 196, 92], Math.sin(t * Math.PI)), [70, 40, 12], (vein > 0.8 ? 0.6 : 0) + smoothstep(0.75, 1, t) * 0.7);
      if (th < pupilR + 0.015) c = mix3(c, [250, 215, 120], 0.6);          // bright rim around the pupil
    } else c = mix3([40, 36, 18], [70, 88, 36], smoothstep(0.42, 0.6, th));
    const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTex(cv, true);
}
export function buildFrog() {
  const S = SDFK, P3 = [0, 0, 0];
  const mkFrog = (leap) => (p) => {
    const x = p[0], y = p[1], z = Math.abs(p[2]); P3[0] = x; P3[1] = y; P3[2] = z;
    const c = Math.cos(-0.3), s = Math.sin(-0.3), tx = x + 0.006, ty = y - 0.022;
    let d = S.ellipsoid([tx * c - ty * s, tx * s + ty * c, z], [0, 0, 0], [0.034, 0.0165, 0.021]);          // torso, raised at the front
    d = S.smin(d, S.ellipsoid(P3, [-0.025, 0.016, 0], [0.022, 0.015, 0.022]), 0.01);                       // rump on the haunches
    d = S.smin(d, S.ellipsoid(P3, [0.027, 0.033, 0], [0.023, 0.0115, 0.0205]), 0.01);                     // flat head
    d = S.smin(d, S.ellipsoid(P3, [0.047, 0.03, 0], [0.013, 0.0082, 0.0125]), 0.007);                     // rounded, pointed snout
    d = S.smin(d, S.ellipsoid(P3, [0.029, 0.024, 0], [0.02, 0.0085, 0.018]), 0.008);                      // lower jaw & throat
    d = S.smin(d, S.sphere(P3, [0.029, 0.0365, 0.0098], 0.0058), 0.005);                                   // eye mounds (the eyeballs bulge above them)
    d = S.smin(d, S.cone(P3, [0.02, 0.0375, 0.0118], [-0.004, 0.0335, 0.0138], 0.0015, 0.0013), 0.002);    // dorsolateral folds, following the back
    d = S.smin(d, S.cone(P3, [-0.004, 0.0335, 0.0138], [-0.026, 0.0275, 0.0152], 0.0013, 0.001), 0.002);
    // front legs: upper arm, forearm, four slender fingers with slightly swollen tips
    d = S.smin(d, S.cone(P3, [0.018, 0.022, 0.016], [0.024, 0.01, 0.022], 0.0046, 0.0036), 0.005);
    d = S.smin(d, S.cone(P3, [0.024, 0.01, 0.022], [0.033, 0.0022, 0.02], 0.0036, 0.003), 0.002);
    for (const [a, L] of [[-0.55, 0.008], [-0.15, 0.011], [0.25, 0.01], [0.65, 0.0075]]) {
      const ex = 0.033 + Math.cos(a) * L, ez = 0.02 + Math.sin(a) * L;
      d = S.smin(d, S.cone(P3, [0.033, 0.0022, 0.02], [ex, 0.0015, ez], 0.0013, 0.0011), 0.0012);
      d = S.smin(d, S.sphere(P3, [ex, 0.0016, ez], 0.0015), 0.0006);
    }
    if (leap) {
      // mid-leap: hind legs kicked straight back, toes fanned and webbing spread
      d = S.smin(d, S.cone(P3, [-0.026, 0.016, 0.017], [-0.056, 0.011, 0.029], 0.0085, 0.0062), 0.006);
      d = S.smin(d, S.cone(P3, [-0.056, 0.011, 0.029], [-0.089, 0.006, 0.034], 0.0062, 0.0038), 0.003);
      d = S.smin(d, S.cone(P3, [-0.089, 0.006, 0.034], [-0.108, 0.0035, 0.036], 0.0038, 0.0028), 0.002);
      for (const [a, L] of [[-0.62, 0.01], [-0.3, 0.015], [0.02, 0.021], [0.33, 0.026], [0.62, 0.017]]) {
        const ex = -0.108 - Math.cos(a * 0.8) * L, ez = 0.036 + Math.sin(a * 0.8) * L;
        d = S.smin(d, S.cone(P3, [-0.108, 0.0035, 0.036], [ex, 0.003, ez], 0.0012, 0.001), 0.0012);
        d = S.smin(d, S.sphere(P3, [ex, 0.003, ez], 0.0014), 0.0006);
      }
      d = S.smin(d, S.ellipsoid(P3, [-0.122, 0.0032, 0.037], [0.011, 0.0006, 0.009]), 0.0015);
    } else {
    // hind legs folded along the body: thigh, shank, long foot, five webbed toes
    d = S.smin(d, S.cone(P3, [-0.028, 0.016, 0.017], [0.004, 0.017, 0.032], 0.0085, 0.0062), 0.006);
    d = S.smin(d, S.cone(P3, [0.004, 0.017, 0.032], [-0.034, 0.0085, 0.031], 0.006, 0.0038), 0.003);
    d = S.smin(d, S.cone(P3, [-0.034, 0.0085, 0.031], [-0.012, 0.0026, 0.043], 0.0038, 0.0028), 0.002);
    for (const [a, L] of [[-0.62, 0.01], [-0.3, 0.015], [0.02, 0.021], [0.33, 0.026], [0.62, 0.017]]) {
      const ex = -0.012 + Math.cos(a) * L, ez = 0.043 + Math.sin(a) * L;
      d = S.smin(d, S.cone(P3, [-0.012, 0.0026, 0.043], [ex, 0.0015, ez], 0.0012, 0.001), 0.0012);
      d = S.smin(d, S.sphere(P3, [ex, 0.0015, ez], 0.0014), 0.0006);
    }
    d = S.smin(d, S.ellipsoid(P3, [0.0, 0.0017, 0.052], [0.011, 0.0006, 0.009]), 0.0015);                 // toe webbing
    }
    // mouth line, nostrils and a slightly recessed tympanum
    d = S.smax(d, -S.cone(P3, [0.0585, 0.0276, 0.0], [0.012, 0.0302, 0.0205], 0.0006, 0.0008), 0.0007);
    d = S.smax(d, -S.sphere(P3, [0.0535, 0.0352, 0.0042], 0.0011), 0.0006);
    d = S.smax(d, -S.sphere([x, y, z], [0.0165, 0.0365, 0.0236], 0.0042), 0.0012);
    return d;
  };
  const geo = surfaceNets(mkFrog(false), [-0.06, -0.002, -0.075], [0.07, 0.056, 0.075], 0.0007);
  const geoLeap = surfaceNets(mkFrog(true), [-0.14, -0.002, -0.056], [0.07, 0.056, 0.056], 0.0008);
  const mat = physical({ roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.14, sheen: 0.2, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xe8f0c0), envMapIntensity: 1.0 }, {
    key: 'frog2', uniforms: { uBreath: { value: 0 }, uCroak: { value: 0 }, uHead: { value: new THREE.Vector2() } },
    vsPars: FROG_VS, vsNormal: FROG_VS_NORMAL, vsBegin: FROG_VS_BEGIN, fsPars: FROG_FS_PARS, fsMap: FROG_MAP, fsNormal: FROG_NORMAL,
    fsRough: 'roughnessFactor = mix(0.26, 0.42, blot * 0.5 + belly * 0.3);', fsPostLights: KOI_BODY_POST,
  });
  const body = new THREE.Mesh(geo, mat); body.castShadow = true; body.receiveShadow = true;
  const root = new THREE.Group(), head = new THREE.Group();
  const bodyLeap = new THREE.Mesh(geoLeap, mat); bodyLeap.castShadow = true; bodyLeap.visible = false;
  root.add(body, bodyLeap); head.position.set(...FROG_PIVOT); root.add(head);
  const eyeMat = physical({ map: frogEyeTexture(), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 }, { key: 'frogeye2' });
  const lidMat = physical({ color: 0x6f8a36, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2 }, { key: 'froglid2' });
  const eyes = [];
  for (const side of [1, -1]) {
    const socket = new THREE.Group();
    socket.position.set(0.031 - FROG_PIVOT[0], 0.0402 - FROG_PIVOT[1], side * 0.0136);
    const gz = new THREE.Vector3(0.42, 0.55, side * 0.72).normalize(), ax = new THREE.Vector3(-gz.z, 0, gz.x).normalize(), up = new THREE.Vector3().crossVectors(ax, gz);
    socket.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, gz, up));   // y = gaze, z = up across the eye
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0066, 32, 20), eyeMat); eye.castShadow = true;
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), lidMat); lid.castShadow = true;
    socket.add(eye, lid); head.add(socket);
    eyes.push({ socket, eye, lid, side, rest: socket.position.clone() });
  }
  root.traverse((o) => o.layers.set(LAYER.ABOVE));
  const pad = WORLD.frogPad;
  root.position.set(0.02, padSurfaceY(pad.r, 0, 0) - 0.0003, 0.0);
  root.scale.setScalar(1.15);
  pad.mesh.add(root);
  Object.assign(FROG, { root, body, bodyLeap, mat, head, eyes, yaw: 0, yawT: 0, breath: 0, croak: 0, croakT: rr(8, 16), croakN: 0, blinkT: rr(2, 5), blink: 0,
    look: new THREE.Vector2(), lookT: new THREE.Vector2(), sacT: 1, headT: new THREE.Vector2(), headV: new THREE.Vector2(), shuffleT: rr(10, 20) });
  FROG.baseYaw = 0;
}
const _fv = new THREE.Vector3(), _fq = new THREE.Quaternion(), _fe = new THREE.Euler();
export function updateFrog(t, dt) {
  if (!FROG.root) return;
  const F = FROG, u = F.mat.userData.uniforms;
  if (F.jump) { updateFrogJump(t, dt); if (F.jump) return; }
  // face roughly toward the start camera; occasional small shuffles on the pad
  if (F.baseYaw === 0) F.baseYaw = Math.atan2(-(5.3 - WORLD.frogPad.z), (-0.6 - WORLD.frogPad.x)) + 1e-6;   // world yaw toward the opening view
  F.shuffleT -= dt;
  if (F.shuffleT < 0) { F.shuffleT = rr(9, 22); F.yawT = rr(-0.45, 0.45); }
  F.yaw = lerp(F.yaw, F.yawT, 1 - Math.exp(-dt * 2.2));
  F.root.rotation.set(0, F.baseYaw + F.yaw - WORLD.frogPad.mesh.rotation.y, 0);
  F.root.position.y = padSurfaceY(WORLD.frogPad.r, 0, 0) - 0.0005 - 0.0006 * Math.abs(F.yawT - F.yaw);
  // breathing and croaks (two or three throat pulses)
  F.breath += dt * (5.5 + F.croak * 4);
  F.croakT -= dt;
  if (F.croakT < 0) { F.croakN = 2 + (rand() * 2 | 0); F.croakT = rr(14, 32); F.croakPulse = 0; if (typeof audioEvent === 'function') audioEvent('croak', F.croakN); }
  if (F.croakN > 0) { F.croakPulse += dt; const ph = F.croakPulse % 0.62; F.croak = Math.sin(clamp(ph / 0.45, 0, 1) * Math.PI); if (F.croakPulse > 0.62 * F.croakN) { F.croakN = 0; F.croak = 0; } }
  u.uBreath.value = F.breath; u.uCroak.value = F.croak;
  // eyes: track the camera when it is near, otherwise small saccades; blink every few seconds
  F.root.getWorldPosition(_fv);
  const near = camera.position.distanceTo(_fv) < 2.5;
  F.sacT -= dt;
  if (F.sacT < 0) { F.sacT = rr(0.8, 3); F.lookT.set(rr(-0.3, 0.3), rr(-0.15, 0.2)); F.headT.set(rr(-0.18, 0.18), rr(-0.08, 0.1)); }
  if (near) {
    F.root.worldToLocal(_fv.copy(camera.position));
    const yawTo = Math.atan2(-_fv.z, _fv.x), pitchTo = Math.atan2(_fv.y - 0.05, Math.hypot(_fv.x, _fv.z));
    F.headT.set(clamp(yawTo * 0.35, -0.3, 0.3), clamp(pitchTo * 0.3, -0.1, 0.18));
    F.lookT.set(clamp(yawTo * 0.5, -0.4, 0.4), clamp(pitchTo * 0.4, -0.2, 0.25));
  }
  F.headV.lerp(F.headT, 1 - Math.exp(-dt * 2.5));
  u.uHead.value.copy(F.headV);
  F.head.rotation.set(0, F.headV.x, F.headV.y, 'ZYX');
  F.look.lerp(F.lookT, 1 - Math.exp(-dt * 10));
  F.blinkT -= dt;
  if (F.blinkT < 0) { F.blinkT = rr(2.5, 7); F.blink = 1e-3; }
  if (F.blink > 0) { F.blink += dt / 0.28; if (F.blink >= 1) F.blink = 0; }
  const lidClose = F.blink > 0 ? Math.sin(F.blink * Math.PI) : 0;
  for (const E of F.eyes) {
    E.eye.rotation.set(F.look.y, 0, -F.look.x * E.side);
    E.lid.rotation.set(-(1 - lidClose) * 1.6, 0, 0); E.lid.visible = lidClose > 0.02;                      // lower lid sweeps up over the eye
    E.socket.position.copy(E.rest).y -= 0.0014 * lidClose;                  // frogs retract their eyes when blinking
  }
}


const sdfGx = (x, z) => (sdf(x + 0.03, z) - sdf(x - 0.03, z)) / 0.06, sdfGz = (x, z) => (sdf(x, z + 0.03) - sdf(x, z - 0.03)) / 0.06;

// Touch the frog and it leaps to another pad: a short crouch, a ballistic arc with the hind legs kicked straight
// back (a second, leaping body mesh), a landing squash that dips the new pad, then it settles and faces where it went.
const _fj = new THREE.Vector3(), _fj2 = new THREE.Vector3();
export function frogHit(ray) {
  if (!FROG.root || FROG.jump || !WORLD.frogPad.mesh.visible) return false;
  FROG.root.getWorldPosition(_fj); _fj.y += 0.025;
  return ray.distanceSqToPoint(_fj) < 0.06 * 0.06 && ray.origin.distanceTo(_fj) < 10;
}
export function frogJump() {
  const F = FROG, cur = WORLD.frogPad;
  if (!F.root || F.jump) return;
  const cand = WORLD.lilies.filter((L) => L !== cur && L.r >= 0.13 && Math.hypot(L.mesh.position.x - cur.mesh.position.x, L.mesh.position.z - cur.mesh.position.z) < 1.25);
  if (!cand.length) return;
  // prefer a pad the viewer can see
  camera.getWorldDirection(_fj2);
  cand.sort((a, b) => (rand() - 0.5) * 0.6 - (_fj2.dot(_fj.subVectors(b.mesh.position, camera.position).normalize()) - _fj2.dot(_fj.subVectors(a.mesh.position, camera.position).normalize())));
  const to = cand[0], hasFlower = to.kind === 'flower' || to.kind === 'bud';
  F.root.getWorldPosition(_fj);
  F.jump = { t: 0, to, from: _fj.clone(), lx: hasFlower ? -to.r * 0.3 : rr(-0.03, 0.03), lz: hasFlower ? to.r * 0.2 : rr(-0.03, 0.03), crouch: 0.14 };
  const d = Math.hypot(to.mesh.position.x - _fj.x, to.mesh.position.z - _fj.z);
  F.jump.dur = 0.34 + d * 0.28; F.jump.h = 0.06 + d * 0.22;
  scene.attach(F.root); F.root.rotation.order = 'YZX';
  F.jump.yaw0 = F.root.rotation.y; F.jump.yaw1 = Math.atan2(-(to.mesh.position.z - _fj.z), to.mesh.position.x - _fj.x);
  { const fp = F.root.getWorldPosition(new THREE.Vector3()); splashAt(fp.x, WATER_Y, fp.z, 0.16); }
}
export function updateFrogJump(t, dt) {
  const F = FROG, J = F.jump, u = F.mat.userData.uniforms, L = J.to;
  J.t += dt;
  // landing target moves with its pad
  _fj2.set(J.lx, padSurfaceY(L.r, J.lx, J.lz) - 0.0005, J.lz); L.mesh.localToWorld(_fj2);
  let dy = J.yaw1 - J.yaw0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  if (J.t < J.crouch) {                                // crouch and turn toward the target
    const k = J.t / J.crouch;
    F.root.rotation.set(0, J.yaw0 + dy * smoothstep(0, 1, k), -0.12 * k);
    F.root.scale.set(1.15, 1.15 * (1 - 0.12 * Math.sin(k * Math.PI * 0.5)), 1.15);
    return;
  }
  const k = clamp((J.t - J.crouch) / J.dur, 0, 1);
  F.root.position.lerpVectors(J.from, _fj2, k); F.root.position.y += J.h * 4 * k * (1 - k);
  F.root.rotation.set(0, J.yaw1, lerp(0.55, -0.45, k));
  const stretch = 0.92 * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * (1 - smoothstep(0.75, 1, k));
  const air = k > 0.02 && k < 0.9;                    // legs kicked straight back while airborne
  F.body.visible = !air; F.bodyLeap.visible = air;
  F.root.scale.set(1.15 * (1 + 0.1 * stretch), 1.15 * (1 - 0.06 * stretch), 1.15);
  if (k === 0 || J.t - J.crouch < dt) { const fp = J.from; addDrop(fp.x, fp.z, 0.08, -0.004); cur_pad_kick(); }
  if (k >= 1) {
    // land: squash, dip the new pad, ripples, a soft slap
    L.mesh.attach(F.root); F.root.rotation.order = 'XYZ';
    F.body.visible = true; F.bodyLeap.visible = false;
    F.root.scale.setScalar(1.15);
    WORLD.frogPad = L; L.dipT = 0;
    F.baseYaw = J.yaw1; F.yaw = 0; F.yawT = 0; F.shuffleT = rr(6, 12);
    addDrop(_fj2.x, _fj2.z, 0.2, -0.006);
    if (typeof spawnSplash === 'function') spawnSplash(_fj2.x, _fj2.z, 0.25, WATER_Y, true);
    if (typeof audioEvent === 'function') audioEvent('frogLand');
    splashAt(_fj2.x, WATER_Y, _fj2.z, 0.3);
    bubbleBurst(_fj2.x + rr(-0.1, 0.1), WATER_Y - 0.01, _fj2.z + rr(-0.1, 0.1), 8, 0.05, 0.0004, 0.0016, 0.1);
    F.jump = null;
  }
  function cur_pad_kick() { const P0 = WORLD.frogPad; if (P0) P0.dipT = 0; }
}

