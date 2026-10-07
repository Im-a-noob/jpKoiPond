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
import { koiBackPoint, koiLift } from "./handCollisions";
import { feedingShot } from "./feeding";
import { startAudio, AUDIO, burst, tone } from "./audio";
import { resolveHandCollisions } from "./handCollisions";
const _hf = new THREE.Vector3(), _hr = new THREE.Vector3(), _hu = new THREE.Vector3(), _ha = new THREE.Vector3(), _hs = new THREE.Vector3(), _hx = new THREE.Vector3(), _hy = new THREE.Vector3(), _hz = new THREE.Vector3(), _hm = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ 13f. STROKE A KOI */
// Crouch at the bank, call the nearest koi and gently stroke its back. Tame koi really do this: the fish glides in,
// lies alongside the bank just under the surface, leans into the hand, fans its pectorals and mouths softly. The hand
// makes three slow strokes head-to-tail (or follows your drag across the fish), dimpling the surface where it touches.
export const STROKE = { active: false, t: 0, fish: null, shot: null, spot: new THREE.Vector3(), along: new THREE.Vector3(), touch: 0, side: 1, user: -1, lastDrop: 0, lastSwish: 0, phaseStart: -1 };
export function startStroke() {
  if (!FEED.hand || FEED.active || STROKE.active) return;
  const shot = P.cameraMode === 'Cinematic' ? feedingShot(0.9, 5.8) : feedingShot(camera.position.x, camera.position.z);
  STROKE.shot = shot;
  const fwd = new THREE.Vector3().subVectors(shot.look, shot.pos).setY(0).normalize();
  STROKE.along.set(-fwd.z, 0, fwd.x);                                  // the fish lies across the view, parallel to the bank
  STROKE.spot.copy(shot.pos).addScaledVector(fwd, 0.95).setY(WATER_Y);
  // lean out over the fish and look almost straight down on it, like the classic photo of a hand on a koi
  STROKE.shot = { pos: STROKE.spot.clone().addScaledVector(fwd, -0.42).setY(WATER_Y + 0.66), look: STROKE.spot.clone().addScaledVector(fwd, 0.04).setY(WATER_Y - 0.05) };
  const all = KOI.fish.slice(0, Math.min(P.fishCount, KOI.fish.length)), tame = all.filter((f) => f.size > 0.36 && f.size < 0.66);
  const fs = tame.length ? tame : all;                                 // a juvenile is too shy (and too small) to come to the hand
  STROKE.fish = fs.reduce((b, f) => (f.p.distanceTo(STROKE.spot) < b.p.distanceTo(STROKE.spot) ? f : b), fs[0]);
  STROKE.fish.stroke = 1;
  STROKE.t = 0; STROKE.phaseStart = -1; STROKE.user = -1; STROKE.active = true; STROKE.touch = 0; STROKE.hpInit = false; STROKE.col = { lift: 0 };
  $('strokebtn').disabled = true; $('feedbtn').disabled = true;
  toast('A koi is coming to your hand… drag across it to stroke');
  startAudio();
}
export function endStroke() {
  STROKE.active = false;
  if (KOI.fins && KOI.fins.material.userData.uniforms.uDorsalFold) KOI.fins.material.userData.uniforms.uDorsalFold.value.fill(0);
  if (STROKE.fish) { const f = STROKE.fish; f.stroke = 0; f.bursting = true; f.cycleT = 0.6; f.thrust = 0.3; f.heading += rr(-0.6, 0.6); }
  if (FEED.hand) FEED.hand.root.visible = false;
  STROKE.shot = null; $('strokebtn').disabled = false; $('feedbtn').disabled = false;
}
const _sk1 = new THREE.Vector3(), _sk2 = new THREE.Vector3(), _sk3 = new THREE.Vector3();
export function updateStroke(dt, t) {
  if (!STROKE.active || dt <= 0) return;
  STROKE.t += dt;
  const f = STROKE.fish, H = FEED.hand, T = STROKE.t;
  const fx = Math.cos(f.heading), fz = -Math.sin(f.heading);
  // the hand only reaches in once the koi is alongside AND has risen to lie just under the surface
  const backTopY = f.p.y + f.size * 0.14 * f.girth;
  const arrived = Math.hypot(f.p.x - STROKE.spot.x, f.p.z - STROKE.spot.z) < 0.18 && backTopY > WATER_Y - 0.045;
  if (STROKE.phaseStart < 0 && (arrived && T > 1.6 || T > 14)) STROKE.phaseStart = T;
  const S = STROKE.phaseStart < 0 ? -1 : T - STROKE.phaseStart;       // time since the hand started
  const nStrokes = 3, cyc = 2.4, tIn = 1.7, tOut = 1.7, total = tIn + nStrokes * cyc + tOut, hover = 0.05;
  const ease = (x) => { x = clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); };   // smootherstep: zero velocity and acceleration at both ends
  camera.getWorldDirection(_hf); _hr.crossVectors(_hf, _up).normalize(); _hu.crossVectors(_hr, _hf);
  // the hand starts (and ends) retracted just in front of the shoulder, off-screen and clear of the bank
  const shoulder0 = _hs.copy(camera.position).addScaledVector(_hr, 0.55).addScaledVector(_hu, -0.3).addScaledVector(_hf, 0.15);
  koiBackPoint(f, 0.2, _sk2); _sk2.y += hover;
  const away = _ha.copy(shoulder0).lerp(_sk2, 0.22);
  // One continuous path (every phase starts exactly where the previous one ended): reach in to hover just above
  // the koi's back behind its head, three slow head-to-tail strokes in contact with its exact back surface, each
  // lifting and returning to that same hover point, then withdraw from it.
  let touch = 0;
  const des = _sk1;
  if (S < 0) { H.root.visible = false; }
  else {
    H.root.visible = S < total;
    if (S < tIn) { koiBackPoint(f, 0.2, _sk2); _sk2.y += hover; des.lerpVectors(away, _sk2, ease(S / tIn)); }
    else if (S < tIn + nStrokes * cyc) {
      const c = ((S - tIn) % cyc) / cyc;
      let sb;
      if (STROKE.user >= 0) { sb = STROKE.user; touch = 1; }        // following the viewer's drag
      else { sb = c < 0.7 ? lerp(0.2, 0.74, ease(c / 0.7)) : lerp(0.74, 0.2, ease((c - 0.7) / 0.3)); touch = smoothstep(0.0, 0.1, c) * (1 - smoothstep(0.62, 0.72, c)); }
      koiBackPoint(f, sb, des); des.y += hover * (1 - touch);
      if (touch > 0.5 && T - STROKE.lastDrop > 0.12) { STROKE.lastDrop = T; addDrop(des.x, des.z, 0.05, -0.0012); }
      if (touch > 0.5 && T - STROKE.lastSwish > cyc * 0.8 && AUDIO.ctx) { STROKE.lastSwish = T; burst(rr(900, 1300), 0.8, 0.5, 0.02, 0.2, 0, 500); }
      if (touch < 0.2 && rand() < dt * 3 && AUDIO.ctx) tone('sine', rr(1500, 2300), rr(800, 1100), 0.06, 0.012, 0.25);   // drips off the fingers
    } else { koiBackPoint(f, 0.2, _sk2); _sk2.y += hover; des.lerpVectors(_sk2, away, ease((S - tIn - nStrokes * cyc) / tOut)); }
    if (S >= total) endStroke();
  }
  STROKE.touch = lerp(STROKE.touch, touch, 1 - Math.exp(-dt * 8));
  if (KOI.fins && KOI.fins.material.userData.uniforms.uDorsalFold) { const fold = KOI.fins.material.userData.uniforms.uDorsalFold.value, i = KOI.fish.indexOf(f); if (i >= 0) fold[i] = lerp(fold[i], S >= 0 ? 1 : 0, 1 - Math.exp(-dt * 3)); }   // the koi lays its dorsal fin flat under the hand
  if (H.root.visible) {
    // a critically damped follow removes any residual kink (e.g. when a drag starts) so the hand always glides
    des.y = Math.max(des.y, WATER_Y - 0.035);                         // fingers dip a few centimetres at most
    if (!STROKE.hpInit) { STROKE.hp = des.clone(); STROKE.hpInit = true; }
    STROKE.hp.lerp(des, 1 - Math.exp(-dt * 12));
    const target = STROKE.hp;
    // wrist sits behind the palm; the arm reaches in from the right and rises out of the water toward the shoulder
    const shoulder = _hs.copy(camera.position).addScaledVector(_hr, 0.55).addScaledVector(_hu, -0.3).addScaledVector(_hf, 0.15);
    const X = _hx.subVectors(target, shoulder).normalize();
    const wrist = _sk3.copy(target).addScaledVector(X, -0.055); wrist.y += 0.012;
    H.root.position.copy(wrist);
    const Y = _hy.set(0, 1, 0).addScaledVector(X, -X.y).normalize(), Z = _hz.crossVectors(X, Y);
    H.root.quaternion.setFromRotationMatrix(_hm.makeBasis(X, Y, Z));
    H.root.rotateX(0.08);
    H.palm.rotation.set(0, 0, -0.08 - 0.1 * STROKE.touch);
    poseHandFlat(0.5 + 0.5 * STROKE.touch, T);
    resolveHandCollisions(H, false, STROKE.col, dt);                 // never through the koi, rocks or bank
  }
  if (T > 30) endStroke();
}
