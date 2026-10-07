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
import { audioEvent } from "./audio";
import { splashAt, bubbleBurst } from "./bubbles";
import { FEED, poseHandFlat } from "./handMesh";
import { KOI } from "./koi";
import { POLY_LEN, shoreAt, BRIDGE, ground } from "./terrain";
import { nearWaterfall } from "./waterfallMesh";
import { STROKE } from "./stroke";
import { setHold, CTRL } from "./controls";
import { poseHand } from "./handMesh";
import { resolveHandCollisions } from "./handCollisions";
import { spawnSplash, updateSplashes } from "./bubbles";
import { PATH } from "./cinematics";
const _hf = new THREE.Vector3(), _hr = new THREE.Vector3(), _hu = new THREE.Vector3(), _hh = new THREE.Vector3(), _ha = new THREE.Vector3(), _hs = new THREE.Vector3(), _hx = new THREE.Vector3(), _hy = new THREE.Vector3(), _hz = new THREE.Vector3(), _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), _hm = new THREE.Matrix4(), _tip = new THREE.Vector3(), _tip2 = new THREE.Vector3(), _sk = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export function feedingShot(nx, nz) {
  let best = null, bd = 1e9;
  for (let s = 0; s < POLY_LEN; s += 0.05) {
    const sh = shoreAt(s); if (nearWaterfall(sh.x, sh.z, 1.5)) continue;
    if ((WORLD.irisClumps || []).some((c) => Math.hypot(c.x - sh.x, c.z - sh.z) < 1.1) || Math.hypot(sh.x + 2.6, sh.z + 0.1) < 1.4) continue;   // clear of iris and lotus
    if (Math.abs(sh.z - BRIDGE.z) < 1.0 && Math.abs(Math.abs(sh.x) - 1.8) < 0.9) continue;
    const d = Math.hypot(sh.x - nx, sh.z - nz); if (d < bd) { bd = d; best = sh; }
  }
  const sh = best, pos = new THREE.Vector3(sh.x + sh.nx * 0.12, 0, sh.z + sh.nz * 0.12);
  pos.y = Math.max(ground(pos.x, pos.z), 0.15) + 0.82;
  return { pos, look: new THREE.Vector3(sh.x - sh.nx * 1.15, WATER_Y - 0.1, sh.z - sh.nz * 1.15), drop: new THREE.Vector3(sh.x - sh.nx * 0.6, WATER_Y, sh.z - sh.nz * 0.6) };
}
export function startFeeding() {
  if (!FEED.hand || FEED.active && FEED.t < 4.5 || STROKE.active) return;
  FEED.col = { lift: 0 }; FEED.hpInit = false;
  const shot = P.cameraMode === 'Cinematic' ? feedingShot(0.9, 5.8) : feedingShot(camera.position.x, camera.position.z);
  FEED.shot = shot; FEED.point.copy(shot.drop);
  FEED.toward.set(shot.pos.x - shot.drop.x, 0, shot.pos.z - shot.drop.z).normalize();
  FEED.side.set(-FEED.toward.z, 0, FEED.toward.x);
  FEED.active = true; FEED.t = 0; FEED.emitted = 0; FEED.linger = 0;
  if (P.holdCamera) setHold(false);
  for (let i = 0; i < KOI.fish.length; i++) { const f = KOI.fish[i]; f.react = Math.hypot(f.p.x - FEED.point.x, f.p.z - FEED.point.z) * 0.22 + rr(0.6, 1.4); }
  $('feedbtn').disabled = true;
  toast('Feeding the koi');
  if (typeof audioEvent === 'function') audioEvent('feedStart');
}
export function nearestFood(pos) {
  let best = null, bd = 1e9;
  for (const q of FEED.pellets) {
    if (q.eaten || q.y > WATER_Y + 0.05) continue;
    const d = (q.x - pos.x) ** 2 + (q.z - pos.z) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  if (best) return best;
  return FEED.active ? FEED.point : null;
}
export function updateFeeding(dt, t) {
  if (!FEED.hand) return;
  const H = FEED.hand;
  FEED.excite = lerp(FEED.excite, FEED.active ? 1 : 0, 1 - Math.exp(-dt * (FEED.active ? 2 : 0.35)));
  if (FEED.active) {
    FEED.t += dt;
    const T = FEED.t;
    // first-person hand: reaches in from the lower-right edge once the camera has settled, sprinkles, withdraws
    const Th = T - 1.0;
    camera.getWorldDirection(_hf); _hr.crossVectors(_hf, _up).normalize(); _hu.crossVectors(_hr, _hf);
    const hold = _hh.copy(camera.position).addScaledVector(_hf, 0.5).addScaledVector(_hr, 0.05).addScaledVector(_hu, -0.06);
    // retracted near the (off-screen) shoulder: never parked inside the bank
    const shoulderF = _hs.copy(camera.position).addScaledVector(_hr, 0.3).addScaledVector(_hu, -0.6).addScaledVector(_hf, -0.05);
    const away = _ha.copy(shoulderF).lerp(hold, 0.25);
    let k, pinch = 1, rub = 0;
    const sm = (x) => { x = clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); };   // zero speed at both ends
    if (Th < 0) _hp.copy(away);
    else if (Th < 1.0) { k = sm(Th); _hp.lerpVectors(away, hold, k); }
    else if (Th < 3.0) { _hp.copy(hold); _hp.addScaledVector(_hu, Math.sin((Th - 1.0) * 5) * 0.004 * smoothstep(1.0, 1.4, Th)); rub = smoothstep(1.0, 1.35, Th) * (1 - smoothstep(2.7, 3.0, Th)); pinch = lerp(1, 0.55, smoothstep(1.2, 3.0, Th)); }
    else if (Th < 4.1) { k = sm((Th - 3.0) / 1.1); _hp.lerpVectors(hold, away, k); pinch = lerp(0.55, 0.2, k); }
    else _hp.copy(away);
    // follow-spring: the hand glides even while the camera is still settling into the shot
    // spring runs in camera space, so the first-person hand stays glued to the view while the camera is still gliding in
    _hp.sub(camera.position); const lx = _hp.dot(_hr), ly = _hp.dot(_hu), lz = _hp.dot(_hf);
    if (!FEED.hpInit || !H.root.visible) { FEED.hp = new THREE.Vector3(lx, ly, lz); FEED.hpInit = true; }
    else FEED.hp.lerp(_tip.set(lx, ly, lz), 1 - Math.exp(-dt * 14));
    _hp.copy(camera.position).addScaledVector(_hr, FEED.hp.x).addScaledVector(_hu, FEED.hp.y).addScaledVector(_hf, FEED.hp.z);
    H.root.visible = Th > -0.05 && Th < 4.1;
    if (H.root.visible) {
      H.root.position.copy(_hp);
      // forearm points from an off-screen shoulder (lower right, level with the camera) to the wrist; palm down
      const shoulder = _hs.copy(camera.position).addScaledVector(_hr, 0.3).addScaledVector(_hu, -0.6).addScaledVector(_hf, -0.05);
      const X = _hx.subVectors(_hp, shoulder).normalize(), Y = _hy.set(0, 1, 0).addScaledVector(X, -X.y).normalize(), Z = _hz.crossVectors(X, Y);
      H.root.quaternion.setFromRotationMatrix(_hm.makeBasis(X, Y, Z));
      H.root.rotateX(0.42 + 0.05 * Math.sin(T * 2.1));                                   // rolled thumb-side up: a natural three-quarter view
      H.palm.rotation.set(0, -0.1, -0.3 + 0.05 * Math.sin(T * 1.7));                      // wrist only gently flexed toward the water
      poseHand(pinch, rub, T);
      resolveHandCollisions(H, false, FEED.col || (FEED.col = { lift: 0 }), dt);   // never through koi, rocks or the bank
      // release pellets from between thumb and fingertips while rubbing
      if (rub > 0 && FEED.pellets.length < 70) {
        const want = Math.floor((Th - 1.0) * 24);
        while (FEED.emitted < want) {
          FEED.emitted++;
          H.J.index[2].children[0].getWorldPosition(_tip); H.J.thumb[2].children[0].getWorldPosition(_tip2);
          _tip.lerp(_tip2, 0.5);
          FEED.pellets.push({ x: _tip.x, y: _tip.y - 0.01, z: _tip.z, vx: rr(-0.25, 0.25) - FEED.toward.x * 0.15, vy: rr(-0.1, 0.1), vz: rr(-0.25, 0.25) - FEED.toward.z * 0.15, fl: false, eaten: false, rot: rand() * 6, ph: rand() * 6 });
        }
      }
    }
    const left = FEED.pellets.filter((q) => !q.eaten).length;
    if (T > 5.2 && left === 0) { FEED.linger += dt; if (FEED.linger > 2.5) endFeeding(); }
    if (T > 45) endFeeding();
  }
  // pellets: fall, splash, float and drift; nudged by fish; eaten when a mouth reaches them
  const F = KOI.fish, n = Math.min(P.fishCount | 0, F.length);
  let c = 0;
  for (const q of FEED.pellets) {
    if (q.eaten) continue;
    if (!q.fl) {
      q.vy -= 9.81 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const wh = waterHeightAt(q.x, q.z, t);
      if (q.y <= wh) { q.fl = true; q.y = wh; q.vx *= 0.15; q.vz *= 0.15; addDrop(q.x, q.z, 0.035, -0.0018); if (typeof audioEvent === 'function' && rand() < 0.4) audioEvent('plip'); }
    } else {
      q.x += q.vx * dt; q.z += q.vz * dt; q.vx *= 0.99; q.vz *= 0.99;
      q.y = waterHeightAt(q.x, q.z, t) + 0.0015;
      if (sdf(q.x, q.z) > -0.08) { q.vx *= -0.5; q.vz *= -0.5; }
      for (let i = 0; i < n; i++) {
        const f = F[i], mx = f.p.x + Math.cos(f.heading) * f.size * 0.5, mz = f.p.z - Math.sin(f.heading) * f.size * 0.5;
        const d = Math.hypot(q.x - mx, q.z - mz), depth = WATER_Y - f.p.y;
        if (d < 0.05 + f.size * 0.05 && depth < 0.12 && f.feed > 0.3) {
          q.eaten = true; f.mouth = 1; f.mouthT = 0.4;
          addDrop(mx, mz, 0.08, -0.006); spawnSplash(mx, mz, 0.7);
          if (typeof audioEvent === 'function') audioEvent('gulp');
          break;
        }
        if (d < 0.25) { q.vx += (q.x - mx) / (d + 0.01) * 0.02 * dt * 60 * 0.03; q.vz += (q.z - mz) / (d + 0.01) * 0.02 * dt * 60 * 0.03; }
      }
    }
    if (q.eaten) continue;
    _hp.set(q.x, q.y, q.z); _hq.setFromEuler(new THREE.Euler(q.rot, q.rot * 1.3, 0)); _hm.compose(_hp, _hq, _sk.set(1, 1, 1));
    FEED.pelletMesh.setMatrixAt(c++, _hm);
  }
  FEED.pelletMesh.count = c; FEED.pelletMesh.instanceMatrix.needsUpdate = true;
  if (!FEED.active && FEED.pellets.length && FEED.pellets.every((q) => q.eaten)) FEED.pellets.length = 0;
  updateSplashes(dt);
}

export function endFeeding() {
  FEED.active = false; FEED.hand.root.visible = false; FEED.shot = null;
  if (P.cameraMode === 'Manual') { const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); CTRL.yaw = e.y; CTRL.pitch = e.x; }
  FEED.pellets = FEED.pellets.filter((q) => !q.eaten);
  $('feedbtn').disabled = false;
  if (P.cameraMode !== 'Manual') PATH.blend = 0;
}

/* --- Splash droplets (CPU particles rendered as soft, lit points above the surface) */
