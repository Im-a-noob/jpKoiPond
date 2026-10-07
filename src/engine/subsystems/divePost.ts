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
import { RT, shaderPass } from "./water";
import { LENS } from "./lensDof";
import { buildLens, resizeLens, renderLens, GOD_MASK_FS, GOD_BLUR_FS } from "./lensDof";
import { POST } from "./postprocessing";
import { KOI } from "./koi";
import { FOLLOW } from "./cinematics";
import { TURTLE } from "./turtle";
import { FROG } from "./frog";
import { DRAGON } from "./dragonflies";
import { STATE } from "../state";
import { sunState } from "./lighting";
import { BLACK_TEX } from "./postprocessing";
import { waterHeightAt } from "./water";
let godMaskPass: any = null, godBlurPass: any = null;

export function buildDivePost() {
  godMaskPass = shaderPass(GOD_MASK_FS, { tColor: { value: null }, tDepth: { value: null }, uInvViewProj: { value: new THREE.Matrix4() }, uUnder: { value: 0 }, uWaterY: SH.uWaterY, uThresh: { value: 0.3 } });
  godBlurPass = shaderPass(GOD_BLUR_FS, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uDecay: { value: 0.955 }, uDensity: { value: 0.9 }, uWeight: { value: 0.06 } });
  buildLens();
  onTargetsResized4(RT.w, RT.h);
}
export function onTargetsResized4(w, h) {
  if (!godMaskPass) return;
  for (const k of ['godMask', 'godBlur']) if (POST[k]) POST[k].dispose();
  const hf = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  POST.godMask = new THREE.WebGLRenderTarget(Math.max(1, w >> 2), Math.max(1, h >> 2), hf);
  POST.godBlur = new THREE.WebGLRenderTarget(Math.max(1, w >> 2), Math.max(1, h >> 2), hf);
  resizeLens(w, h);
}
const _sv = new THREE.Vector3(), _fw = new THREE.Vector3(), _ivp = new THREE.Matrix4(), _sj = new THREE.Vector3();
// Distance the lens must focus at for a subject point, seen through the surface where the ray crosses it
// (a camera above the water focuses on the refracted image, which sits ~1/1.33 as deep)
export function focusDist(p, under) {
  const d = camera.position.distanceTo(p);
  const cy = camera.position.y, crosses = !under && p.y < WATER_Y && cy > WATER_Y;
  if (!crosses) return d;
  const k = (cy - WATER_Y) / (cy - p.y);
  return d * k + d * (1 - k) / 1.33;
}
export function lensSubject(under) {
  let best = -1, bestCos = Math.cos(9 * DEG);
  const consider = (p, maxD) => {
    _sv.subVectors(p, camera.position); const d = _sv.length(); if (d > maxD || d < 0.05) return;
    const c = _sv.dot(_fw) / d; if (c > bestCos) { bestCos = c; best = focusDist(p, under); }
  };
  if (P.cameraMode === 'Follow koi') { const f = KOI.fish[FOLLOW.idx % Math.max(1, Math.min(P.fishCount, KOI.fish.length))]; if (f) return focusDist(f.p, under); }
  if (P.cameraMode === 'Follow turtle' && TURTLE.root) return focusDist(_sj.copy(TURTLE.pos).setY(TURTLE.pos.y + 0.04), under);
  if (FROG.root) { FROG.root.getWorldPosition(_sj); _sj.y += 0.03; consider(_sj, 2.5); }
  if (TURTLE.root) consider(_sj.copy(TURTLE.pos).setY(TURTLE.pos.y + 0.04), 4);
  for (let i = 0; i < Math.min(P.fishCount, KOI.fish.length); i++) consider(KOI.fish[i].p, 5);
  for (const D of DRAGON.list) consider(D.p, 2);
  return best;
}
export function renderUnderwaterPost(color, u) {
  const high = P.quality === 'High', under = STATE.under;
  camera.getWorldDirection(_fw);
  // --- god rays
  let godStr = 0;
  if (high && P.godRays) {
    const sd = under ? SH.uSunDirW.value : SH.uSunDir.value;
    let facing = _fw.dot(sd);
    if (under && facing < 0.15) { _sv.set(0, 1, 0); facing = 0.15; } else _sv.copy(sd);   // looking away: shafts fall from straight above
    _sv.multiplyScalar(100).add(camera.position).project(camera);
    const sx = clamp(_sv.x * 0.5 + 0.5, -2, 3), sy = clamp(_sv.y * 0.5 + 0.5, -2, 3);
    godStr = under ? 1.0 : 0.28 * smoothstep(0.1, 0.6, facing) * smoothstep(3 * DEG, 20 * DEG, sunState.elev);
    if (godStr > 0.001) {
      _ivp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
      const gm = godMaskPass.uniforms;
      gm.tColor.value = RT.main.texture; gm.tDepth.value = RT.main.depthTexture; gm.uInvViewProj.value.copy(_ivp); gm.uUnder.value = under ? 1 : 0;
      gm.uThresh.value = under ? 0.22 : 0.6;
      godMaskPass.render(POST.godMask);
      const gb = godBlurPass.uniforms;
      gb.tSrc.value = POST.godMask.texture; gb.uSun.value.set(sx, sy);
      gb.uDecay.value = under ? 0.962 : 0.95; gb.uDensity.value = under ? 0.95 : 0.85; gb.uWeight.value = under ? 0.022 : 0.035;
      godBlurPass.render(POST.godBlur);
    }
  }
  u.tGod.value = godStr > 0.001 ? POST.godBlur.texture : BLACK_TEX;
  u.uGodStr.value = godStr;
  // --- camera lens: autofocus on whatever sits under the AF point; known subjects there take priority
  let out = color;
  if (P.dof) {
    const now = performance.now(), dt = LENS.lastT ? Math.min(0.1, (now - LENS.lastT) / 1000) : 0.016; LENS.lastT = now;
    out = renderLens(color, dt, under, lensSubject(under));
  }
  // --- lens: underwater distortion, droplets for 0.5 s after surfacing, meniscus when the near plane straddles the surface
  u.uUnder.value = under ? 1 : 0;
  u.uWet.value = under ? 0 : 1 - smoothstep(0, 0.5, STATE.exitT);
  const halfH = Math.tan(camera.fov * DEG / 2) * camera.near, upY = camera.up.clone().applyQuaternion(camera.quaternion).y;
  const cy = camera.position.y + _fw.y * camera.near, wh = waterHeightAt(camera.position.x, camera.position.z, SH.uTime.value);
  const vstar = Math.abs(upY) > 1e-3 ? (wh - cy) / (upY * halfH) : 9;
  const inPond = sdf(camera.position.x, camera.position.z) < 0.1;
  if (inPond && Math.abs(vstar) < 1 && !under) { u.uMeniscus.value = vstar * 0.5 + 0.5; u.uMenSide.value = upY > 0 ? 1 : -1; }
  else u.uMeniscus.value = -1;
  u.uUnderTint.value.copy(SH.uInscatter.value);
  return out;
}

