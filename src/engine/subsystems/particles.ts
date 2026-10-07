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
import { STATE, RT } from "../state";
import { sunState } from "./lighting";
export const PARTICLE_VS = /* glsl */`
// === UNDERWATER PARTICLES: slow drift, wrapped around the camera, size-attenuated
attribute vec3 aSeed;
uniform vec3 uCam;
uniform float uTime;
uniform float uBox;
uniform float uScale;
uniform float uWaterY;
varying float vA;
varying float vD;
void main(){
  vec3 p = aSeed * uBox + vec3(sin(uTime * 0.11 + aSeed.y * 20.0) * 0.12, uTime * 0.01 * (0.5 + aSeed.z), cos(uTime * 0.09 + aSeed.x * 17.0) * 0.12);
  p = uCam + mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z; vD = d;
  gl_PointSize = min(uScale * (0.4 + aSeed.x * 0.8) / max(d, 0.05), 5.0);
  vA = step(p.y, uWaterY - 0.01) * smoothstep(uBox * 0.5, uBox * 0.25, d) * smoothstep(0.3, 0.8, d);
}`;
export const PARTICLE_FS = /* glsl */`
uniform vec3 uColor;
uniform vec3 uAbsorb;
varying float vA;
varying float vD;
void main(){
  vec2 q = gl_PointCoord - 0.5; float r = dot(q, q);
  if (r > 0.25 || vA < 0.01) discard;
  float a = smoothstep(0.25, 0.0, r) * vA * 0.3;
  gl_FragColor = vec4(uColor * exp(-uAbsorb * vD), a);
}`;
let particles;
export function buildParticles() {
  const N = 1600, seeds = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) seeds[i] = rand();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  const m = new THREE.ShaderMaterial({ vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uCam: { value: new THREE.Vector3() }, uTime: SH.uTime, uBox: { value: 6 }, uScale: { value: 6 }, uWaterY: SH.uWaterY, uColor: { value: new THREE.Color() }, uAbsorb: SH.uAbsorb } });
  particles = new THREE.Points(g, m); particles.frustumCulled = false; particles.renderOrder = 5;
  setLayer(particles, LAYER.UNDER); scene.add(particles);
}
export function updateParticles() {
  if (!particles) return;
  particles.visible = STATE.under;
  const u = particles.material.uniforms;
  u.uCam.value.copy(camera.position);
  u.uScale.value = 0.005 * RT.h / (2 * Math.tan(camera.fov * DEG / 2));
  u.uColor.value.copy(SH.uInscatter.value).multiplyScalar(4).add(new THREE.Color(0.02, 0.025, 0.02).multiplyScalar(sunState.intensity));
}

/* --- God rays (radial blur from the sun's screen position) and depth of field */
