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
import { addDrop, waterHeightAt } from "./water";
import { startAudio } from "./audio";
import { startFeeding } from "./feeding";
import { cycleWeather } from "./weather";
import { startStroke, STROKE } from "./stroke";
import { FOLLOW, PATH } from "./cinematics";
import { canvas } from "./lighting";
import { frogHit, frogJump } from "./frog";
import { bubbleBurst, spawnSplash, splashAt } from "./bubbles";
import { stopAudio } from "./audio";
export const GUI_CTRL: any = {};
const _hf = new THREE.Vector3(), _hr = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export const CTRL = { yaw: 0.06, pitch: -0.07, keys: {}, dragging: false, moved: 0, lastX: 0, lastY: 0 };
const raycaster = new THREE.Raycaster(), _ndc = new THREE.Vector2(), waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);
export function setupControls() {
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.metaKey || e.key === 'Meta' || e.key === 'OS') { screenshotGuard(); return; }   // e.g. Shift+Cmd+4: hold the shot, never treat it as movement
    CTRL.keys[e.code] = true;
    if (e.code !== 'KeyM') startAudio();
    if (e.code === 'KeyF' || e.code === 'KeyC') toggleCameraMode();
    if (e.code === 'KeyP') setHold(!P.holdCamera);
    if (e.code === 'KeyO') setFreeze(!P.freezeScene);
    if (e.code === 'KeyV' || (e.code === 'Escape' && P.cleanView)) setClean(!P.cleanView);
    if (e.code === 'KeyE') startFeeding();
    if (e.code === 'KeyT') cycleWeather();
    if (e.code === 'KeyG') startStroke();
    if (e.code === 'KeyM') setMuted(P.audio);
    if (e.code === 'KeyI') setGuide($('help').classList.contains('hidden'));
    if (e.code === 'KeyK') { if (P.cameraMode === 'Follow koi') FOLLOW.idx++; else P.cameraMode = 'Follow koi'; onCameraMode(); }
    if (e.code === 'KeyH') { const d = document.querySelector('.dg.ac'); if (d) d.style.display = d.style.display === 'none' ? '' : 'none'; }
  });
  addEventListener('keyup', (e) => { CTRL.keys[e.code] = false; if (e.key === 'Meta') clearKeys(); });
  // keys released while the page is not focused never send keyup: forget them so the camera can't drift
  addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', clearKeys);
  canvas.addEventListener('pointerdown', (e) => { CTRL.dragging = true; CTRL.moved = 0; CTRL.lastX = e.clientX; CTRL.lastY = e.clientY; canvas.setPointerCapture(e.pointerId); startAudio(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!CTRL.dragging) return;
    const dx = e.clientX - CTRL.lastX, dy = e.clientY - CTRL.lastY; CTRL.lastX = e.clientX; CTRL.lastY = e.clientY;
    CTRL.moved += Math.abs(dx) + Math.abs(dy);
    if (STROKE.active && STROKE.phaseStart >= 0) { STROKE.user = clamp((STROKE.user < 0 ? 0.3 : STROKE.user) + dx * 0.0025 * (STROKE.along.dot(_hr.crossVectors(camera.getWorldDirection(_hf), _up)) > 0 ? 1 : -1), 0.1, 0.85); return; }
    if (P.cameraMode === 'Manual' && !P.holdCamera) { CTRL.yaw -= dx * 0.0032; CTRL.pitch = clamp(CTRL.pitch - dy * 0.0032, -1.45, 1.45); }
  });
  canvas.addEventListener('wheel', (e) => { if (P.cameraMode !== 'Manual') return; e.preventDefault(); CTRL.speedMul = clamp((CTRL.speedMul || 1) * (e.deltaY > 0 ? 0.85 : 1.18), 0.05, 5); toast(`Fly speed ×${CTRL.speedMul.toFixed(2)}`); }, { passive: false });
  canvas.addEventListener('pointerup', (e) => {
    CTRL.dragging = false; STROKE.user = -1;
    if (CTRL.moved < 5) {                               // a click: drop a ripple where the ray meets the water
      _ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(_ndc, camera);
      if (frogHit(raycaster.ray)) { frogJump(); return; }
      const hit = raycaster.ray.intersectPlane(waterPlane, new THREE.Vector3());
      if (hit && sdf(hit.x, hit.z) < -0.05 && !STROKE.active) { addDrop(hit.x, hit.z, 0.16, -0.014); bubbleBurst(hit.x, WATER_Y - 0.01, hit.z, 10, 0.03, 0.0005, 0.003, 0.25); spawnSplash(hit.x, hit.z, 0.45, WATER_Y, true); splashAt(hit.x, WATER_Y, hit.z, 0.42); }
    }
  });
  canvas.addEventListener('pointermove', (e) => {           // hovering the cursor across the water leaves a faint wake
    if (CTRL.dragging) return;
    CTRL.hoverX = e.clientX; CTRL.hoverY = e.clientY; CTRL.hoverT = performance.now();
    _ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(_ndc, camera);
    canvas.style.cursor = frogHit(raycaster.ray) ? 'pointer' : '';
  });
}
let lastHoverDrop = 0;
export function hoverRipples() {
  if (!CTRL.hoverT || performance.now() - CTRL.hoverT > 80 || performance.now() - lastHoverDrop < 70) return;
  _ndc.set((CTRL.hoverX / window.innerWidth) * 2 - 1, -(CTRL.hoverY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  const hit = raycaster.ray.intersectPlane(waterPlane, new THREE.Vector3());
  if (hit && sdf(hit.x, hit.z) < -0.05 && hit.distanceTo(camera.position) < 25) { addDrop(hit.x, hit.z, 0.07, -0.0025); lastHoverDrop = performance.now(); }
}
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
export function clearKeys() { for (const k in CTRL.keys) CTRL.keys[k] = false; CTRL.dragging = false; }
let guardTimer = 0;
export function screenshotGuard() {
  clearKeys();
  if (!P.holdCamera) { setHold(true, true); toast('Camera held for your screenshot · P to release'); }
  clearTimeout(guardTimer); guardTimer = setTimeout(() => { if (P.holdCamera && P._autoHold) setHold(false); }, 12000);
}
export function setHold(v, auto = false) {
  P.holdCamera = v; P._autoHold = v && auto;
  $('tb-hold').setAttribute('aria-pressed', String(v)); setBtnLabel('tb-hold', v ? 'Shot held' : 'Hold shot');
  if (!auto) toast(v ? 'Shot held · camera will not move (P to release)' : 'Camera released');
  if (!v && P.cameraMode === 'Cinematic') PATH.blend = 0;
  if (GUI_CTRL.hold) GUI_CTRL.hold.updateDisplay();
}
export function setFreeze(v) {
  P.freezeScene = v; $('tb-freeze').setAttribute('aria-pressed', String(v)); setBtnLabel('tb-freeze', v ? 'Time frozen' : 'Freeze time');
  toast(v ? 'Time frozen · O to resume' : 'Time resumed');
  if (GUI_CTRL.freeze) GUI_CTRL.freeze.updateDisplay();
}
// toolbar buttons carry an icon + a label span; only the label changes
export function setBtnLabel(id, text) { const b = $(id); if (!b) return; const l = b.querySelector('.lbl'); if (l) l.textContent = text; else b.textContent = text; }
// sound: one switch for all ambience and effects (M / toolbar / panel), remembered between visits
export function setMuted(m) {
  P.audio = !m;
  if (m) { if (typeof stopAudio === 'function') stopAudio(); } else startAudio(true);
  const b = $('tb-sound');
  if (b) { b.setAttribute('aria-pressed', String(m)); b.setAttribute('aria-label', m ? 'Unmute' : 'Mute'); b.title = (m ? 'Unmute' : 'Mute') + ' (M)'; setBtnLabel('tb-sound', m ? 'Muted' : 'Sound'); }
  if (GUI_CTRL.audio) GUI_CTRL.audio.updateDisplay();
  try { localStorage.setItem('koi.muted', m ? '1' : '0'); } catch (e) { /* storage unavailable */ }
}
// the guide card (top left): I toggles it, the x hides it, a small ? brings it back; remembered between visits
export function setGuide(show) {
  $('help').classList.toggle('hidden', !show); $('help').setAttribute('aria-hidden', String(!show));
  $('help-open').classList.toggle('shown', !show);
  try { localStorage.setItem('koi.guide', show ? '1' : '0'); } catch (e) { /* storage unavailable */ }
}
export function setClean(v) {
  P.cleanView = v; document.body.classList.toggle('clean', v);
  if (v) { clearKeys(); const h = $('cleanhint'); h.style.opacity = 1; clearTimeout(setClean._t); setClean._t = setTimeout(() => (h.style.opacity = 0), 1800); }
}
export function toggleCameraMode() { P.cameraMode = P.cameraMode === 'Cinematic' ? 'Manual' : 'Cinematic'; onCameraMode(); }
export function updateFreeCamera(dt) {
  // WASD / arrows move, Q down, Space (or R) up, Shift sprint, Alt fine, mouse wheel sets base speed
  const k = CTRL.keys, sp = (k.ShiftLeft || k.ShiftRight ? 3.5 : 1.3) * (CTRL.speedMul || 1) * (k.AltLeft || k.AltRight ? 0.2 : 1) * dt;
  camera.rotation.set(CTRL.pitch, CTRL.yaw, 0, 'YXZ');
  camera.getWorldDirection(_fwd); _right.crossVectors(_fwd, camera.up).normalize();
  if (k.KeyW || k.ArrowUp) camera.position.addScaledVector(_fwd, sp);
  if (k.KeyS || k.ArrowDown) camera.position.addScaledVector(_fwd, -sp);
  if (k.KeyA || k.ArrowLeft) camera.position.addScaledVector(_right, -sp);
  if (k.KeyD || k.ArrowRight) camera.position.addScaledVector(_right, sp);
  if (k.KeyQ || k.PageDown) camera.position.y -= sp * 0.7;          // descend (dives when over the pond)
  if (k.Space || k.KeyR || k.PageUp) camera.position.y += sp * 0.7;
}
export function onCameraMode() {
  if (P.cameraMode === 'Manual') {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); CTRL.yaw = e.y; CTRL.pitch = e.x;
  } else PATH.blend = 0;
  if (GUI_CTRL.cam) GUI_CTRL.cam.updateDisplay();
  setBtnLabel('tb-cam', P.cameraMode === 'Cinematic' ? 'Manual camera' : 'Cinematic camera');
  toast(P.cameraMode === 'Manual' ? 'Manual camera: drag to look · WASD move · Q down · Space up · Shift faster · wheel speed' : P.cameraMode === 'Follow koi' ? 'Following a koi (K for the next fish)' : P.cameraMode === 'Follow turtle' ? 'Following the turtle' : 'Cinematic camera');
}

/* ------------------------------------------------------------------ 13b. CINEMATIC PATH, DIVE EFFECTS & AUDIO */
