// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets } from "../geometry";
import { $, progress, toast } from "../state";
import { shaderPass } from "./water";
import { camera, SH } from "./lighting";
import { RT } from "../state";
import { onTargetsResized4, renderUnderwaterPost } from "./divePost";
import { FEED } from "./handMesh";
import { TWEEN, MOVIE } from "./cinematics";
/* ------------------------------------------------------------------ 12. POST-PROCESSING */
// Pipeline: main HDR (MSAA) -> [SSAO half-res + blur] -> [bloom prefilter + 5-level mip chain]
//           -> [god rays, DOF when submerged] -> composite (exposure, ACES, grade, vignette, grain, lens FX)
export const SSAO_FS = /* glsl */`
// === SSAO: normal-oriented hemisphere samples reconstructed from the depth buffer (half resolution)
#include <packing>
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uIntensity;
uniform vec3 uKernel[12];
varying vec2 vUv;
vec3 viewPos(vec2 uv){
  float d = texture2D(tDepth, uv).r;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  float d = texture2D(tDepth, vUv).r;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  // normal from the smaller of the forward/backward depth differences (robust at silhouettes)
  vec3 pr = viewPos(vUv + vec2(uTexel.x, 0.0)) - P, pl = P - viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, uTexel.y)) - P, pd = P - viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z) < abs(pl.z) ? pr : pl, dy = abs(pu.z) < abs(pd.z) ? pu : pd;
  vec3 N = normalize(cross(dx, dy));
  float a = h12(gl_FragCoord.xy) * 6.2831853;
  vec3 rv = vec3(cos(a), sin(a), 0.0);
  vec3 T = normalize(rv - N * dot(rv, N)), B = cross(N, T);
  mat3 tbn = mat3(T, B, N);
  float radius = uRadius * clamp(-P.z * 0.08, 0.35, 1.6);   // grow with distance a little
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    vec3 S = P + tbn * uKernel[i] * radius;
    vec4 c = uProj * vec4(S, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    float sz = viewPos(suv).z;
    float range = smoothstep(0.0, 1.0, radius / abs(P.z - sz));
    occ += (sz >= S.z + 0.015 * radius ? 1.0 : 0.0) * range;
  }
  gl_FragColor = vec4(vec3(clamp(1.0 - occ / 12.0 * uIntensity, 0.0, 1.0)), 1.0);
}`;
export const BLUR4_FS = /* glsl */`
// === 4x4 box blur (removes the SSAO rotation noise)
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main(){
  float s = 0.0;
  for (int x = -2; x < 2; x++) for (int y = -2; y < 2; y++) s += texture2D(tSrc, vUv + (vec2(x, y) + 0.5) * uTexel).r;
  gl_FragColor = vec4(vec3(s / 16.0), 1.0);
}`;
export const BLOOM_PRE_FS = /* glsl */`
// === BLOOM prefilter: soft-knee threshold on exposed colour, firefly clamp
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uExpo;
varying vec2 vUv;
void main(){
  vec3 c = (texture2D(tSrc, vUv + vec2(-0.5, -0.5) * uTexel).rgb + texture2D(tSrc, vUv + vec2(0.5, -0.5) * uTexel).rgb +
            texture2D(tSrc, vUv + vec2(-0.5, 0.5) * uTexel).rgb + texture2D(tSrc, vUv + vec2(0.5, 0.5) * uTexel).rgb) * 0.25 * uExpo;
  c = min(c, vec3(40.0));
  float br = max(c.r, max(c.g, c.b)), knee = uThreshold * 0.5;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee); soft = soft * soft / (4.0 * knee + 1e-4);
  gl_FragColor = vec4(c * max(soft, br - uThreshold) / max(br, 1e-4), 1.0);
}`;
export const BLOOM_DOWN_FS = /* glsl */`
// === BLOOM downsample: 13-tap (Jimenez) filter
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 t(vec2 o){ return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main(){
  vec3 c = t(vec2(0.0)) * 0.125;
  c += (t(vec2(-1.0, -1.0)) + t(vec2(1.0, -1.0)) + t(vec2(-1.0, 1.0)) + t(vec2(1.0, 1.0))) * 0.125;
  c += (t(vec2(-2.0, -2.0)) + t(vec2(2.0, -2.0)) + t(vec2(-2.0, 2.0)) + t(vec2(2.0, 2.0))) * 0.03125;
  c += (t(vec2(-2.0, 0.0)) + t(vec2(2.0, 0.0)) + t(vec2(0.0, -2.0)) + t(vec2(0.0, 2.0))) * 0.0625;
  gl_FragColor = vec4(c, 1.0);
}`;
export const BLOOM_UP_FS = /* glsl */`
// === BLOOM upsample: 9-tap tent on the smaller mip, added to the current level
uniform sampler2D tSrc;
uniform sampler2D tCur;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 t(vec2 o){ return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main(){
  vec3 c = t(vec2(0.0)) * 4.0;
  c += (t(vec2(-1.0, 0.0)) + t(vec2(1.0, 0.0)) + t(vec2(0.0, -1.0)) + t(vec2(0.0, 1.0))) * 2.0;
  c += t(vec2(-1.0, -1.0)) + t(vec2(1.0, -1.0)) + t(vec2(-1.0, 1.0)) + t(vec2(1.0, 1.0));
  gl_FragColor = vec4(texture2D(tCur, vUv).rgb + c / 16.0, 1.0);
}`;
export const COMPOSITE_FS = /* glsl */`
// === FINAL COMPOSITE: AO, bloom, god rays, underwater lens + wet-lens droplets, exposure, ACES filmic,
//     restrained warm grade, vignette, film grain, sRGB out
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tAO;
uniform sampler2D tGod;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uBloom;
uniform float uAOStr;
uniform float uGodStr;
uniform float uUnder;
uniform float uWet;
uniform float uAspect;
uniform float uMeniscus;   // screen-space y of the waterline when the near plane straddles the surface (-1 = none)
uniform float uMenSide;    // which side of the meniscus is submerged (+1 below the line)
uniform vec3 uUnderTint;
uniform vec2 uTexel;
uniform float uSharp;
uniform vec3 uGrade;
uniform float uFade;
uniform float uLetter;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 acesFilmic(vec3 c){
  const mat3 IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(OUT * RRTAndODTFit(IN * c), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// Water droplets on the lens after surfacing: lens-shaped bumps that refract the image and slowly slide
vec2 droplets(vec2 uv, out float mask){
  vec2 p = uv * vec2(uAspect, 1.0) * 8.0;
  p.y += uTime * 0.05;
  vec2 i = floor(p), f = fract(p), off = vec2(0.0);
  mask = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 n = vec2(x, y), c = h22(i + n);
    float r = 0.12 + 0.3 * h12(i + n + 7.1);
    if (h12(i + n + 3.7) < 0.25) continue;
    vec2 d = n + c - f;
    float l = length(d);
    if (l < r) { float h = sqrt(1.0 - (l * l) / (r * r)); off -= d * h * 0.07; mask = max(mask, smoothstep(r, r * 0.6, l)); }
  }
  return off;
}
void main(){
  vec2 uv = vUv;
  if (uUnder > 0.5) {                                // underwater: slight barrel distortion + refractive shimmer
    vec2 q = uv - 0.5; float r2 = dot(q, q);
    uv = 0.5 + q * (1.0 - 0.07 * r2) + 0.0014 * vec2(sin(uTime * 1.3 + uv.y * 11.0), cos(uTime * 1.1 + uv.x * 9.0));
  }
  float wm = 0.0;
  if (uWet > 0.001) uv += droplets(uv, wm) * uWet;
  vec3 c = texture2D(tColor, uv).rgb;
  if (uSharp > 0.0) {
    // limited unsharp mask: recovers the crispness lost to the render-scale upsample without ringing halos
    vec3 n = texture2D(tColor, uv + vec2(0.0, uTexel.y)).rgb, s2 = texture2D(tColor, uv - vec2(0.0, uTexel.y)).rgb;
    vec3 e = texture2D(tColor, uv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tColor, uv - vec2(uTexel.x, 0.0)).rgb;
    vec3 mn = min(c, min(min(n, s2), min(e, w))), mx = max(c, max(max(n, s2), max(e, w)));
    c = clamp(c + (c - (n + s2 + e + w) * 0.25) * uSharp * 1.6, mn, mx);
  }
  c *= mix(1.0, texture2D(tAO, uv).r, uAOStr);
  c += texture2D(tBloom, uv).rgb * uBloom;
  c += texture2D(tGod, uv).rgb * uGodStr;
  c = mix(c, c * 1.18 + 0.02, wm * uWet * 0.7);
  // near plane straddling the surface: tint the submerged part of the frame and draw a soft meniscus line
  if (uMeniscus > -0.5) {
    float sideV = (uv.y - uMeniscus) * -uMenSide;
    c = mix(c, c * uUnderTint * 3.0 + uUnderTint * 0.2, smoothstep(0.0, 0.01, sideV) * 0.8);
    c *= 1.0 - 0.55 * exp(-abs(uv.y - uMeniscus) * 180.0);
  }
  c *= uExposure / 0.6;
  c *= uGrade;                                        // white balance / grade set by the weather
  c *= 1.0 - uFade;                                   // cinematic cut: dip to black
  c = acesFilmic(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 0.95);                         // keep saturation realistic
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.2, 0.85, length(q * vec2(uAspect * 0.75, 1.0)) * 1.2);
  c = toSRGB(c);
  c += (h12(gl_FragCoord.xy + fract(uTime * 13.7) * 311.0) - 0.5) * uGrain * 2.0;
  if (abs(vUv.y - 0.5) > 0.5 - uLetter) c = vec3(0.0);  // letterbox bars in the movie tour
  gl_FragColor = vec4(c, 1.0);
}`;
export const POST = { bloomMips: [] };
export let compositePass, ssaoPass, blurPass, bloomPrePass, bloomDownPass, bloomUpPass;
export const WHITE_TEX = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); WHITE_TEX.needsUpdate = true;
export const BLACK_TEX = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); BLACK_TEX.needsUpdate = true;
export function buildPost() {
  const kernel = [];
  for (let i = 0; i < 12; i++) {
    const v = new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(0.15, 1)).normalize();
    const s = lerp(0.15, 1, Math.pow(i / 12, 2)); kernel.push(v.multiplyScalar(s * rr(0.6, 1)));
  }
  ssaoPass = shaderPass(SSAO_FS, { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.35 }, uIntensity: { value: 1.35 }, uKernel: { value: kernel } });
  blurPass = shaderPass(BLUR4_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  bloomPrePass = shaderPass(BLOOM_PRE_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.9 }, uExpo: { value: 1 } });
  bloomDownPass = shaderPass(BLOOM_DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  bloomUpPass = shaderPass(BLOOM_UP_FS, { tSrc: { value: null }, tCur: { value: null }, uTexel: { value: new THREE.Vector2() } });
  compositePass = shaderPass(COMPOSITE_FS, {
    tColor: { value: null }, tBloom: { value: BLACK_TEX }, tAO: { value: WHITE_TEX }, tGod: { value: BLACK_TEX },
    uExposure: { value: P.exposure }, uVignette: { value: P.vignette }, uGrain: { value: P.grain }, uTime: SH.uTime,
    uBloom: { value: P.bloomStrength }, uAOStr: { value: 0.85 }, uGodStr: { value: 0 }, uUnder: { value: 0 }, uWet: { value: 0 },
    uAspect: { value: 1 }, uTexel: { value: new THREE.Vector2() }, uSharp: { value: 0.35 }, uGrade: { value: new THREE.Vector3(1.035, 1, 0.955) }, uFade: { value: 0 }, uLetter: { value: 0 }, uMeniscus: { value: -1 }, uMenSide: { value: 1 }, uUnderTint: { value: new THREE.Color() },
  });
  onTargetsResized(RT.w, RT.h);
}
export function onTargetsResized(w, h) {
  if (!compositePass) return;
  const hf = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  for (const k of ['ao', 'aoBlur']) if (POST[k]) POST[k].dispose();
  for (const m of POST.bloomMips) m.dispose();
  const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
  POST.ao = new THREE.WebGLRenderTarget(hw, hh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  POST.aoBlur = new THREE.WebGLRenderTarget(hw, hh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  POST.bloomMips = [];
  for (let i = 0; i < 6; i++) POST.bloomMips.push(new THREE.WebGLRenderTarget(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)), hf));
  POST.bloomUp = [];
  for (let i = 0; i < 5; i++) POST.bloomUp.push(new THREE.WebGLRenderTarget(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)), hf));
  if (typeof onTargetsResized4 === 'function') onTargetsResized4(w, h);
}
export function renderBloom(src) {
  const m = POST.bloomMips;
  bloomPrePass.uniforms.tSrc.value = src; bloomPrePass.uniforms.uTexel.value.set(1 / RT.w, 1 / RT.h);
  bloomPrePass.uniforms.uThreshold.value = P.bloomThreshold; bloomPrePass.uniforms.uExpo.value = P.exposure / 0.6;
  bloomPrePass.render(m[0]);
  for (let i = 1; i < m.length; i++) {
    bloomDownPass.uniforms.tSrc.value = m[i - 1].texture; bloomDownPass.uniforms.uTexel.value.set(1 / m[i - 1].width, 1 / m[i - 1].height);
    bloomDownPass.render(m[i]);
  }
  let low = m[m.length - 1].texture;
  for (let i = m.length - 2; i >= 0; i--) {
    const up = POST.bloomUp[i];
    bloomUpPass.uniforms.tSrc.value = low; bloomUpPass.uniforms.tCur.value = m[i].texture;
    bloomUpPass.uniforms.uTexel.value.set(1 / m[i + 1].width, 1 / m[i + 1].height);
    bloomUpPass.render(up); low = up.texture;
  }
  return low;
}
export function renderSSAO() {
  if (!RT.main || !RT.main.depthTexture || !POST.ao || !POST.aoBlur) return WHITE_TEX;
  const u = ssaoPass.uniforms;
  u.tDepth.value = RT.main.depthTexture;
  u.uProj.value.copy(camera.projectionMatrix); u.uInvProj.value.copy(camera.projectionMatrixInverse);
  u.uTexel.value.set(1 / POST.ao.width, 1 / POST.ao.height);
  ssaoPass.render(POST.ao);
  blurPass.uniforms.tSrc.value = POST.ao.texture; blurPass.uniforms.uTexel.value.set(1 / POST.ao.width, 1 / POST.ao.height);
  blurPass.render(POST.aoBlur);
  return POST.aoBlur.texture;
}
export function renderPost() {
  if (!RT.main || !RT.main.texture) return;
  const high = P.quality === 'High';
  const u = compositePass.uniforms;
  let color = RT.main.texture;
  if (typeof renderUnderwaterPost === 'function') color = renderUnderwaterPost(color, u);
  u.tColor.value = color;
  u.tAO.value = high && P.ssao ? renderSSAO() : WHITE_TEX;
  u.tBloom.value = P.bloomStrength > 0 ? renderBloom(RT.main.texture) : BLACK_TEX;
  u.uExposure.value = P.exposure; u.uVignette.value = P.vignette; u.uGrain.value = P.grain; u.uBloom.value = P.bloomStrength / 5;
  u.uAspect.value = RT.w / RT.h; u.uTexel.value.set(1 / RT.w, 1 / RT.h); u.uSharp.value = P.sharpen;
  const film = P.cameraMode === 'Cinematic' && P.movie && !P.holdCamera && !FEED.active && TWEEN.t >= 1;
  u.uFade.value = film ? MOVIE.fade : 0;
  u.uLetter.value = film && P.letterbox ? Math.max(0, (1 - (RT.w / RT.h) / 2.0) / 2) : 0;
  const cap = document.getElementById('caption'); if (cap && !film) cap.style.opacity = '0';
  compositePass.render(null);
}

