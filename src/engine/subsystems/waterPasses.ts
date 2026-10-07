// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG, mulberry32, fbm2P, mix3, srgbHex, hash3i } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets, SDFK, instanced } from "../geometry";
import { $, progress, toast, RT } from "../state";
import { canvasTex, dataTex, heightToNormal, makeCanvas, TEX } from "./textures";
import { physical, seasonal } from "./materials";
import { scene, camera, renderer, SH } from "./lighting";
import { WORLD, sdf, groundHeight } from "./terrain";
import { onTargetsResized } from "./postprocessing";
import { skyUniforms, CLIP_KEEP_BELOW, CLIP_KEEP_ABOVE, CLIP_NONE } from "./lighting";
import { KOI } from "./koi";
import { water } from "./waterSurface";
export { RT };
export const reflCam = new THREE.PerspectiveCamera(), refrCam = new THREE.PerspectiveCamera();
export const shadowCam = new THREE.PerspectiveCamera(1, 1, 0.01, 0.02); shadowCam.position.set(0, -2000, 0); shadowCam.layers.enableAll(); shadowCam.updateMatrixWorld();
export const reflMatrix = new THREE.Matrix4();
export function makeTargets() {
  for (const k in RT) if (RT[k] && RT[k].dispose) RT[k].dispose();
  const pr = renderer.getPixelRatio(), w = Math.max(2, Math.floor((typeof window !== "undefined" ? window.innerWidth : 800) * pr)), h = Math.max(2, Math.floor((typeof window !== "undefined" ? window.innerHeight : 600) * pr));
  const div = P.quality === 'High' ? 2 : 4;
  const hf = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  RT.w = w; RT.h = h;
  RT.refl = new THREE.WebGLRenderTarget(Math.ceil(w / div), Math.ceil(h / div), Object.assign({}, hf, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter }));
  // the view into the water is most of the picture: full resolution (and multisampled on High) so koi, stems and
  // stones stay crisp instead of being upscaled into soft, stair-stepped edges
  RT.refr = new THREE.WebGLRenderTarget(w, h, Object.assign({ samples: 2, depthTexture: new THREE.DepthTexture(w, h) }, hf));
  // Low keeps anti-aliasing too (2x): an aliased frame reads as low quality far more than a few ms cost
  RT.main = new THREE.WebGLRenderTarget(w, h, Object.assign({ samples: P.quality === 'High' ? 4 : 2, depthTexture: new THREE.DepthTexture(w, h) }, hf));
  RT.tiny = new THREE.WebGLRenderTarget(1, 1);
  if (typeof onTargetsResized === 'function') onTargetsResized(w, h);
}
const _cp = new THREE.Vector3(), _rp = new THREE.Vector3(), _rv = new THREE.Vector3(), _look = new THREE.Vector3(), _tgt = new THREE.Vector3(), _rm = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
// Mirror a camera about the water plane (as in three's Reflector) and build the projective texture matrix
export function mirrorCamera(cam, out) {
  _cp.setFromMatrixPosition(cam.matrixWorld);
  _rm.extractRotation(cam.matrixWorld);
  _rp.set(_cp.x, WATER_Y, _cp.z);
  _rv.subVectors(_rp, _cp).reflect(_up).negate().add(_rp);
  _look.set(0, 0, -1).applyMatrix4(_rm).add(_cp);
  _tgt.subVectors(_rp, _look).reflect(_up).negate().add(_rp);
  out.position.copy(_rv);
  out.up.set(0, 1, 0).applyMatrix4(_rm).reflect(_up);
  out.lookAt(_tgt);
  out.fov = cam.fov; out.aspect = cam.aspect; out.near = cam.near; out.far = cam.far;
  out.updateProjectionMatrix(); out.updateMatrixWorld();
  reflMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(out.projectionMatrix).multiply(out.matrixWorldInverse);
}
export function setCamLayers(cam, list) { cam.layers.disableAll(); cam.layers.enable(0); for (const l of list) cam.layers.enable(l); }

export function renderWaterPasses(under) {
  water.visible = false;
  skyUniforms.uSunDisk.value = 0;                           // the sun glint is analytic (GGX) in the water shader
  // Reflection: mirrored camera, clip plane at the water level
  mirrorCamera(camera, reflCam);
  setCamLayers(reflCam, under ? [LAYER.UNDER, LAYER.BOTH] : [LAYER.ABOVE, LAYER.BOTH, LAYER.SKY]);
  renderer.clippingPlanes = [under ? CLIP_KEEP_BELOW : CLIP_KEEP_ABOVE];
  SH.uCamUnder.value = under ? 1 : 0;
  renderer.setClearColor(under ? SH.uInscatter.value : 0x000000, 1);
  // koi only ever break the surface by a few cm; mirroring those backs reads as a doubled fish, so above water they stay out
  const hideKoi = !under && KOI.body; if (hideKoi) KOI.body.visible = KOI.fins.visible = KOI.eyes.visible = false;
  if (!under) for (const o of WORLD.noReflect) o.visible = false;
  renderer.setRenderTarget(RT.refl); renderer.clear(); renderer.render(scene, reflCam);
  if (hideKoi) KOI.body.visible = KOI.fins.visible = KOI.eyes.visible = true;
  if (!under) for (const o of WORLD.noReflect) o.visible = true;
  // Refraction: the far side of the surface as seen by the real camera (+ its depth)
  refrCam.position.copy(camera.position); refrCam.quaternion.copy(camera.quaternion);
  refrCam.fov = camera.fov; refrCam.aspect = camera.aspect; refrCam.near = camera.near; refrCam.far = camera.far;
  refrCam.updateProjectionMatrix(); refrCam.updateMatrixWorld();
  setCamLayers(refrCam, under ? [LAYER.ABOVE, LAYER.BOTH, LAYER.SKY] : [LAYER.UNDER, LAYER.BOTH]);
  renderer.clippingPlanes = [under ? CLIP_KEEP_ABOVE : CLIP_KEEP_BELOW];
  SH.uCamUnder.value = 0;
  renderer.setClearColor(0x000000, 1);
  renderer.setRenderTarget(RT.refr); renderer.clear(); renderer.render(scene, refrCam);
  renderer.clippingPlanes = [CLIP_NONE];
  skyUniforms.uSunDisk.value = 1;
  water.visible = true;
}

