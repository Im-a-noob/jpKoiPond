// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG, mulberry32, fbm2P, mix3, srgbHex, hash3i } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets, SDFK, instanced } from "../geometry";
import { $, progress, toast } from "../state";
import { canvasTex, dataTex, heightToNormal, makeCanvas, TEX } from "./textures";
import { physical, seasonal } from "./materials";
import { scene, camera, renderer, SH, KOI_MAX } from "./lighting";
import { WORLD, sdf, groundHeight } from "./terrain";
export * from "./koiGeometry";
export * from "./koiRoster";
export * from "./koiShaders";

import { KOI_N, KOI_STYLES, KOI_ROSTER_DEF, KOI_ROSTER, KOI_SIZE_RANGE } from "./koiRoster";
import { koiBodyGeo, koiFinGeo, koiEyeGeo } from "./koiGeometry";
import { koiPatternAtlas, koiScaleTexture, koiFinTexture, koiEyeTexture, KOI_VS_PARS, KOI_VS_NORMAL, KOI_VS_BEGIN, KOI_FS_PARS, KOI_BODY_MAP, KOI_BODY_NORMAL, KOI_GIN_POST, KOI_BODY_POST, KOI_FIN_MAP } from "./koiShaders";
import { waterHeightAt, addDrop } from "./water";
import { FEED, STROKE, HANDCOL, koiBackPoint, koiLift } from "./interactions";
import { splashAt, bubbleBurst } from "./bubbles";
import { patchedDepth } from "./materials";
import { pondDepth, BRIDGE } from "./terrain";
import { STATE } from "../state";
import { nearestFood } from "./feeding";
import { TURTLE } from "./turtle";
import { spawnSplash } from "./bubbles";

