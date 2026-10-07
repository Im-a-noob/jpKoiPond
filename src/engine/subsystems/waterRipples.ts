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
import { RIPPLE_STATE } from "./waterSurface";

export const SIM = { N: 256, size: 13.4, x0: 0, z0: 0 };
SIM.x0 = -0.2 - SIM.size / 2; SIM.z0 = -0.02 - SIM.size / 2;
export const WAVES = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
export const DROPS = [];            // pending {x, z, r, s}
// state imported from waterSurface

export const SIM_FS = /* glsl */`
// === RIPPLE SIMULATION ===========================================================
// 2D wave equation, height in .r, vertical velocity in .g; ping-ponged 256x256 half-float.
// Drops (cursor clicks, koi at the surface) add a smooth cosine bump; the shoreline is reflective.
uniform sampler2D tPrev;
uniform sampler2D tMask;
uniform vec2 uTexel;
uniform vec4 uDrops[16];     // x, z, radius, strength (m)
uniform int uNumDrops;
uniform vec4 uSim;           // x0, z0, size, -
uniform vec4 uPads[16];      // floating pads damp the ripples beneath them
uniform int uNumPads;
varying vec2 vUv;
void main(){
  vec4 info = texture2D(tPrev, vUv);
  vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
  float avg = (texture2D(tPrev, vUv - dx).r + texture2D(tPrev, vUv + dx).r +
               texture2D(tPrev, vUv - dy).r + texture2D(tPrev, vUv + dy).r) * 0.25;
  info.g += (avg - info.r) * 1.8;   // accelerate toward the neighbour average
  info.g *= 0.986;                  // damping
  info.r += info.g;
  info.r *= 0.998;
  vec2 wp = uSim.xy + vUv * uSim.z;
  for (int i = 0; i < 16; i++) {
    if (i >= uNumDrops) break;
    vec4 d = uDrops[i];
    float f = max(0.0, 1.0 - length(wp - d.xy) / d.z);
    f = 0.5 - cos(f * 3.14159265) * 0.5;
    info.r += f * d.w;
  }
  for (int i = 0; i < 16; i++) {
    if (i >= uNumPads) break;
    float pd = length(wp - uPads[i].xy) / uPads[i].z;
    info.rg *= mix(0.55, 1.0, smoothstep(0.7, 1.05, pd));
  }
  float sd = texture2D(tMask, vUv).r * 4.0 - 2.0;
  if (sd > 0.0) info.rg = vec2(0.0);
  gl_FragColor = info;
}`;


export function addDrop(x, z, r, s) { if (DROPS.length < 16) DROPS.push({ x, z, r, s }); }
let simTime = 0;
export function stepRipples(dt) {
  if (!RIPPLE_STATE.simPass || !RIPPLE_STATE.simA) return;
  simTime += dt;
  let steps = 0;
  while (simTime > 1 / 60 && steps < 3) {
    simTime -= 1 / 60; steps++;
    const u = RIPPLE_STATE.simPass.uniforms;
    u.tPrev.value = RIPPLE_STATE.simA.texture;
    u.uNumDrops.value = DROPS.length;
    DROPS.forEach((d, i) => u.uDrops.value[i].set(d.x, d.z, d.r, d.s));
    DROPS.length = 0;
    const pads = WORLD.lilies || [];
    u.uNumPads.value = Math.min(16, pads.length);
    for (let i = 0; i < u.uNumPads.value; i++) u.uPads.value[i].set(pads[i].mesh.position.x, pads[i].mesh.position.z, pads[i].r, 0);
    RIPPLE_STATE.simPass.render(RIPPLE_STATE.simB);
    const t = RIPPLE_STATE.simA; RIPPLE_STATE.simA = RIPPLE_STATE.simB; RIPPLE_STATE.simB = t;
  }
  if (simTime > 0.2) simTime = 0;
  if (RIPPLE_STATE.waterMat && RIPPLE_STATE.simA) {
    RIPPLE_STATE.waterMat.uniforms.tRipple.value = RIPPLE_STATE.simA.texture;
    SH.tRippleS.value = RIPPLE_STATE.simA.texture;
  }
}

/* --- Render targets & water passes */
