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
import { FALL_VS } from "./waterfallMesh";
import { skyUniforms, sunState } from "./lighting";
export const MOUNTAIN_FS = /* glsl */`
// === DISTANT RIDGES: forested slopes, colour pulled toward the horizon sky by distance (aerial perspective)
uniform vec3 uHaze;
uniform vec3 uForest;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uLayer;
varying vec2 vUv;
varying vec3 vWPos;
varying vec3 vN;
float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  float trees = hh(floor(vWPos.xz * 0.6 + vWPos.y * 0.3)) * 0.25 + 0.75;
  vec3 N = normalize(vN);
  vec3 lit = uForest * trees * (0.35 + 0.65 * max(dot(N, uSunDir), 0.0)) * (uSunColor * 0.25 + 0.25);
  float haze = mix(0.55, 0.82, uLayer) + 0.12 * (1.0 - vUv.y);
  gl_FragColor = vec4(mix(lit, uHaze, clamp(haze, 0.0, 0.95)), 1.0);
}`;
export function buildMountains() {
  const mats = [];
  for (let L = 0; L < 2; L++) {
    const R = 150 + L * 55, seg = 180, pos = [], uv = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, n = fbm3(Math.cos(a) * 3 + L * 7, Math.sin(a) * 3, L, 5, 17 + L);
      const ridge = 1 - Math.abs(fbm3(Math.cos(a) * 6, Math.sin(a) * 6, 2 + L, 3, 5));
      const h = Math.max(6, (34 + 62 * (n * 0.5 + 0.5) + 22 * ridge) * (0.75 + 0.45 * L)) * (0.55 + 0.45 * smoothstep(0.2, -0.5, Math.cos(a)));   // taller behind the pavilion
      const x = Math.sin(a) * R, z = Math.cos(a) * R;
      pos.push(x, -2, z, x, h, z); uv.push(i / seg, 0, i / seg, 1);
    }
    for (let i = 0; i < seg; i++) { const q = i * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.ShaderMaterial({ vertexShader: FALL_VS, fragmentShader: MOUNTAIN_FS, side: THREE.DoubleSide,
      uniforms: { uHaze: { value: new THREE.Color() }, uForest: { value: new THREE.Color(0x2c3d2a) }, uSunDir: SH.uSunDir, uSunColor: SH.uSunColor, uLayer: { value: L } } });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = -5; setLayer(mesh, LAYER.ABOVE); scene.add(mesh); mats.push(m);
  }
  WORLD.mountainMats = mats;
}
export function updateMountains() {
  if (!WORLD.mountainMats) return;
  // haze colour ~ sky near the horizon (scaled like the sky shader output)
  const b = skyUniforms.uCloudBright.value;
  for (const m of WORLD.mountainMats) m.uniforms.uHaze.value.setRGB(0.3 * b, 0.36 * b, 0.44 * b).lerp(new THREE.Color().copy(SH.uSunColor.value).multiplyScalar(0.12), 1 - smoothstep(5 * DEG, 25 * DEG, sunState.elev)).lerp(SH.uFogColor.value, clamp(SH.uFogDensity.value * 28, 0, 0.9));
}