export const KOI = { fish: [], body: null, fins: null, eyes: null };
export function buildKoi() {
  const tPattern = koiPatternAtlas(), tScale = koiScaleTexture(), tFin = koiFinTexture(), tEye = koiEyeTexture();
  const bodyGeo = koiBodyGeo(), finGeo = koiFinGeo(), eyeGeo = koiEyeGeo();
  const a1 = new THREE.InstancedBufferAttribute(new Float32Array(KOI_N * 4), 4), a2 = new THREE.InstancedBufferAttribute(new Float32Array(KOI_N * 4), 4), a3 = new THREE.InstancedBufferAttribute(new Float32Array(KOI_N * 4), 4);
  for (const a of [a1, a2, a3]) a.setUsage(THREE.DynamicDrawUsage);
  for (const g of [bodyGeo, finGeo, eyeGeo]) { g.setAttribute('aSwim', a1); g.setAttribute('aSwim2', a2); g.setAttribute('aSwim3', a3); }
  tScale.repeat.set(4.5, 3);
  // per-fish palettes with individual variation (warmer/cooler red, creamier white, depth of black)
  const palData = new Float32Array(8 * KOI_N * 4);
  const put = (f, k, x, y, z, w) => palData.set([x, y, z, w], (f * 8 + k) * 4);
  const jit = (hex, f, a) => { const c = new THREE.Color(hex), h = {}; c.getHSL(h); c.setHSL(h.h + (hash3i(f, 1, 0, 3) - 0.5) * 0.03 * a, clamp(h.s * (0.9 + 0.2 * hash3i(f, 2, 0, 3)), 0, 1), clamp(h.l * (0.95 + 0.1 * hash3i(f, 3, 0, 3)), 0, 1)); return c; };
  const finLong = new Array(KOI_N).fill(0);
  KOI_ROSTER_DEF.forEach(([name, , opt = {}], f) => {
    const st = KOI_STYLES[name];
    [jit(st.base, f, 0.5), jit(st.hi, f, 1), new THREE.Color(st.sumi), jit(st.belly, f, 0.3), jit(st.fin, f, 0.3), jit(st.finBase, f, 1)].forEach((c, k) => put(f, k, c.r, c.g, c.b, 1));
    put(f, 6, st.metal || 0, st.retic || 0, st.irid ?? 0.1, st.moto || 0);
    put(f, 7, st.doitsu || 0, opt.gin || 0, st.hajiro || 0, opt.fly || 0);
    finLong[f] = opt.fly ? 1 : 0;
  });
  const tPal = new THREE.DataTexture(palData, 8, KOI_N, THREE.RGBAFormat, THREE.FloatType);
  tPal.magFilter = tPal.minFilter = THREE.NearestFilter; tPal.colorSpace = THREE.NoColorSpace; tPal.needsUpdate = true;
  const shared = { tPattern: { value: tPattern }, tPal: { value: tPal } };
  const bodyMat = physical({ normalMap: tScale, normalScale: new THREE.Vector2(0.75, 0.75), roughness: 0.36, metalness: 0,
    clearcoat: 0.6, clearcoatRoughness: 0.12, sheen: 0.12, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xffffff),
    iridescence: 0.25, iridescenceIOR: 1.55, iridescenceThicknessRange: [180, 420], envMapIntensity: 1.05 }, {
    key: 'koibody2', uniforms: shared, vsPars: '#define KOI_BODY\n' + KOI_VS_PARS, vsNormal: KOI_VS_NORMAL, vsBegin: KOI_VS_BEGIN,
    fsPars: KOI_FS_PARS, fsMap: KOI_BODY_MAP, fsNormal: KOI_BODY_NORMAL,
    fsRough: 'roughnessFactor = mix(mix(roughnessFactor * (1.0 + (1.0 - rim) * 0.12 * scaleOn) * (1.0 - 0.25 * doitsu), 0.07, gin), 0.55, vMouthIn);',
    fsMetal: 'metalnessFactor = max(kInfo.x * 0.42, gin * 0.85);',
    fsPreLights: '#define KOI_SELF_IDX floor(vFishIdx + 0.5)\n#ifdef USE_CLEARCOAT\n material.clearcoat = mix(0.7, 1.0, max(kInfo.x, doitsu));\n#endif\n#ifdef USE_IRIDESCENCE\n material.iridescence = max(kInfo.z * (0.6 + 0.4 * rim), gin);\n#endif\n',
    fsPostLights: KOI_BODY_POST + KOI_GIN_POST,
  });
  const finMat = physical({ map: tFin, transparent: true, opacity: 0.86, side: THREE.DoubleSide, roughness: 0.4, depthWrite: false, sheen: 0.5, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xffffff), envMapIntensity: 0.9 }, {
    key: 'koifin2', uniforms: Object.assign({ uTransl: { value: 0.55 }, uDorsalFold: { value: new Array(KOI_N).fill(0) }, uFinLong: { value: finLong } }, shared), vsPars: '#define KOI_FIN\n' + KOI_VS_PARS, vsNormal: KOI_VS_NORMAL, vsBegin: KOI_VS_BEGIN, leaf: true,
    fsPars: KOI_FS_PARS, fsMap: KOI_FIN_MAP, fsPreLights: '#define KOI_SELF_IDX floor(vFishIdx + 0.5)\n', fsRough: 'roughnessFactor = mix(0.3, 0.75, smoothstep(0.4, 1.0, vFinEdge));',
  });
  const eyeMat = physical({ map: tEye, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 }, {
    key: 'koieye', uniforms: shared, vsPars: '#define KOI_EYE\n' + KOI_VS_PARS, vsNormal: KOI_VS_NORMAL, vsBegin: KOI_VS_BEGIN,
  });
  KOI.body = new THREE.InstancedMesh(bodyGeo, bodyMat, KOI_N);
  KOI.fins = new THREE.InstancedMesh(finGeo, finMat, KOI_N);
  KOI.eyes = new THREE.InstancedMesh(eyeGeo, eyeMat, KOI_N);
  KOI.body.castShadow = false;       // shadows come from koiShadow() in the underwater lighting instead (see UW_FS_PARS)
  if (KOI_N > KOI_MAX) console.warn('koi roster exceeds shadow slots');
  for (const m of [KOI.body, KOI.fins, KOI.eyes]) { m.receiveShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); setLayer(m, LAYER.UNDER); scene.add(m); }   // always seen through the water (they never break the surface, see updateFish)
  KOI.body.customDepthMaterial = patchedDepth({ key: 'koid2', uniforms: shared, vsPars: '#define KOI_BODY\n' + KOI_VS_PARS, vsBeginDepth: KOI_VS_BEGIN });
  KOI.fins.renderOrder = 2;
  Object.assign(KOI, { a1, a2, a3 });

  for (let i = 0; i < KOI_N; i++) {
    let x, z, guard = 0;
    do { x = rr(-2.8, 2.6); z = rr(-5, 5); } while (sdf(x, z) > -0.7 && guard++ < 200);
    const [, cls] = KOI_ROSTER_DEF[i], sr = KOI_SIZE_RANGE[cls], size = rr(sr[0], sr[1]);
    const prefDepth = cls === 'S' ? rr(0.12, 0.5) : cls === 'L' ? rr(0.35, 0.9) : rr(0.15, 0.85);   // youngsters keep to the shallows
    KOI.fish.push({
      p: new THREE.Vector3(x, -Math.min(prefDepth, pondDepth(x, z, -sdf(x, z)) - 0.15), z),
      heading: rand() * Math.PI * 2, pitch: 0, roll: 0, speed: rr(0.05, 0.15), turnRate: 0, bend: 0,
      // juveniles are slim, jumbo koi deep-bodied
      prefDepth, size, girth: rr(0.96, 1.05) + (size - 0.46) * 0.5, variety: KOI_ROSTER[i], phase: rand() * 10, amp: 0.03,
      pecL: rand() * 6, pecR: rand() * 6, spread: 0.5, gill: rand() * 6, mouth: 0, mouthT: rr(1, 6),
      bursting: false, cycleT: rr(0.2, 2), thrust: rr(0.2, 0.3), wander: 0, hover: 0, hoverCool: rr(8, 30),
      rise: 0, riseCooldown: rr(10, 40), dropT: 0, eyeYaw: 0, eyePitch: 0, eyeT: rr(0.5, 3), eyeTY: 0, eyeTP: 0,
      feed: 0, react: 0, prevSpeed: 0, lastWake: 0,
    });
  }
}

