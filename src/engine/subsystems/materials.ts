// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER, KOI_MAX } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets } from "../geometry";
import { $, progress, toast } from "../state";
import { SH } from "./lighting";
import { TEX } from "./textures";
export { seasonal } from "./weather";
/* ------------------------------------------------------------------ 5. SHARED MATERIAL INJECTIONS
   patchMaterial() composes, in one onBeforeCompile:
     - world position / normal varyings (+ optional wind sway in a replaced project_vertex)
     - underwater lighting: Beer–Lambert on the sun path, caustics projected along the refracted sun ray,
       ambient attenuation with depth, and exponential teal fog when the camera is submerged
     - optional triplanar rock/hedge shading, leaf translucency, wood weathering, koi skinning (added later)
*/
export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+1.0), u.x), u.y); }
`;
export const UW_VS_PARS = /* glsl */`
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWind;
uniform float uGust;
varying vec3 vUwPos;
varying vec3 vWNrm;
// Wind: slow sway scaled by a per-vertex weight, noise-like gusts travelling along the wind, fast leaf flutter
#ifdef FLOAT
uniform float uWaterY;
uniform vec4 uWavesS[4];
uniform sampler2D tRippleS;
uniform vec4 uSimS;
// height of the water surface at xz: the same Gerstner sum + ripple simulation the water mesh uses
float surfaceHeight(vec2 xz){
  float h = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 D = normalize(uWavesS[i].xy); float k = 6.2831853 / uWavesS[i].z;
    h += uWavesS[i].w * sin(k * (dot(D, xz) - sqrt(9.81 / k) * uTime));
  }
  return h + texture2D(tRippleS, (xz - uSimS.xy) / uSimS.z).r;
}
#endif
vec3 windOffset(vec3 wp, float w){
  float ph = dot(wp.xz, uWindDir) * 0.35;
  float gustWave = 0.55 + 0.45 * sin(uTime * 0.9 - ph * 1.3) * sin(uTime * 0.37 - ph * 0.6 + 1.7);
  float sway = sin(uTime * 1.25 + ph + wp.y * 0.3) * 0.55 + sin(uTime * 2.3 + ph * 1.7) * 0.25;
  float amp = uWind * (0.35 + uGust * gustWave);
  vec2 o = uWindDir * (amp * 0.6 + amp * 0.5 * sway) * w;
  float fl = sin(uTime * (6.5 + fract(wp.x * 3.1) * 3.0) + dot(wp, vec3(4.1, 3.3, 5.7))) * 0.018 * (0.3 + uWind) * w;
  return vec3(o.x + fl, -abs(o.x + o.y) * 0.18 * w + fl * 0.6, o.y - fl);
}
`;
export const UW_FS_PARS = /* glsl */`
uniform float uTime;
uniform float uWaterY;
uniform vec3 uSunDir;
uniform vec3 uSunDirW;
uniform vec3 uSunColor;
uniform vec3 uAbsorb;
uniform float uScatter;
uniform vec3 uInscatter;
uniform float uCamUnder;
uniform sampler2D tCaustics;
uniform float uCausticStr;
uniform float uCausticNorm;
varying vec3 vUwPos;
varying vec3 vWNrm;
uniform float uSnowCover;
uniform float uWet;
uniform float uAutumn;
uniform float uFogDensity;
uniform vec3 uFogColor;
float wxh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wxn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wxh(i), wxh(i + vec2(1, 0)), f.x), mix(wxh(i + vec2(0, 1)), wxh(i + vec2(1, 1)), f.x), f.y); }
// ---- Caustics: two counter-scrolling Voronoi-derived patterns, multiplied.
float causticSample(vec2 p){
  float a = texture2D(tCaustics, p * 0.52 + vec2(uTime * 0.022, uTime * 0.013)).r;
  float b = texture2D(tCaustics, (p * 0.67) * mat2(0.8, -0.6, 0.6, 0.8) - vec2(uTime * 0.016, -uTime * 0.025)).r;
  return a * b;
}
// Koi shadows, computed analytically every frame instead of through the shadow map: a single soft silhouette per
// fish on whatever lies beneath it, found by walking up the refracted sun ray to the fish's depth. The penumbra widens
// with distance (sun disc + the wavy surface scatter the light), and a koi never shadows itself.
uniform vec4 uKoiA[${KOI_MAX}];
uniform vec4 uKoiB[${KOI_MAX}];
float koiShadow(vec3 wp, float selfIdx){
  vec2 toSun = uSunDirW.xz / max(uSunDirW.y, 0.3);
  float sh = 1.0;
  for (int i = 0; i < ${KOI_MAX}; i++) {
    vec4 A = uKoiA[i];
    if (A.w <= 0.0 || abs(float(i) - selfIdx) < 0.5) continue;
    float h = A.y - wp.y;
    if (h < 0.015) continue;
    vec2 q = wp.xz + toSun * h - A.xz;
    float sz = A.w, pen = 0.012 + 0.05 * h;
    if (dot(q, q) > (0.85 * sz + pen) * (0.85 * sz + pen)) continue;
    vec4 B = uKoiB[i];
    float g = length(B.xy); vec2 dir = B.xy / g;
    float s = 0.5 - dot(q, dir) / sz;                                   // 0 snout .. 1 tail base
    float t = max(s - 0.3, 0.0) / 0.6;
    float v = dot(q, vec2(-dir.y, dir.x)) / sz - B.z * t * t;          // follows the swimming spine
    float e = (s - 0.37) / (s < 0.37 ? 0.39 : 0.68);
    float w = 0.115 * g * sqrt(max(1.0 - e * e, 0.0)) * step(0.0, s);
    w = max(w, 0.035 * smoothstep(0.93, 1.02, s) * (1.0 - smoothstep(1.22, 1.32, s)));   // the tail fan's thin edge-on shadow
    float k = 1.0 - smoothstep(-pen, pen, (abs(v) - w) * sz);
    sh *= 1.0 - k * 0.8 * exp(-h * 0.2);                                // umbra: the body blocks the direct sun
  }
  return sh;
}
// Projected from the refracted sun direction: walk up the light ray to where it crossed the surface.
vec3 causticsRGB(vec3 wp, float depth){
  vec2 p = wp.xz + uSunDirW.xz / max(uSunDirW.y, 0.3) * depth;
  float s = 0.003 + 0.004 * depth;          // slight chromatic dispersion that grows with depth
  return vec3(causticSample(p + vec2(s, 0.0)), causticSample(p), causticSample(p - vec2(s, 0.0))) * uCausticNorm;
}
`;
// Fragment: computed right before the light loop
export const UW_PRE_LIGHTS = /* glsl */`
float uwD = uWaterY - vUwPos.y;
float uwMask = smoothstep(-0.015, 0.03, uwD);
float uwDepth = max(uwD, 0.0);
vec3 uwSunMod = vec3(1.0);
vec3 uwAmbMod = vec3(1.0);
if (uwMask > 0.0) {
  // Beer–Lambert on the refracted sun path down to this point
  vec3 sunT = exp(-uAbsorb * uwDepth / max(uSunDirW.y, 0.25));
  vec3 cau = causticsRGB(vUwPos, uwDepth);
  float cf = uCausticStr * exp(-uwDepth * 0.5) * smoothstep(0.02, 0.4, uwDepth);   // caustics need some depth to focus
  #ifdef KOI_SELF_IDX
    float koiSelf = KOI_SELF_IDX;
  #else
    float koiSelf = -1.0;
  #endif
  float koiSh = koiShadow(vUwPos, koiSelf);
  uwSunMod = mix(vec3(1.0), sunT * mix(vec3(1.0), cau, cf) * 0.96 * koiSh, uwMask);
  uwAmbMod = mix(vec3(1.0), exp(-uAbsorb * uwDepth * 1.7) * mix(0.95, 0.8, smoothstep(0.05, 0.6, uwDepth)) * mix(1.0, koiSh, 0.35), uwMask);   // a koi overhead also hides part of the sky
}
`;
export const UW_POST_LIGHTS = /* glsl */`
// water (n=1.33) against stone/scales (n~1.5) reflects almost nothing: submerged surfaces lose their gloss
reflectedLight.directSpecular *= mix(1.0, 0.12, uwMask);
clearcoatSpecularDirect *= mix(1.0, 0.1, uwMask);
reflectedLight.indirectDiffuse *= uwAmbMod;
reflectedLight.indirectSpecular *= uwAmbMod * mix(1.0, 0.35, uwMask);
clearcoatSpecularIndirect *= uwAmbMod * mix(1.0, 0.35, uwMask);
sheenSpecularIndirect *= uwAmbMod;
`;
// Exponential absorption fog with the water's own extinction when the camera is submerged
export const UW_FOG = /* glsl */`
if (uCamUnder > 0.5) {
  float fd = distance(vUwPos, cameraPosition);
  vec3 T = exp(-(uAbsorb + uScatter) * fd);
  gl_FragColor.rgb = gl_FragColor.rgb * T + uInscatter * (1.0 - T);
} else if (uFogDensity > 0.0) {
  // aerial perspective / mist: thicker near the ground, tinted by the weather
  float fd = distance(vUwPos, cameraPosition);
  float ff = (1.0 - exp(-fd * uFogDensity)) * mix(1.0, 0.45, smoothstep(1.0, 14.0, vUwPos.y));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, ff);
}
`;
// Triplanar rock / hedge shading (world-space), moss by slope + AO proxy, wet band at the waterline
export const TRI_FS_PARS = /* glsl */`
uniform sampler2D tAlb;
uniform sampler2D tNrm;
uniform sampler2D tMossAlb;
uniform float uTriScale;
uniform float uNrmStr;
uniform float uMoss;
uniform vec3 uTint;
uniform vec3 uBloomColor;
uniform float uBloom;
uniform float uWetAmt;
float th3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float tnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(th3(i), th3(i + vec3(1,0,0)), f.x), mix(th3(i + vec3(0,1,0)), th3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(th3(i + vec3(0,0,1)), th3(i + vec3(1,0,1)), f.x), mix(th3(i + vec3(0,1,1)), th3(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;
export const TRI_MAP = /* glsl */`
vec3 tpW = pow(abs(normalize(vWNrm)), vec3(4.0)); tpW /= (tpW.x + tpW.y + tpW.z);
vec2 tuvX = vUwPos.zy * uTriScale, tuvY = vUwPos.xz * uTriScale, tuvZ = vUwPos.xy * uTriScale;
vec4 triA = texture2D(tAlb, tuvX) * tpW.x + texture2D(tAlb, tuvY) * tpW.y + texture2D(tAlb, tuvZ) * tpW.z;
vec4 triD = texture2D(tAlb, tuvX * 3.7) * tpW.x + texture2D(tAlb, tuvY * 3.7) * tpW.y + texture2D(tAlb, tuvZ * 3.7) * tpW.z;   // micro-detail layer
vec3 triAlb = triA.rgb * uTint * mix(vec3(1.0), triD.rgb * 1.7, 0.3);
float mossF = 0.0, wetF = 0.0, rockH = 0.0;
#ifdef HEDGE
  // flowers: bright Worley cells packed in the alpha channel
  triAlb = mix(triAlb, uBloomColor * (0.75 + 0.25 * triA.g), smoothstep(0.35, 0.6, triA.a) * uBloom);
#else
  vec3 wnT = normalize(vWNrm);
  float cav = tnoise(vUwPos * 3.1) * 0.6 + tnoise(vUwPos * 11.0) * 0.4;
  triAlb *= mix(0.84, 1.05, smoothstep(0.25, 0.75, cav)) * mix(0.82, 1.0, smoothstep(-0.5, 0.4, wnT.y));       // cavities, shaded undersides
  float streak = tnoise(vec3(vUwPos.x * 9.0, vUwPos.y * 1.2, vUwPos.z * 9.0));
  triAlb *= 1.0 - smoothstep(0.55, 0.8, streak) * 0.14 * (1.0 - abs(wnT.y));                                    // rain streaks on vertical faces
  float lich = tnoise(vUwPos * 16.0 + 13.0) * 0.6 + tnoise(vUwPos * 47.0) * 0.4;
  float lichM = smoothstep(0.7, 0.74, lich) * smoothstep(0.0, 0.5, wnT.y) * smoothstep(uWaterY + 0.15, uWaterY + 0.3, vUwPos.y) * uMoss;
  triAlb = mix(triAlb, mix(vec3(0.16, 0.17, 0.12), vec3(0.3, 0.15, 0.04), step(0.88, fract(lich * 13.0))), lichM * 0.35);   // linear colours   // lichen crusts
  // granite grain: dark mica and pale feldspar / quartz specks at millimetre scale
  float grain = tnoise(vUwPos * 260.0), grain2 = tnoise(vUwPos * 610.0 + 7.0);
  triAlb *= 1.0 + (smoothstep(0.72, 0.8, grain) * 0.16 - smoothstep(0.74, 0.82, grain2) * 0.22);
  // hairline crack network and small weathering pits (darker, and cut into the surface below)
  float cr = abs(tnoise(vUwPos * 5.5 + 3.0) - 0.5) + abs(tnoise(vUwPos * 13.0) - 0.5) * 0.35;
  float crack = (1.0 - smoothstep(0.0, 0.018, cr)) * smoothstep(0.35, 0.6, tnoise(vUwPos * 1.3 + 9.0));
  float pit = smoothstep(0.8, 0.88, tnoise(vUwPos * 85.0 + 2.0));
  triAlb *= 1.0 - crack * 0.45 - pit * 0.18;
  // pale crustose lichen rosettes (grey-green discs with brighter rims) on the sunny tops
  float lr = tnoise(vUwPos * 24.0 + 21.0) * 0.75 + tnoise(vUwPos * 70.0) * 0.25;
  float lichP = smoothstep(0.68, 0.71, lr) * smoothstep(0.45, 0.65, tnoise(vUwPos * 2.0 + 5.0)) * smoothstep(0.1, 0.6, wnT.y) * smoothstep(uWaterY + 0.2, uWaterY + 0.35, vUwPos.y) * uMoss;
  triAlb = mix(triAlb, mix(vec3(0.34, 0.36, 0.29), vec3(0.46, 0.48, 0.4), smoothstep(0.72, 0.8, lr)), lichP * 0.5);
  rockH = -crack * 0.0012 - pit * 0.0005 + tnoise(vUwPos * 40.0) * 0.00035 + grain * 0.00008 + lichP * 0.0002;
  float mN = tnoise(vUwPos * 2.2) * 0.7 + tnoise(vUwPos * 7.3 + 4.0) * 0.3;
  float upF = normalize(vWNrm).y;
  float lowLying = 1.0 - smoothstep(uWaterY + 0.05, uWaterY + 0.8, vUwPos.y);          // AO proxy
  float shade = 1.0 - clamp(dot(normalize(vWNrm), uSunDir), 0.0, 1.0);                // faces turned from the sun
  mossF = smoothstep(0.45, 0.85, upF * 0.75 + lowLying * 0.35 + shade * 0.3 + (mN - 0.5) * 0.8 - (1.0 - uMoss) * 0.9);
  mossF *= smoothstep(uWaterY + 0.07, uWaterY + 0.16, vUwPos.y);
  vec3 mossAlb = texture2D(tMossAlb, tuvY * 2.1).rgb * (0.8 + 0.3 * mN);
  triAlb = mix(triAlb, mossAlb, mossF);
  // wet stone: 35 % darker and glossy within ~10 cm of the waterline (and below it)
  float wetEdge = uWaterY + 0.07 + (mN - 0.5) * 0.04;
  wetF = 1.0 - smoothstep(wetEdge - 0.025, wetEdge + 0.02, vUwPos.y);
  triAlb *= mix(1.0, 0.65, wetF * uWetAmt);
  triAlb = mix(triAlb, triAlb * vec3(0.72, 0.88, 0.62), smoothstep(0.02, 0.3, uWaterY - vUwPos.y) * 0.55 * uWetAmt); // algae film
#endif
diffuseColor.rgb *= triAlb;
`;
export const TRI_ROUGH = /* glsl */`
#ifdef HEDGE
  float roughnessFactor = roughness;
#else
  float roughnessFactor = roughness * triA.a / 0.78;
  roughnessFactor = mix(roughnessFactor, 0.92, mossF);
  roughnessFactor = mix(roughnessFactor, 0.3, wetF);
#endif
`;
export const TRI_NORMAL = /* glsl */`
{
  vec3 wn = normalize(vWNrm);
  vec3 tnX = texture2D(tNrm, tuvX).xyz * 2.0 - 1.0;
  vec3 tnY = texture2D(tNrm, tuvY).xyz * 2.0 - 1.0;
  vec3 tnZ = texture2D(tNrm, tuvZ).xyz * 2.0 - 1.0;
  float ns = uNrmStr * (1.0 - 0.6 * mossF) * (1.0 - 0.5 * wetF);
  tnX.xy *= ns; tnY.xy *= ns; tnZ.xy *= ns;
  // whiteout blend of the three tangent-space normals into world space
  tnX = vec3(tnX.xy + wn.zy, abs(tnX.z) * wn.x);
  tnY = vec3(tnY.xy + wn.xz, abs(tnY.z) * wn.y);
  tnZ = vec3(tnZ.xy + wn.xy, abs(tnZ.z) * wn.z);
  vec3 nW = normalize(tnX.zyx * tpW.x + tnY.xzy * tpW.y + tnZ.xyz * tpW.z);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  // procedural micro relief (cracks, pits, grain) as a screen-space derivative bump
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  float dhx = dFdx(rockH), dhy = dFdy(rockH);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - sign(det) * (dhx * r1 + dhy * r2) * (1.0 - mossF));
}
`;
// Leaves: transmission-free subsurface approximation — back-lit leaves glow with the (shadowed) sun colour
export const LEAF_POST_LIGHTS = /* glsl */`
{
  vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float toSun = max(dot(-geometryViewDir, Lv), 0.0);
  float thru = clamp(dot(-geometryNormal, Lv) * 0.6 + 0.4, 0.0, 1.0);
  float back = pow(toSun, 4.0) * 1.3 + 0.42;
  reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * back * thru * uTransl;
  // light scattered through the canopy reaches even self-shadowed leaves (seen from below they glow, not go black)
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunColor * uTransl * 0.07 * (0.4 + 0.6 * thru);
}
`;
// Timber: rails weather to silvery grey where they face the sky
export const WOOD_VS = /* glsl */`
attribute vec3 aBox;
attribute vec4 aHalf;
varying vec3 vBox;
varying vec4 vHalf;
`;
export const WOOD_MAP = /* glsl */`
float woodWear = 0.0, woodNail = 0.0, woodWet = 0.0;
{
  float wth = smoothstep(0.55, 0.95, normalize(vWNrm).y) * uWeather;
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(1.35, 1.32, 1.25) + 0.05, wth * 0.75);
  if (vHalf.x > 0.0) {
    // per-board colour, lighter worn arrises, darker grime where boards meet
    vec3 q = abs(vBox), dd = vHalf.xyz - q;
    float mn = min(dd.x, min(dd.y, dd.z)), mx = max(dd.x, max(dd.y, dd.z)), mid = dd.x + dd.y + dd.z - mn - mx;
    float sd = fract(vHalf.w);
    float n1 = fract(sin(dot(floor(vBox * 700.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    woodWear = 1.0 - smoothstep(0.0008, 0.008 + 0.006 * n1, mid);
    diffuseColor.rgb *= mix(vec3(0.8, 0.78, 0.76), vec3(1.12, 1.05, 1.0), sd) * (0.94 + 0.12 * fract(sd * 7.31));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.28 + vec3(0.03, 0.025, 0.02), woodWear * 0.55);
    float endGrime = 1.0 - smoothstep(0.0, 0.03, vHalf.x - q.x);
    diffuseColor.rgb *= 1.0 - 0.25 * endGrime * (1.0 - woodWear);
    if (vHalf.w >= 2.0) {                                   // two nail heads at each plank end
      float ex = vHalf.x - 0.035, ez = vHalf.z * 0.45;
      float dn = min(length(vec2(q.x - ex, vBox.z - ez)), length(vec2(q.x - ex, vBox.z + ez)));
      float onTop = step(vHalf.y - 0.003, vBox.y);
      woodNail = (1.0 - smoothstep(0.0026, 0.0034, dn)) * onTop;
      float rust = (1.0 - smoothstep(0.0035, 0.009, dn)) * onTop;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.36, 0.26), rust * 0.55);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.065, 0.06), woodNail);
    }
  }
  // saturated timber at the waterline, algae film below it
  woodWet = 1.0 - smoothstep(uWaterY + 0.03, uWaterY + 0.14, vUwPos.y);
  diffuseColor.rgb *= mix(1.0, 0.58, woodWet);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.78, 0.4), smoothstep(0.0, 0.2, uWaterY - vUwPos.y) * 0.7);
}
`;
export const WOOD_ROUGH = 'roughnessFactor = mix(roughnessFactor, 0.78, woodWear * 0.6); roughnessFactor = mix(roughnessFactor, 0.35, woodNail); roughnessFactor = mix(roughnessFactor, 0.28, woodWet);';

// Build the lights_fragment_begin chunk with the sun colour scaled by the underwater modifier.
export const LIGHTS_BEGIN_UW = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= uwSunMod;');
if (LIGHTS_BEGIN_UW === THREE.ShaderChunk.lights_fragment_begin) console.warn('lights chunk patch failed');

/**
 * opts: { key, uniforms, tri:bool, hedge:bool, leaf:bool, wood:bool, wind:'world'|'local'|null, windWeight:glsl,
 *         vsPars, vsNormal (glsl after beginnormal_vertex), vsBegin (glsl after begin_vertex), fsPars, fsMap (glsl after map_fragment) }
 */
export const WEATHER_ALBEDO = /* glsl */`
float wxSnow = 0.0, wxWet = 0.0;
{
  float wAbove = smoothstep(uWaterY + 0.004, uWaterY + 0.025, vUwPos.y);
  float wUp = normalize(vWNrm).y;
  float up = smoothstep(0.2, 0.8, wUp);
  #ifdef LEAFMAT
    up = max(up, 0.45 * smoothstep(-0.3, 0.5, wUp));               // foliage cards catch snow on any upward-ish face
    if (uAutumn > 0.001 && uDecid > 0.0) {
      // deciduous leaves turn: only the green parts change, colour picked per ~1 m patch so crowns go mottled
      float gr = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) / max(diffuseColor.g, 0.02) * 3.5, 0.0, 1.0);
      float n = wxh(floor(vUwPos.xz * 0.9) + floor(vUwPos.y * 0.9) * 7.1);
      vec3 pal = n < 0.45 ? mix(vec3(0.7, 0.06, 0.03), vec3(0.88, 0.2, 0.04), n / 0.45) : n < 0.8 ? mix(vec3(0.92, 0.34, 0.04), vec3(0.95, 0.5, 0.06), (n - 0.45) / 0.35) : mix(vec3(0.9, 0.66, 0.08), vec3(0.72, 0.5, 0.12), (n - 0.8) / 0.2);
      float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      diffuseColor.rgb = mix(diffuseColor.rgb, pal * (lum * 3.2 + 0.02), uAutumn * uDecid * gr);
    }
  #endif
  float sn = wxn(vUwPos.xz * 2.3) * 0.55 + wxn(vUwPos.xz * 9.0 + 3.1) * 0.3 + wxn(vUwPos.xz * 31.0) * 0.15;
  wxSnow = uSnowCover * wAbove * smoothstep(0.3, 0.5, up * (0.5 + 0.65 * sn));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.94) * (0.94 + 0.1 * sn), wxSnow);
  wxWet = uWet * wAbove * (1.0 - wxSnow);
  diffuseColor.rgb *= mix(1.0, 0.58 + 0.22 * (1.0 - up), wxWet);  // porous surfaces darken when soaked
}
`;
export const WEATHER_ROUGH = /* glsl */`
roughnessFactor = mix(roughnessFactor, 0.8, wxSnow);
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.3 + 0.05, wxWet * smoothstep(0.3, 0.9, normalize(vWNrm).y));   // puddle sheen
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.7, wxWet * 0.5);
`;
export function patchMaterial(mat, o = {}) {
  const U = Object.assign({}, o.uniforms || {});
  if (/^(koi|df|turt|frog|skin|drop|paddrop)/.test(o.key || '')) o = Object.assign({}, o, { noWeather: true });
  if (o.leaf && !U.uDecid) U.uDecid = { value: o.decid ?? 0 };
  mat.userData.uniforms = U;
  mat.customProgramCacheKey = () => 'pm-' + o.key;
  mat.onBeforeCompile = (sh) => {
    for (const k of Object.keys(SH)) sh.uniforms[k] = SH[k];
    Object.assign(sh.uniforms, U);
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    const defs = (o.tri ? '#define TRI\n' : '') + (o.hedge ? '#define HEDGE\n' : '') + (o.wind ? '#define WIND\n' : '') + (o.float ? '#define FLOAT\n' : '');
    vs = vs.replace('#include <common>', defs + '#include <common>\n' + UW_VS_PARS + (o.vsPars || ''));
    if (o.vsNormal) vs = vs.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + o.vsNormal);
    if (o.vsBegin) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + o.vsBegin);
    if (o.vsAfterUv) vs = vs.replace('#include <uv_vertex>', '#include <uv_vertex>\n' + o.vsAfterUv);
    vs = vs.replace('#include <project_vertex>', /* glsl */`
      vec4 wPos4 = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wPos4 = instanceMatrix * wPos4;
      #endif
      wPos4 = modelMatrix * wPos4;
      #ifdef WIND
        vec3 wWindP = ${o.windPos || 'wPos4.xyz'};
        wPos4.xyz += windOffset(wWindP, ${o.windWeight || '1.0'});
      #endif
      #ifdef FLOAT
        wPos4.y = uWaterY + surfaceHeight(wPos4.xz) + transformed.y + 0.0015;   // rides the local wave shape
      #endif
      vUwPos = wPos4.xyz;
      vec3 wN = objectNormal;
      #ifdef USE_INSTANCING
        wN = mat3(instanceMatrix) * wN;
      #endif
      vWNrm = normalize(mat3(modelMatrix) * wN);
      vec4 mvPosition = viewMatrix * wPos4;
      gl_Position = projectionMatrix * mvPosition;`);
    fs = fs.replace('#include <roughnessmap_fragment>', (o.noWeather ? '' : WEATHER_ALBEDO) + '#include <roughnessmap_fragment>');
    fs = fs.replace('#include <metalnessmap_fragment>', (o.noWeather ? '' : WEATHER_ROUGH) + '#include <metalnessmap_fragment>');
    fs = fs.replace('#include <common>', defs + (o.leaf ? '#define LEAFMAT\n' : '') + '#include <common>\n' + UW_FS_PARS + (o.tri ? TRI_FS_PARS : '') +
      (o.leaf ? 'uniform float uTransl;\nuniform float uDecid;\n' : '') + (o.wood ? 'uniform float uWeather;\n' : '') + (o.fsPars || ''));
    if (o.fsNormal) fs = fs.replace('#include <normal_fragment_maps>', o.fsNormal);
    if (o.tri) {
      fs = fs.replace('#include <map_fragment>', TRI_MAP);
      fs = fs.replace('#include <roughnessmap_fragment>', TRI_ROUGH);
      fs = fs.replace('#include <normal_fragment_maps>', TRI_NORMAL);
    } else if (o.fsMap || o.wood) {
      fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\n' + (o.wood ? WOOD_MAP : '') + (o.fsMap || ''));
    }
    if (o.fsMetal) fs = fs.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + o.fsMetal);
    if (o.fsRough) fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + o.fsRough);
    fs = fs.replace('#include <lights_fragment_begin>', (o.fsPreLights || '') + UW_PRE_LIGHTS + LIGHTS_BEGIN_UW);
    fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + UW_POST_LIGHTS + (o.leaf ? LEAF_POST_LIGHTS : '') + (o.fsPostLights || ''));
    fs = fs.replace('#include <fog_fragment>', '#include <fog_fragment>\n' + UW_FOG);
    sh.vertexShader = vs; sh.fragmentShader = fs;
  };
  return mat;
}
// Depth material for shadow casting that repeats the same vertex deformation (wind / koi swimming)
export function patchedDepth(o, map, alphaTest) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: map || null, alphaTest: alphaTest || 0, side: THREE.DoubleSide });
  m.customProgramCacheKey = () => 'pd-' + o.key;
  m.onBeforeCompile = (sh) => {
    for (const k of Object.keys(SH)) sh.uniforms[k] = SH[k];
    Object.assign(sh.uniforms, o.uniforms || {});
    let vs = sh.vertexShader;
    vs = vs.replace('#include <common>', (o.wind ? '#define WIND\n' : '') + '#include <common>\n' + UW_VS_PARS + (o.vsPars || ''));
    if (o.vsBeginDepth) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + o.vsBeginDepth);
    vs = vs.replace('#include <project_vertex>', /* glsl */`
      vec4 wPos4 = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wPos4 = instanceMatrix * wPos4;
      #endif
      wPos4 = modelMatrix * wPos4;
      #ifdef WIND
        vec3 wWindP = ${o.windPos || 'wPos4.xyz'};
        wPos4.xyz += windOffset(wWindP, ${o.windWeight || '1.0'});
      #endif
      vec4 mvPosition = viewMatrix * wPos4;
      gl_Position = projectionMatrix * mvPosition;`);
    sh.vertexShader = vs;
  };
  return m;
}
export function physical(params, patch) {
  const m = new THREE.MeshPhysicalMaterial(Object.assign({ envMapIntensity: 0.85 }, params));
  return patchMaterial(m, patch);
}
export function rockMaterial(set, o) {
  return physical(Object.assign({ color: 0xffffff, roughness: o.rough ?? 0.78, metalness: 0, envMapIntensity: 0.7 }, o.params || {}), {
    key: o.key, tri: true, hedge: !!o.hedge,
    uniforms: {
      tAlb: { value: set.map }, tNrm: { value: set.normalMap }, tMossAlb: { value: TEX.moss.map },
      uTriScale: { value: o.scale ?? 1 }, uNrmStr: { value: o.nrm ?? 1 }, uMoss: { value: o.moss ?? 0.5 },
      uTint: { value: new THREE.Color(o.tint ?? 0xffffff) }, uBloomColor: { value: new THREE.Color(o.bloomColor ?? 0xffffff) }, uBloom: { value: o.bloom ?? 0 }, uWetAmt: { value: o.wet ?? 1 },
    },
  });
}

