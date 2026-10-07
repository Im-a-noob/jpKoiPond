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
import { focusDist, lensSubject } from "./divePost";

export const GOD_MASK_FS = /* glsl */`
// === GOD RAYS mask: bright sky (above) or the bright surface / Snell's window (below)
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uInvViewProj;
uniform float uUnder;
uniform float uWaterY;
uniform float uThresh;
varying vec2 vUv;
void main(){
  float d = texture2D(tDepth, vUv).r;
  vec3 c = texture2D(tColor, vUv).rgb;
  float m;
  if (uUnder > 0.5) {
    vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); wp.xyz /= wp.w;
    m = 1.0 - smoothstep(0.04, 0.14, abs(wp.y - uWaterY));
  } else m = step(0.99999, d);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(min(c, vec3(4.0)) * m * smoothstep(uThresh, uThresh * 3.0, l), 1.0);
}`;
export const GOD_BLUR_FS = /* glsl */`
// === GOD RAYS: radial blur toward the light (GPU Gems 3, ch. 13)
uniform sampler2D tSrc;
uniform vec2 uSun;
uniform float uDecay;
uniform float uDensity;
uniform float uWeight;
varying vec2 vUv;
void main(){
  vec2 uv = vUv, delta = (uv - uSun) * uDensity / 48.0;
  float illum = 1.0; vec3 acc = vec3(0.0);
  for (int i = 0; i < 48; i++) {
    uv -= delta;
    acc += texture2D(tSrc, clamp(uv, 0.001, 0.999)).rgb * illum * uWeight;
    illum *= uDecay;
  }
  gl_FragColor = vec4(acc, 1.0);
}`;
// === CAMERA LENS: physically based depth of field (thin lens, full-frame sensor, focal length from the FOV) with a
// GPU autofocus that racks focus smoothly in dioptres. Pipeline: half-res prefilter (colour + signed CoC) ->
// 43-tap disc bokeh gather with separate near / far fields -> 9-tap tent -> full-res combine that keeps
// in-focus pixels at native sharpness (no stair-stepped halos around edges).
export const DOF_COMMON = /* glsl */`
#include <packing>
uniform sampler2D tDepth;
uniform sampler2D tFocus;
uniform float uNear;
uniform float uFar;
uniform float uFL;        // focal length (m)
uniform float uFN;        // f-number
uniform float uMaxCoc;    // max CoC radius, fraction of image height
float linZ(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).r, uNear, uFar); }
float cocOf(float z, float F){
  // thin lens: blur-circle diameter on a 24 mm-high sensor, as a radius in image-height units; + far, - near
  float c = uFL * uFL / (uFN * max(F - uFL, 1e-3)) * (z - F) / max(z, 1e-3) / 0.024 * 0.5;
  return clamp(c, -uMaxCoc, uMaxCoc);
}
`;
export const DOF_FOCUS_FS = /* glsl */`
#include <packing>
uniform sampler2D tDepth;
uniform sampler2D tPrev;
uniform float uNear;
uniform float uFar;
uniform float uSubject;   // > 0: a known subject under the AF point (m)
uniform float uRate;      // 1 - exp(-dt * speed)
uniform float uAspect;
varying vec2 vUv;
float linZ(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).r, uNear, uFar); }
void main(){
  float target = uSubject;
  if (target <= 0.0) {
    // AF area: 13 points around the centre, weighted toward the nearest surfaces like a camera's closest-subject AF
    float ws = 0.0, zs = 0.0;
    for (int i = 0; i < 13; i++) {
      float a = float(i) * 2.39996, r = sqrt(float(i) / 13.0) * 0.045;
      float z = min(linZ(vec2(0.5) + vec2(cos(a) * r / uAspect, sin(a) * r)), 80.0);
      float w = 1.0 / (z * z + 0.01);
      zs += z * w; ws += w;
    }
    target = zs / ws;
  }
  target = clamp(target, 0.12, 80.0);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  if (prev <= 0.0) prev = target;
  float d = mix(1.0 / prev, 1.0 / target, uRate);          // a focus motor moves in dioptres
  gl_FragColor = vec4(1.0 / d, 0.0, 0.0, 1.0);
}`;
export const DOF_PRE_FS = DOF_COMMON + /* glsl */`
uniform sampler2D tColor;
uniform vec2 uTexel;      // full-res texel
varying vec2 vUv;
void main(){
  float F = texture2D(tFocus, vec2(0.5)).r;
  vec2 o = uTexel * 0.5;
  vec2 u0 = vUv + vec2(-o.x, -o.y), u1 = vUv + vec2(o.x, -o.y), u2 = vUv + vec2(-o.x, o.y), u3 = vUv + vec2(o.x, o.y);
  vec3 c0 = texture2D(tColor, u0).rgb, c1 = texture2D(tColor, u1).rgb, c2 = texture2D(tColor, u2).rgb, c3 = texture2D(tColor, u3).rgb;
  float k0 = cocOf(linZ(u0), F), k1 = cocOf(linZ(u1), F), k2 = cocOf(linZ(u2), F), k3 = cocOf(linZ(u3), F);
  float cmin = min(min(k0, k1), min(k2, k3)), cmax = max(max(k0, k1), max(k2, k3));
  float coc = (-cmin > cmax) ? cmin : cmax;
  // luma-weighted average tames fireflies so bright speculars bloom into round bokeh instead of flicker
  float w0 = 1.0 / (1.0 + max(c0.r, max(c0.g, c0.b))), w1 = 1.0 / (1.0 + max(c1.r, max(c1.g, c1.b))),
        w2 = 1.0 / (1.0 + max(c2.r, max(c2.g, c2.b))), w3 = 1.0 / (1.0 + max(c3.r, max(c3.g, c3.b)));
  vec3 c = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3) / (w0 + w1 + w2 + w3);
  gl_FragColor = vec4(c, coc);
}`;
export const DOF_BOKEH_FS = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uKernel[43];
uniform float uMaxCoc;
uniform float uAspect;
uniform vec2 uTexelH;     // half-res texel
varying vec2 vUv;
void main(){
  vec4 s0 = texture2D(tSrc, vUv);
  vec4 bg = vec4(0.0), fg = vec4(0.0);
  float margin = uTexelH.y * 2.0;
  for (int i = 0; i < 43; i++) {
    vec2 k = uKernel[i] * uMaxCoc; float dist = length(k);
    vec4 s = texture2D(tSrc, vUv + vec2(k.x / uAspect, k.y));
    float bw = clamp((max(min(s0.a, s.a), 0.0) - dist + margin) / margin, 0.0, 1.0);   // background never bleeds over a sharper pixel
    float fw = clamp((-s.a - dist + margin) / margin, 0.0, 1.0) * step(uTexelH.y, -s.a); // near blur spreads over what is behind it
    bg += vec4(s.rgb, 1.0) * bw; fg += vec4(s.rgb, 1.0) * fw;
  }
  bg.rgb /= bg.a + (bg.a == 0.0 ? 1.0 : 0.0);
  fg.rgb /= fg.a + (fg.a == 0.0 ? 1.0 : 0.0);
  float fa = clamp(fg.a * 3.14159265 / 43.0, 0.0, 1.0);
  vec3 bgc = bg.a > 0.0 ? bg.rgb : s0.rgb;
  gl_FragColor = vec4(mix(bgc, fg.rgb, fa), fa);
}`;
export const DOF_TENT_FS = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexelH;
varying vec2 vUv;
void main(){
  vec4 d = uTexelH.xyxy * vec4(-0.5, -0.5, 0.5, 0.5);
  gl_FragColor = 0.25 * (texture2D(tSrc, vUv + d.xy) + texture2D(tSrc, vUv + d.zy) + texture2D(tSrc, vUv + d.xw) + texture2D(tSrc, vUv + d.zw));
}`;
export const DOF_COMBINE_FS = DOF_COMMON + /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDof;
uniform vec2 uTexel;
varying vec2 vUv;
void main(){
  float F = texture2D(tFocus, vec2(0.5)).r;
  float coc = cocOf(linZ(vUv), F);
  vec4 dof = texture2D(tDof, vUv);
  float ffa = smoothstep(uTexel.y * 2.0, uTexel.y * 4.0, coc);      // far field: blurred only once the circle is visibly bigger than a pixel
  vec3 src = texture2D(tColor, vUv).rgb;
  gl_FragColor = vec4(mix(src, dof.rgb, ffa + dof.a - ffa * dof.a), 1.0);
}`;
export const LENS = { focusIdx: 0, kernel: [], subject: -1 };
export function buildLens() {
  // concentric-ring disc kernel: 1 + 7 + 14 + 21 samples
  LENS.kernel.push(new THREE.Vector2(0, 0));
  for (let ring = 1; ring <= 3; ring++) for (let i = 0; i < ring * 7; i++) {
    const a = (i / (ring * 7)) * Math.PI * 2 + ring * 0.3, r = ring / 3;
    LENS.kernel.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const common = () => ({ tDepth: { value: null }, tFocus: { value: null }, uNear: { value: 0.05 }, uFar: { value: 500 }, uFL: { value: 0.025 }, uFN: { value: 2.8 }, uMaxCoc: { value: 0.018 } });
  LENS.focusPass = shaderPass(DOF_FOCUS_FS, { tDepth: { value: null }, tPrev: { value: null }, uNear: { value: 0.05 }, uFar: { value: 500 }, uSubject: { value: -1 }, uRate: { value: 0.1 }, uAspect: { value: 1 } });
  LENS.prePass = shaderPass(DOF_PRE_FS, Object.assign(common(), { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } }));
  LENS.bokehPass = shaderPass(DOF_BOKEH_FS, { tSrc: { value: null }, uKernel: { value: LENS.kernel }, uMaxCoc: { value: 0.018 }, uAspect: { value: 1 }, uTexelH: { value: new THREE.Vector2() } });
  LENS.tentPass = shaderPass(DOF_TENT_FS, { tSrc: { value: null }, uTexelH: { value: new THREE.Vector2() } });
  LENS.combinePass = shaderPass(DOF_COMBINE_FS, Object.assign(common(), { tColor: { value: null }, tDof: { value: null }, uTexel: { value: new THREE.Vector2() } }));
  const f1 = { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
  LENS.focusRT = [new THREE.WebGLRenderTarget(1, 1, f1), new THREE.WebGLRenderTarget(1, 1, f1)];
}
export function resizeLens(w, h) {
  if (!LENS.prePass) return;
  for (const k of ['pre', 'bokeh', 'tent', 'out']) if (LENS[k]) LENS[k].dispose();
  const hf = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
  LENS.pre = new THREE.WebGLRenderTarget(hw, hh, hf); LENS.bokeh = new THREE.WebGLRenderTarget(hw, hh, hf); LENS.tent = new THREE.WebGLRenderTarget(hw, hh, hf);
  LENS.out = new THREE.WebGLRenderTarget(w, h, hf);
}
export function renderLens(color, dt, under, subject) {
  if (!LENS.out || LENS.out.width !== RT.w || LENS.out.height !== RT.h) resizeLens(RT.w, RT.h);
  // focal length for a 24 mm-high sensor at the current vertical FOV; a touch wider aperture under water
  const fl = 0.012 / Math.tan(camera.fov * DEG / 2), fn = under ? 2.0 : P.fStop, maxCoc = 0.016 * P.dofStrength;
  const aspect = RT.w / RT.h, depth = RT.main.depthTexture;
  const F = LENS.focusRT[LENS.focusIdx], Fp = LENS.focusRT[1 - LENS.focusIdx];
  const fu = LENS.focusPass.uniforms;
  fu.tDepth.value = depth; fu.tPrev.value = Fp.texture; fu.uNear.value = camera.near; fu.uFar.value = camera.far;
  fu.uSubject.value = subject; fu.uRate.value = 1 - Math.exp(-Math.max(dt, 1 / 120) * 4.5); fu.uAspect.value = aspect;
  LENS.focusPass.render(F); LENS.focusIdx = 1 - LENS.focusIdx;
  for (const p of [LENS.prePass, LENS.combinePass]) {
    const u = p.uniforms; u.tDepth.value = depth; u.tFocus.value = F.texture; u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uFL.value = fl; u.uFN.value = fn; u.uMaxCoc.value = maxCoc;
  }
  LENS.prePass.uniforms.tColor.value = color; LENS.prePass.uniforms.uTexel.value.set(1 / RT.w, 1 / RT.h);
  LENS.prePass.render(LENS.pre);
  const bu = LENS.bokehPass.uniforms; bu.tSrc.value = LENS.pre.texture; bu.uMaxCoc.value = maxCoc; bu.uAspect.value = aspect; bu.uTexelH.value.set(1 / LENS.pre.width, 1 / LENS.pre.height);
  LENS.bokehPass.render(LENS.bokeh);
  const tu = LENS.tentPass.uniforms; tu.tSrc.value = LENS.bokeh.texture; tu.uTexelH.value.set(1 / LENS.pre.width, 1 / LENS.pre.height);
  LENS.tentPass.render(LENS.tent);
  const cu = LENS.combinePass.uniforms; cu.tColor.value = color; cu.tDof.value = LENS.tent.texture; cu.uTexel.value.set(1 / RT.w, 1 / RT.h);
  LENS.combinePass.render(LENS.out);
  return LENS.out.texture;
}
let godMaskPass, godBlurPass;