// Locomotion: burst-and-glide swimming with rate-limited, angular-acceleration-smoothed turning,
// C-bend into turns, pectorals that fold when fast and scull when hovering; boids steering, soft
// boundary, depth preference, occasional surfacing; frenzied feeding driven by FEED (section 13c).
const _m4 = new THREE.Matrix4(), _qk = new THREE.Quaternion(), _ek = new THREE.Euler(), _sk = new THREE.Vector3(), _pk = new THREE.Vector3();
export function updateFish(dt, t) {
  if (!KOI.body) return;
  const n = Math.min(P.fishCount | 0, KOI.fish.length);
  KOI.body.count = KOI.fins.count = KOI.eyes.count = n;
  const F = KOI.fish, feeding = typeof FEED !== 'undefined' && FEED.active;
  for (let i = 0; i < n; i++) {
    const f = F[i];
    const fx = Math.cos(f.heading), fz = -Math.sin(f.heading);
    // feeding excitement ramps up after a distance-based reaction delay and decays slowly afterwards
    if (feeding) { f.react -= dt; if (f.react <= 0) f.feed = Math.min(1, f.feed + dt * 1.6); }
    else f.feed = Math.max(0, f.feed - dt * 0.12);
    const fe = f.feed;
    let sx = 0, sz = 0, ax = 0, az = 0, cx = 0, cz = 0, nn = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const o = F[j], dx = o.p.x - f.p.x, dz = o.p.z - f.p.z, d2 = dx * dx + dz * dz;
      if (d2 > 2.6) continue;
      const d = Math.sqrt(d2) + 1e-4, dy = Math.abs(o.p.y - f.p.y), sepR = (f.size + o.size) * 0.62 * (1 - 0.45 * fe);
      if (d < sepR && dy < 0.3) { const k = (sepR - d) / sepR; sx -= dx / d * k; sz -= dz / d * k; }
      ax += Math.cos(o.heading); az += -Math.sin(o.heading); cx += dx; cz += dz; nn++;
    }
    f.wander += rr(-1, 1) * dt * (2.0 + fe * 6); f.wander *= 0.995;
    let dx = fx + Math.cos(f.heading + f.wander) * 0.8, dz = fz - Math.sin(f.heading + f.wander) * 0.8;
    dx += sx * 2.4; dz += sz * 2.4;
    if (nn && fe < 0.5) { dx += (ax / nn) * 0.4 + (cx / nn) * 0.22; dz += (az / nn) * 0.4 + (cz / nn) * 0.22; }
    if (STATE.under && i % 3 === 0 && fe < 0.2) {                 // curious koi come to inspect a submerged camera
      const cdx = camera.position.x - f.p.x, cdz = camera.position.z - f.p.z, cd = Math.hypot(cdx, cdz) + 1e-3;
      if (cd < 3.5) { const k = cd > 0.8 ? 0.5 : -1.2; dx += cdx / cd * k; dz += cdz / cd * k; }
    }
    // food: rush toward the nearest floating pellet (or the hand) with a jostling, competitive line
    let foodT = null;
    if (fe > 0.05) {
      foodT = typeof nearestFood === 'function' ? nearestFood(f.p) : null;
      if (foodT) {
        const tdx = foodT.x - f.p.x, tdz = foodT.z - f.p.z, td = Math.hypot(tdx, tdz) + 1e-3;
        dx += (tdx / td) * 5 * fe; dz += (tdz / td) * 5 * fe;
        f.foodDist = td;
      }
    }
    if (f.stroke && STROKE.active) {
      // called to the hand: glide in, then lie alongside the bank, facing along it
      const tdx = STROKE.spot.x - f.p.x, tdz = STROKE.spot.z - f.p.z, td = Math.hypot(tdx, tdz) + 1e-3;
      const w = smoothstep(0.1, 0.5, td);
      dx = lerp(STROKE.along.x, tdx / td, w) * 4; dz = lerp(STROKE.along.z, tdz / td, w) * 4;
      f.strokeD = td;
    }
    // soft boundary (look ahead) and pier avoidance
    const look = 0.4 + f.speed * 1.5, lx = f.p.x + fx * look, lz = f.p.z + fz * look, sd = sdf(lx, lz);
    if (sd > -0.7 && !(f.stroke && STROKE.active && f.strokeD < 1.2)) {
      const e = 0.03, gx = (sdf(lx + e, lz) - sdf(lx - e, lz)) / (2 * e), gz = (sdf(lx, lz + e) - sdf(lx, lz - e)) / (2 * e), k = (sd + 0.7) * 6.0;
      dx -= gx * k; dz -= gz * k;
    }
    for (const px of [-1.15, 1.15]) { const ddx = f.p.x - px, ddz = f.p.z - BRIDGE.z, d = Math.hypot(ddx, ddz); if (d < 0.9) { dx += ddx / d * (0.9 - d) * 3; dz += ddz / d * (0.9 - d) * 3; } }
    for (const o of WORLD.obstacles || []) { const ddx = f.p.x - o.x, ddz = f.p.z - o.z, d = Math.hypot(ddx, ddz), R = o.r + 0.35; if (d < R) { dx += ddx / d * (R - d) * 4; dz += ddz / d * (R - d) * 4; } }
    if (TURTLE.root && TURTLE.pos.y < WATER_Y - 0.02) { const ddx = f.p.x - TURTLE.pos.x, ddz = f.p.z - TURTLE.pos.z, d = Math.hypot(ddx, ddz) + 1e-3; if (d < 0.5 && Math.abs(f.p.y - TURTLE.pos.y) < 0.25) { dx += ddx / d * (0.5 - d) * 3; dz += ddz / d * (0.5 - d) * 3; } }
    // heading: desired turn rate, limited by speed, with angular acceleration smoothing
    let dh = Math.atan2(-dz, dx) - f.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const maxRate = 0.9 + 1.0 * clamp(1 - f.speed / 0.35, 0, 1) + fe * 2.4;
    const want = clamp(dh * (1.4 + fe * 3), -maxRate, maxRate), angAcc = 2.5 + fe * 9;
    f.turnRate += clamp(want - f.turnRate, -angAcc * dt, angAcc * dt);
    f.heading += f.turnRate * dt;
    // burst & glide: a few tail beats, then a coast; hungry fish beat almost continuously
    f.hoverCool -= dt;
    if (f.hover > 0) f.hover -= dt; else if (f.hoverCool < 0 && fe < 0.1) { f.hover = rr(2, 5); f.hoverCool = rr(15, 40); }
    f.cycleT -= dt;
    if (f.cycleT <= 0) {
      f.bursting = !f.bursting;
      f.cycleT = f.bursting ? (fe > 0.3 ? rr(0.5, 1.1) : rr(0.6, 1.5)) : (fe > 0.3 ? rr(0.05, 0.25) : rr(1.0, 3.2) * (f.hover > 0 ? 2 : 1));
      f.thrust = rr(0.18, 0.32);
    }
    if (!f.bursting && f.speed < 0.05 && f.hover <= 0 && fe < 0.1) f.cycleT = Math.min(f.cycleT, 0.2);
    let thrust = (f.bursting ? lerp(f.thrust, 1.15, fe) : lerp(0.015, 0.28, fe)) * (1 - 0.5 * SH.uIce.value * (1 - fe));   // sluggish in cold water
    if (f.hover > 0) thrust *= 0.15;
    thrust *= clamp(0.7 + 0.3 * f.size / 0.46, 0.8, 1.2);           // big koi cruise a little faster in m/s, slower in body lengths
    if (foodT && f.foodDist < 0.25) thrust *= 0.35;                // brake and jostle at the food
    if (f.stroke && STROKE.active) { thrust = f.strokeD < 0.3 ? 0.02 : f.strokeD < 0.8 ? 0.3 : 0.7; f.bursting = f.strokeD > 0.3; }
    f.prevSpeed = f.speed;
    f.speed += (thrust - 1.2 * f.speed - Math.abs(f.turnRate) * 0.12 * f.speed) * dt;
    f.speed = Math.max(0, f.speed);
    // tail kinematics: amplitude and frequency follow effort; turning adds a stroke
    const targetAmp = f.stroke && STROKE.active && f.strokeD < 0.35 ? 0.006 : (f.bursting ? 0.055 + thrust * 0.085 : 0.014) + Math.min(0.05, Math.abs(f.turnRate) * 0.025);
    f.amp = lerp(f.amp, targetAmp, 1 - Math.exp(-dt * 3.5));
    const freq = (f.bursting ? 1.1 + thrust * 2.6 : 0.55 + f.speed) * Math.sqrt(0.46 / f.size);   // small fish beat their tails faster
    f.phase += dt * Math.PI * 2 * freq;
    f.bend = lerp(f.bend, clamp(-f.turnRate * (0.07 + fe * 0.03), -0.3, 0.3), 1 - Math.exp(-dt * 5));
    // pectorals: folded when fast, flared when braking or hovering
    const braking = clamp((f.prevSpeed - f.speed) / Math.max(dt, 1e-3) * 3, 0, 1);
    f.spread = lerp(f.spread, clamp(1.1 - f.speed / 0.32 + braking * 0.8 + (f.hover > 0 ? 0.6 : 0), 0.12, 1), 1 - Math.exp(-dt * 3));
    const scull = 1.8 + clamp(1 - f.speed / 0.3, 0, 1) * 2.8;
    f.pecL += dt * (scull + 0.3 * Math.sin(t * 0.7 + i)); f.pecR += dt * (scull + 0.3 * Math.sin(t * 0.61 + i * 2));
    // depth: preference bounded by the floor; surfacing; feeding fish crowd the surface
    const floorD = pondDepth(f.p.x, f.p.z, Math.max(0.01, -sdf(f.p.x, f.p.z)));
    f.riseCooldown -= dt;
    if (f.riseCooldown < 0 && f.rise <= 0) { f.rise = rr(3, 6); f.riseCooldown = rr(20, 50); }
    let ty = -Math.min(f.prefDepth, floorD - 0.14);
    if (f.rise > 0) { f.rise -= dt; ty = WATER_Y - 0.06; }
    if (fe > 0.05) ty = lerp(ty, WATER_Y - 0.035 - f.size * 0.08 - (foodT ? 0 : 0.1), smoothstep(0, 1, fe) * (foodT && f.foodDist < 1.5 ? 1 : 0.6));
    const backTop = f.size * 0.14 * f.girth;                          // height of the dorsal ridge above the body axis
    if (f.stroke && STROKE.active) ty = WATER_Y - backTop - 0.022 - STROKE.touch * 0.005;   // back just under the surface, yields a little to the hand
    const vy = f.stroke && STROKE.active ? clamp((ty - f.p.y) * 1.8, -0.2, 0.2) : clamp((ty - f.p.y) * (0.6 + fe * 2.5), -0.15 - fe * 0.2, 0.15 + fe * 0.3);
    f.p.y += vy * dt;
    // the whole fish stays below the lowest wave trough, so the surface never slices it into above/below strips
    f.p.y = Math.min(f.p.y, WATER_Y - backTop - 0.022 - Math.max(0, Math.sin(f.pitch)) * f.size * 0.5);
    f.pitch = lerp(f.pitch, Math.atan2(vy, Math.max(f.speed, 0.06)) * 0.75 + (foodT && f.foodDist < 0.4 ? 0.12 * fe : 0), 1 - Math.exp(-dt * 3));
    f.p.x += fx * f.speed * dt; f.p.z += fz * f.speed * dt;
    if (sdf(f.p.x, f.p.z) > -0.15) { const e = 0.03, gx = (sdf(f.p.x + e, f.p.z) - sdf(f.p.x - e, f.p.z)) / (2 * e), gz = (sdf(f.p.x, f.p.z + e) - sdf(f.p.x, f.p.z - e)) / (2 * e); f.p.x -= gx * 0.012; f.p.z -= gz * 0.012; }
    // mouth: slow breathing gulps; rapid snapping at the surface when feeding
    f.mouthT -= dt;
    if (fe > 0.3 && foodT && f.foodDist < 0.5) {
      f.mouth = 0.55 + 0.45 * Math.max(0, Math.sin(t * 9 + i * 1.7));
      if (rand() < dt * 1.4) bubbleBurst(f.p.x - fx * f.size * 0.2, f.p.y - 0.02, f.p.z - fz * f.size * 0.2, 3 + (rand() * 4 | 0), 0.015, 0.0006, 0.0025, 0);   // air expelled through the gills
    }
    else if (f.mouthT < 0) { f.mouth = lerp(f.mouth, 0.25, 1 - Math.exp(-dt * 8)); if (f.mouthT < -0.35) f.mouthT = rr(2.5, 7); }
    else f.mouth = lerp(f.mouth, 0.0, 1 - Math.exp(-dt * 5));
    f.gill += dt * Math.PI * 2 * (0.9 + fe * 1.4 + f.speed * 2);
    // eyes: small saccades, or track the food
    f.eyeT -= dt;
    if (f.eyeT < 0) { f.eyeT = rr(0.6, 3); f.eyeTY = rr(-0.25, 0.25); f.eyeTP = rr(-0.18, 0.2); }
    if (foodT) { f.eyeTY = 0.15; f.eyeTP = 0.25; }
    f.eyeYaw = lerp(f.eyeYaw, f.eyeTY, 1 - Math.exp(-dt * 12)); f.eyePitch = lerp(f.eyePitch, f.eyeTP, 1 - Math.exp(-dt * 12));
    f.roll = lerp(f.roll, f.stroke && STROKE.active ? 0.22 * STROKE.touch : clamp(f.turnRate * 0.12, -0.28, 0.28), 1 - Math.exp(-dt * 2));   // leans into the hand
    if (f.stroke && STROKE.active) { f.spread = lerp(f.spread, 1, 1 - Math.exp(-dt * 3)); if (STROKE.touch > 0.5 && f.mouthT < 0) f.mouthT = 0; }
    // wakes: fish cruising near the surface leave a trail of tiny drops; hungry fish splash
    if (f.p.y > WATER_Y - 0.16 && f.speed > 0.06) {
      f.lastWake -= dt;
      if (f.lastWake < 0) {
        f.lastWake = fe > 0.3 ? rr(0.08, 0.18) : rr(0.2, 0.4);
        const tail = f.size * 0.5, depthK = smoothstep(-0.16, -0.03, f.p.y - WATER_Y);
        addDrop(f.p.x - fx * tail, f.p.z - fz * tail, 0.06 + f.size * 0.1, -(0.0015 + f.speed * 0.006 + fe * 0.004) * depthK);
        if (fe > 0.4 && typeof spawnSplash === 'function' && rand() < 0.35) spawnSplash(f.p.x + fx * f.size * 0.45, f.p.z + fz * f.size * 0.45, 0.4 + f.speed);
      }
    }
    if (f.rise > 0 && f.p.y > WATER_Y - 0.1) {
      f.dropT -= dt;
      if (f.dropT < 0) { f.dropT = rr(0.35, 0.8); addDrop(f.p.x + fx * f.size * 0.45, f.p.z + fz * f.size * 0.45, 0.09, -0.004); f.mouth = 0.8; }
    }
    KOI.a1.setXYZW(i, f.phase, f.amp, f.bend, i);
    KOI.a2.setXYZW(i, f.pecL, f.pecR, f.girth, f.spread);
    KOI.a3.setXYZW(i, f.mouth, f.gill, f.eyeYaw, f.eyePitch);
  }
  // hard overlap resolution so crowding fish never interpenetrate
  // bodies as three spheres along the spine (head, middle, tail): push apart wherever they overlap
  const spine = [0.3, 0, -0.3];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = F[i], b = F[j];
    if (Math.abs(a.p.x - b.p.x) + Math.abs(a.p.z - b.p.z) > (a.size + b.size) * 1.2) continue;
    const ax = Math.cos(a.heading), az = -Math.sin(a.heading), bx = Math.cos(b.heading), bz = -Math.sin(b.heading), r = (a.size + b.size) * 0.1;
    for (const u of spine) for (const w of spine) {
      const dx = (b.p.x + bx * w * b.size) - (a.p.x + ax * u * a.size), dz = (b.p.z + bz * w * b.size) - (a.p.z + az * u * a.size), dy = (b.p.y - a.p.y) * 1.15;
      const d = Math.hypot(dx, dy, dz);
      if (d < r && d > 1e-4) { const k = (r - d) * 0.35 / d; a.p.x -= dx * k; a.p.z -= dz * k; b.p.x += dx * k; b.p.z += dz * k; a.p.y -= dy * k * 0.25; b.p.y += dy * k * 0.25; }
    }
  }
  for (let i = 0; i < n; i++) {
    const f = F[i];
    _ek.set(f.roll, f.heading, f.pitch, 'YZX'); _qk.setFromEuler(_ek);
    _sk.setScalar(f.size); _pk.copy(f.p);
    _m4.compose(_pk, _qk, _sk);
    KOI.body.setMatrixAt(i, _m4); KOI.fins.setMatrixAt(i, _m4); KOI.eyes.setMatrixAt(i, _m4);
  }
  const SA = SH.uKoiA.value, SB = SH.uKoiB.value;
  for (let i = 0; i < KOI_MAX; i++) {
    const f = F[i];
    if (!f || i >= n) { SA[i].set(0, 0, 0, 0); continue; }
    const latTail = f.amp * (0.05 + 0.95 * 0.81) * Math.sin(0.9 * 5.7 - f.phase) + f.bend * 0.36;
    SA[i].set(f.p.x, f.p.y, f.p.z, f.size);
    SB[i].set(Math.cos(f.heading) * f.girth, -Math.sin(f.heading) * f.girth, latTail, 0);
  }
  KOI.a1.needsUpdate = KOI.a2.needsUpdate = KOI.a3.needsUpdate = true;
  KOI.body.instanceMatrix.needsUpdate = KOI.fins.instanceMatrix.needsUpdate = KOI.eyes.instanceMatrix.needsUpdate = true;
}

