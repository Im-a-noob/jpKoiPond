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
export * from "./waterPasses";
export * from "./waterRipples";
export * from "./waterSurface";

export const FSQ_VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const fsQuadGeo = new THREE.PlaneGeometry(2, 2);
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
class FSPass {
  constructor(material) { this.mesh = new THREE.Mesh(fsQuadGeo, material); this.mesh.frustumCulled = false; this.scene = new THREE.Scene(); this.scene.add(this.mesh); }
  get uniforms() { return this.mesh.material.uniforms; }
  render(target) { renderer.setRenderTarget(target); renderer.render(this.scene, fsCam); }
}
export function shaderPass(fs, uniforms, defines = {}) {
  return new FSPass(new THREE.ShaderMaterial({ vertexShader: FSQ_VS, fragmentShader: fs, uniforms, defines, depthTest: false, depthWrite: false }));
}

// Ripple simulation domain (square so ripples stay circular); pond mask encodes the SDF in [-2, 2] m
