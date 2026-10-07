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
import { waterHeightAt, addDrop } from "./water";
import { audioEvent } from "./audio";
import { splashAt, bubbleBurst } from "./bubbles";
import { pondDepth, addMossShells, BRIDGE } from "./terrain";
import { spawnSplash } from "./bubbles";

/* ------------------------------------------------------------------ 9e. POND SLIDER TURTLE */
// A yellow-bellied slider (Trachemys scripta scripta), after the reference photo: olive-brown oval carapace with
// keeled vertebrals, a yellow bar on every costal scute, growth annuli and serrated rear marginals; a yellow plastron
// with dark smudges; near-black skin with yellow neck, leg and chin stripes and the broad yellow blotch behind the eye;
// webbed feet with long front claws. Rigid SDF parts (shell, head+neck, four limbs, tail) are posed per frame.
// Behaviour: basks on a low rock in the pond, walks down the ramp and plops in, swims and paddles underwater,
// surfaces to breathe, then climbs back out and basks again (dry shell -> wet and glossy -> slowly dries).
export const TURTLE = { root: null, rocks: [], state: 'bask', timer: 14, pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, speed: 0, wet: 0.2,
  gait: 0, stroke: 0, ext: 1, headYaw: 0, headPitch: 0, lookT: 0, lookYaw: 0, lookPitch: 0.2, wp: new THREE.Vector3(), swimT: 0, breathed: false };
export const TURT_ROCK = { x: 1.45, z: 1.75 };
export const TURT_PIV = { head: [0.083, 0.024, 0], fl: [0.066, 0.019, 0.05], hl: [-0.066, 0.018, 0.047], tail: [-0.098, 0.017, 0] };

export function turtleEyeTexture() {
  // polar map around the gaze axis (+y of the sphere): round pupil crossed by the slider's dark horizontal bar
  const W = 256, H = 128, cv = makeCanvas(W, H), g = cv.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const th = y / H, ph = (x / W) * Math.PI * 2;
    const bar = Math.abs(Math.sin(ph)) < 0.28 && th < 0.36;
    let c;
    if (th < 0.12 || bar) c = [8, 8, 6];
    else if (th < 0.36) {
      const t = (th - 0.12) / 0.24, v = hash3i(x >> 1, y >> 1, 7, 2);
      c = mix3(mix3([150, 150, 60], [196, 186, 88], Math.sin(t * Math.PI)), [50, 44, 16], (v > 0.82 ? 0.5 : 0) + smoothstep(0.7, 1, t) * 0.75);
    } else c = mix3([26, 26, 16], [36, 38, 22], smoothstep(0.36, 0.6, th));
    const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTex(cv, true);
}
export const TURT_VS = /* glsl */`
varying vec3 vTL;
varying vec3 vTN;
`;
export const TURT_VS_BEGIN = 'vTL = position; vTN = objectNormal;';
export const TURT_FS_PARS = /* glsl */`
varying vec3 vTL;
varying vec3 vTN;
uniform float uTWet;
float tH = 0.0;          // micro height (m) for the derivative bump
float th3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float tn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(th3(i), th3(i + vec3(1,0,0)), f.x), mix(th3(i + vec3(0,1,0)), th3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(th3(i + vec3(0,0,1)), th3(i + vec3(1,0,1)), f.x), mix(th3(i + vec3(0,1,1)), th3(i + vec3(1,1,1)), f.x), f.y), f.z); }
// cellular scales: distance to the nearest / second-nearest feature point
vec2 tvor(vec3 x){ vec3 i = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int h = -1; h <= 1; h++) {
    vec3 o = vec3(float(h), float(j), float(k)); vec3 r = o + vec3(th3(i + o), th3(i + o + 13.1), th3(i + o + 27.7)) - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return vec2(sqrt(d1), sqrt(d2)); }
`;
export const TURT_BUMP = /* glsl */`
{
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  float dhx = dFdx(tH), dhy = dFdy(tH);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad);
}
`;
// Carapace scutes are laid out in an unfolded dome parameter (u forward, w across; rho = 1 at the rim).
export const TURT_SHELL_MAP = /* glsl */`
vec3 p = vTL, n = normalize(vTN);
vec3 col;
float mott = tn3(p * 260.0) * 0.6 + tn3(p * 900.0) * 0.4;
bool plast = p.y < 0.0125 && (p.x * p.x / 0.0104 + p.z * p.z / 0.0046) < 1.08 && n.y < 0.2;
if (plast) {
  // plastron: warm yellow, dark smudges on the anterior scutes (yellow-bellied), seams, faint growth rings
  float seam = abs(p.z);
  float xs[5] = float[5](0.074, 0.047, 0.008, -0.03, -0.066);
  for (int i = 0; i < 5; i++) seam = min(seam, abs(p.x - xs[i]));
  vec3 q = vec3(p.x, 0.0, abs(p.z));
  float sm = 0.0;
  sm = max(sm, 1.0 - smoothstep(0.004, 0.0105, length(q.xz - vec2(0.064, 0.016)) + (tn3(p * 700.0) - 0.5) * 0.006));
  sm = max(sm, 1.0 - smoothstep(0.003, 0.009, length(q.xz - vec2(0.03, 0.03)) + (tn3(p * 650.0 + 3.0) - 0.5) * 0.006) * 0.8);
  sm = max(sm, (1.0 - smoothstep(0.002, 0.006, length(q.xz - vec2(-0.012, 0.042)) + (tn3(p * 600.0 + 7.0) - 0.5) * 0.004)) * 0.6);
  col = mix(vec3(0.78, 0.68, 0.34), vec3(0.88, 0.78, 0.42), mott);
  col *= 0.94 + 0.06 * sin(seam * 2600.0);
  col = mix(col, vec3(0.16, 0.13, 0.07), sm * 0.9);
  float sl = 1.0 - smoothstep(0.0004, 0.0011, seam);
  col = mix(col, vec3(0.3, 0.24, 0.12), sl * 0.8);
  tH = -sl * 0.00035 + mott * 0.00004;
} else {
  vec3 qd = vec3((p.x - 0.004) / 0.112, (p.y - 0.02) / 0.058, p.z / (0.082 * (1.0 + 0.05 * (-p.x / 0.112))));
  float qlen = length(qd); qd /= max(qlen, 1e-4);
  float rho = acos(clamp(qd.y, -1.0, 1.0)) / 1.5708;
  float phi = atan(qd.z, qd.x);
  float u = rho * cos(phi), w = rho * sin(phi), aw = abs(w);
  const float RING = 0.86;
  float seam, cid, kind, cu = 0.5, cv = 0.5;
  if (rho > RING) {
    float a = abs(phi), nM = 12.0, fa = a / 3.14159 * nM + 0.5, fr = fract(fa);
    seam = min(min(fr, 1.0 - fr) * 3.14159 / nM * 0.11, (rho - RING) * 0.12);
    cid = floor(fa) + (w < 0.0 ? 20.0 : 0.0); kind = 2.0; cu = fr; cv = (rho - RING) / (1.0 - RING);
  } else {
    float wv = 0.25 + 0.025 * cos((u + 0.46) / 0.3325 * 6.2832);
    if (aw < wv) {
      float idx = u > 0.54 ? 0.0 : u > 0.2 ? 1.0 : u > -0.13 ? 2.0 : u > -0.47 ? 3.0 : 4.0;
      float dU = min(min(abs(u - 0.54), abs(u - 0.2)), min(abs(u + 0.13), abs(u + 0.47)));
      seam = min(min(dU, wv - aw), RING - rho) * 0.12;
      cid = 40.0 + idx; kind = 0.0; cv = aw / wv;
    } else {
      float sk = (aw - wv);
      float c0 = 0.38 - sk * 0.35, c1 = 0.03 - sk * 0.08, c2 = -0.32 + sk * 0.3;
      float idx = u > c0 ? 0.0 : u > c1 ? 1.0 : u > c2 ? 2.0 : 3.0;
      float dU = min(min(abs(u - c0), abs(u - c1)), abs(u - c2));
      seam = min(min(dU, aw - wv), RING - rho) * 0.12;
      cid = 50.0 + idx + (w < 0.0 ? 10.0 : 0.0); kind = 1.0;
      float lo = idx == 0.0 ? c0 : idx == 1.0 ? c1 : idx == 2.0 ? c2 : -RING;
      float hi = idx == 0.0 ? RING : idx == 1.0 ? c0 : idx == 2.0 ? c1 : c2;
      cu = (u - lo) / max(hi - lo, 1e-3); cv = (aw - wv) / max(RING - wv, 1e-3);
    }
  }
  float hs = fract(sin(cid * 12.9898 + 1.3) * 43758.5453);
  // olive-brown ground, each scute its own shade, darker toward the seams
  col = mix(vec3(0.21, 0.19, 0.11), vec3(0.3, 0.26, 0.15), hs * 0.6 + mott * 0.4);
  col *= 0.78 + 0.22 * smoothstep(0.0, 0.012, seam);
  // yellow markings: a vertical bar on every costal, a bar on each marginal, fine vermiculation on the vertebrals
  vec3 yel = mix(vec3(0.5, 0.46, 0.2), vec3(0.62, 0.55, 0.26), mott);
  float edgeN = (tn3(p * 520.0) - 0.5) * 0.18;
  if (kind == 1.0) col = mix(col, yel, (1.0 - smoothstep(0.05, 0.12, abs(cu - 0.5 + (cv - 0.5) * 0.12) + edgeN * 0.6)) * smoothstep(0.08, 0.35, cv) * smoothstep(1.0, 0.8, cv) * 0.7);
  if (kind == 2.0) {
    col = mix(col, yel, (1.0 - smoothstep(0.06, 0.13, abs(cu - 0.5) + edgeN * 0.6)) * 0.45);
    // marginal underside: yellow with a dark ocellus on each scute
    float under = smoothstep(0.2, -0.4, n.y) + step(p.y, 0.0135);
    vec3 ucol = mix(vec3(0.76, 0.66, 0.32), vec3(0.18, 0.15, 0.08), 1.0 - smoothstep(0.12, 0.26, length(vec2(cu - 0.5, (cv - 0.6) * 0.6)) + edgeN * 0.5));
    col = mix(col, ucol, clamp(under, 0.0, 1.0));
  }
  if (kind == 0.0) col = mix(col, yel * 0.85, smoothstep(0.62, 0.8, tn3(p * 340.0 + cid)) * 0.45);
  // growth annuli parallel to the seams; seams as dark grooves
  float ann = 0.5 + 0.5 * sin(seam * 2300.0 + mott * 2.0);
  col *= 0.93 + 0.07 * ann * (1.0 - smoothstep(0.004, 0.02, seam));
  float sl = 1.0 - smoothstep(0.0005, 0.0013, seam);
  col = mix(col, vec3(0.08, 0.075, 0.04), sl * 0.85);
  tH = -sl * 0.0005 + ann * 0.00006 * (1.0 - smoothstep(0.004, 0.02, seam)) + mott * 0.00005;
  // dry: a dusty grey bloom of dried mineral film; algae along the rear margin
  float dust = (1.0 - uTWet) * smoothstep(0.35, 0.8, tn3(p * 90.0) * 0.7 + mott * 0.3) * smoothstep(-0.2, 0.6, n.y);
  col = mix(col, vec3(0.5, 0.49, 0.42), dust * 0.4);
  col = mix(col, vec3(0.2, 0.26, 0.1), smoothstep(0.7, 0.95, tn3(p * 150.0 + 5.0)) * smoothstep(-0.02, -0.09, p.x) * 0.35);
}
col *= mix(1.0, 0.78, uTWet);                      // wet surfaces darken
diffuseColor.rgb = pow(clamp(col, 0.0, 1.0), vec3(2.2));
`;
// Skin: near-black olive with yellow stripes; TPART 0 head+neck, 1 front leg, 2 hind leg, 3 tail
export const TURT_SKIN_MAP = /* glsl */`
vec3 p = vTL, n = normalize(vTN);
float mott = tn3(p * 700.0);
vec3 skin = mix(vec3(0.07, 0.08, 0.045), vec3(0.13, 0.14, 0.075), mott);
vec3 yel = mix(vec3(0.74, 0.66, 0.26), vec3(0.86, 0.78, 0.34), tn3(p * 300.0));
float stripe = 0.0, horn = 0.0, scl = 0.0;
float wob = (tn3(p * 260.0) - 0.5) * 1.2;
#if TPART == 0
  float a = atan(p.z, p.y - 0.004);
  float neck = 1.0 - smoothstep(0.048, 0.06, p.x);
  stripe = smoothstep(0.72, 0.86, 0.5 + 0.5 * sin(a * 11.0 + wob + p.x * 30.0)) * neck;
  // broad yellow postorbital blotch, a stripe from the nostril under the eye, chin stripes and spots
  float az = abs(p.z);
  float blot = 1.0 - smoothstep(0.0, 0.002, length(vec2((p.x - 0.061) / 0.8, p.y - 0.009)) - 0.0072 + wob * 0.002);
  blot *= smoothstep(0.008, 0.012, az);
  float snoutS = 1.0 - smoothstep(0.0007, 0.0014, abs(p.y - (0.004 + (p.x - 0.06) * 0.12)) + wob * 0.0005);
  snoutS *= smoothstep(0.058, 0.066, p.x) * (1.0 - smoothstep(0.094, 0.099, p.x)) * smoothstep(0.004, 0.009, az);
  float chin = smoothstep(0.002, -0.004, p.y) * smoothstep(0.045, 0.058, p.x);
  float chinS = smoothstep(0.55, 0.8, 0.5 + 0.5 * sin(az * 900.0 + wob));
  float crown = 1.0 - smoothstep(0.0006, 0.0014, az - 0.0006) ;
  stripe = max(stripe, max(blot, max(snoutS, chin * chinS)));
  stripe = max(stripe, crown * smoothstep(0.05, 0.06, p.x) * smoothstep(0.012, 0.018, p.y) * 0.8);
  // horny beak along the jaws
  float lipZ = abs(p.y - (0.0035 + (p.x - 0.06) * 0.04));
  horn = (1.0 - smoothstep(0.0012, 0.003, lipZ)) * smoothstep(0.066, 0.078, p.x);
  horn = max(horn, smoothstep(0.093, 0.098, p.x));
  // neck skin folds (across the axis) and fine granular head scales
  tH = (0.5 + 0.5 * sin(p.x * 1500.0 + wob * 2.0)) * 0.00007 * neck + tn3(p * 3000.0) * 0.000025;
#else
  float a = atan(p.z, p.y);
  #if TPART == 3
    stripe = smoothstep(0.7, 0.86, 0.5 + 0.5 * sin(a * 6.0 + wob));
  #else
    // front and hind legs: stripes along the limb, big scales on the leading edge, claws
    stripe = smoothstep(0.74, 0.88, 0.5 + 0.5 * sin(a * 5.0 + wob + p.x * 20.0)) * (1.0 - smoothstep(0.03, 0.04, p.x));
    vec2 vv = tvor(p * vec3(260.0, 320.0, 320.0));
    scl = 1.0 - smoothstep(0.0, 0.12, vv.y - vv.x);
    #if TPART == 1
      vec2 hc = vec2(0.046, 0.0); float tipR = 0.0162;
    #else
      vec2 hc = vec2(0.05, 0.0); float tipR = 0.0195;
    #endif
    horn = smoothstep(tipR - 0.0008, tipR + 0.0012, length(p.xz - hc)) * step(hc.x, p.x);
    tH = -scl * 0.00012 + tn3(p * 2500.0) * 0.00002;
  #endif
#endif
vec3 col = mix(skin, yel, stripe);
col = mix(col, col * 0.6 + vec3(0.03), scl * 0.5);
col = mix(col, vec3(0.2, 0.18, 0.12) * (0.8 + 0.4 * mott), horn);
col = mix(col, col * vec3(1.15, 1.1, 0.9) + vec3(0.03, 0.03, 0.0), smoothstep(0.1, -0.6, n.y) * 0.5);   // paler undersides
col *= mix(1.0, 0.85, uTWet);
diffuseColor.rgb = pow(clamp(col, 0.0, 1.0), vec3(2.2));
`;
export function turtleShellSDF() {
  const S = SDFK, P3 = [0, 0, 0];
  return (p) => {
    const x = p[0], y = p[1], z = p[2], az = Math.abs(z);
    P3[0] = x; P3[1] = y; P3[2] = az;
    // carapace dome: oval, a touch wider behind the middle; serrated rear marginals
    const ang = Math.atan2(az, x), rear = smoothstep(0.45, 1.0, -x / 0.112) * smoothstep(0.03, 0.02, y);
    const notch = 1 - 0.045 * rear * Math.pow(0.5 + 0.5 * Math.cos(ang * 24), 6);
    const zw = 1 + 0.05 * (-x / 0.112);
    let d = S.ellipsoid([x / notch, y, az / (zw * notch)], [0.004, 0.02, 0], [0.112, 0.058, 0.082]) * Math.min(notch, zw);
    d -= 0.0016 * Math.exp(-(az * az) / 0.0002) * clamp((y - 0.05) / 0.02, 0, 1);                       // low vertebral keel
    d = S.smax(d, 0.012 - y, 0.0025);                                                                   // flat underside of the margins
    // openings under the front and rear margins for head, limbs and tail
    d = S.smax(d, -S.ellipsoid(P3, [0.118, 0.012, 0], [0.034, 0.012, 0.046]), 0.004);
    d = S.smax(d, -S.ellipsoid(P3, [0.074, 0.012, 0.062], [0.026, 0.0095, 0.03]), 0.004);
    d = S.smax(d, -S.ellipsoid(P3, [-0.112, 0.012, 0], [0.028, 0.011, 0.05]), 0.004);
    d = S.smax(d, -S.ellipsoid(P3, [-0.074, 0.012, 0.058], [0.026, 0.0095, 0.03]), 0.004);
    // plastron: a flat plate with a truncated front lobe and a rear notch; bridges join it to the carapace
    let pl = S.smax(S.ellipsoid(P3, [0.0, 0.007, 0], [0.101, 0.02, 0.066]), Math.abs(y - 0.0072) - 0.0052, 0.003);
    pl = S.smax(pl, -S.sphere(P3, [-0.105, 0.006, 0], 0.013), 0.003);
    pl = S.smax(pl, x - 0.094, 0.006);
    pl = S.smin(pl, S.roundBox(P3, [0.0, 0.012, 0.064], [0.042, 0.006, 0.014], 0.004), 0.004);
    return S.smin(d, pl, 0.003);
  };
}
export function turtleHeadSDF() {
  const S = SDFK, P3 = [0, 0, 0];
  return (p) => {
    const x = p[0], y = p[1], z = p[2]; P3[0] = x; P3[1] = y; P3[2] = Math.abs(z);
    let d = S.cone(P3, [-0.035, -0.001, 0], [0.046, 0.004, 0], 0.0172, 0.0146);                      // neck (runs back into the shell)
    d = S.smin(d, S.ellipsoid(P3, [0.062, 0.0085, 0], [0.025, 0.015, 0.0166]), 0.009);             // cranium
    d = S.smin(d, S.ellipsoid(P3, [0.083, 0.0068, 0], [0.0145, 0.0098, 0.0102]), 0.007);             // snout
    d = S.smin(d, S.ellipsoid(P3, [0.069, -0.0005, 0], [0.023, 0.0085, 0.0128]), 0.006);             // lower jaw
    d = S.smax(d, -S.sphere(P3, [0.0765, 0.0132, 0.0112], 0.0047), 0.0014);                          // eye sockets
    d = S.smin(d, S.ellipsoid(P3, [0.0755, 0.0172, 0.0098], [0.007, 0.0026, 0.0038]), 0.002);        // brow over the eye
    d = S.smax(d, -S.cone(P3, [0.0985, 0.0036, 0], [0.058, 0.0052, 0.0138], 0.0005, 0.0009), 0.0007); // mouth line
    d = S.smax(d, -S.sphere(P3, [0.0968, 0.0092, 0.0023], 0.00085), 0.0005);                         // nostrils
    return d;
  };
}
export function turtleLegSDF(hind) {
  const S = SDFK, P3 = [0, 0, 0];
  const R = hind ? { r0: 0.0145, r1: 0.0122, r2: 0.0098, e1: 0.02, e2: 0.037, hc: 0.05, hr: [0.0145, 0.0042, 0.0148], n: 4, spread: 0.3, tip: 0.0195, claw: 0.0055 }
                 : { r0: 0.013, r1: 0.011, r2: 0.0092, e1: 0.019, e2: 0.035, hc: 0.046, hr: [0.0118, 0.0046, 0.0112], n: 5, spread: 0.25, tip: 0.0162, claw: 0.0095 };
  return (p) => {
    const x = p[0], y = p[1], z = p[2]; P3[0] = x; P3[1] = y; P3[2] = z;
    let d = S.cone(P3, [-0.016, 0, 0], [R.e1, -0.002, 0], R.r0, R.r1);
    const fp = [x, (y + 0.003) / 0.72 - 0.003, z];                                                    // flattened forearm / shank
    d = S.smin(d, S.cone(fp, [R.e1, -0.002, 0], [R.e2, -0.004, 0], R.r1, R.r2), 0.006);
    d = S.smin(d, S.ellipsoid(P3, [R.hc, -0.0045, 0], R.hr), 0.006);                                  // webbed paddle
    for (let i = 0; i < R.n; i++) {
      const a = (i - (R.n - 1) / 2) * R.spread, cx = R.hc + Math.cos(a) * R.tip, cz = Math.sin(a) * R.tip;
      d = S.smin(d, S.cone(P3, [R.hc + Math.cos(a) * 0.006, -0.0045, Math.sin(a) * 0.006], [cx, -0.0048, cz], 0.0026, 0.0019), 0.002);
      const ex = cx + Math.cos(a) * R.claw, ez = cz + Math.sin(a) * R.claw;                          // curved claws
      d = S.smin(d, S.cone(P3, [cx, -0.0048, cz], [lerp(cx, ex, 0.6), -0.0052, lerp(cz, ez, 0.6)], 0.0016, 0.001), 0.0008);
      d = S.smin(d, S.cone(P3, [lerp(cx, ex, 0.6), -0.0052, lerp(cz, ez, 0.6)], [ex, -0.0078, ez], 0.001, 0.00028), 0.0005);
    }
    return d;
  };
}
export function turtleTailSDF() {
  const S = SDFK;
  return (p) => S.cone(p, [-0.012, 0, 0], [0.042, -0.004, 0], 0.0092, 0.0012);
}
export function turtleRockHeight(x, z) {
  _trO.set(x, 1.5, z); _tray.set(_trO, _trD); _tray.far = 3;
  const h = _tray.intersectObjects(TURTLE.rocks, false)[0];
  return h ? h.point.y + 0.004 : -Infinity;
}
const _tray = new THREE.Raycaster(), _trO = new THREE.Vector3(), _trD = new THREE.Vector3(0, -1, 0);
_tray.layers.set(LAYER.BOTH);
export function buildTurtle() {
  // --- the basking rock: a low boulder with a weathered flat top and a tilted slab running down into the pond
  const boulderMat = WORLD.boulderMat;
  const rk = new THREE.Matrix4(), q = new THREE.Quaternion();
  const put = (geo, pos, quat, scl) => { geo.computeBoundingBox(); const bb = geo.boundingBox; pos.y -= scl.y * bb.max.y; return instanced(geo, boulderMat, [rk.compose(pos, quat, scl).clone()], LAYER.BOTH); };
  const D = new THREE.Vector3(-0.62, 0, 0.78).normalize();                                // ramp faces the viewer's side of the pond
  TURTLE.rampDir = D;
  const main = put(rockGeo(41.3, 5, -0.35, 0.7, false), new THREE.Vector3(TURT_ROCK.x, 0.15, TURT_ROCK.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.6, -0.04)), new THREE.Vector3(0.42, 0.3, 0.36));
  const sc = new THREE.Vector3(TURT_ROCK.x + D.x * 0.36, 0, TURT_ROCK.z + D.z * 0.36);
  const slabQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-D.z, D.x), 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0, -0.24)));
  const slab = put(rockGeo(17.9, 5, -0.35, 0.6), sc.clone().setY(0.06), slabQ, new THREE.Vector3(0.33, 0.16, 0.26));
  // submerged base that carries both down to the pond floor
  const bx = TURT_ROCK.x + D.x * 0.15, bz = TURT_ROCK.z + D.z * 0.15, fl = pondDepth(bx, bz, Math.max(0.01, -sdf(bx, bz)));
  const baseGeo = rockGeo(8.3, 4, -0.35, 0.2); baseGeo.computeBoundingBox();
  const bsy = (fl - 0.06) / (baseGeo.boundingBox.max.y - baseGeo.boundingBox.min.y);
  const base = put(baseGeo, new THREE.Vector3(bx, -0.1, bz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 1.3, 0)), new THREE.Vector3(0.62, bsy, 0.5));
  for (const m of [main, slab]) { m.castShadow = true; addMossShells(m, 0.45); }
  TURTLE.rocks = [main, slab, base]; WORLD.solids.push(main, slab);
  WORLD.obstacles = (WORLD.obstacles || []).concat([{ x: TURT_ROCK.x, z: TURT_ROCK.z, r: 0.5 }, { x: sc.x, z: sc.z, r: 0.3 }]);
  // basking spot = highest point near the rock centre; entry point = where the ramp passes under the water
  let best = -1, bt = 0;
  for (let t = -0.1; t < 0.3; t += 0.01) { const h = turtleRockHeight(TURT_ROCK.x + D.x * t, TURT_ROCK.z + D.z * t); if (h > best) { best = h; bt = t; } }
  TURTLE.B = new THREE.Vector3(TURT_ROCK.x + D.x * bt, best, TURT_ROCK.z + D.z * bt);
  let et = bt;
  for (let t = bt; t < 1.2; t += 0.01) { et = t; if (turtleRockHeight(TURT_ROCK.x + D.x * t, TURT_ROCK.z + D.z * t) < WATER_Y - 0.06) break; }
  TURTLE.E = new THREE.Vector3(TURT_ROCK.x + D.x * et, WATER_Y - 0.06, TURT_ROCK.z + D.z * et);

  // --- the animal
  const wet = { value: 0.2 };
  const shellMat = physical({ roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.25, envMapIntensity: 0.9 }, {
    key: 'turtshell', uniforms: { uTWet: wet }, vsPars: TURT_VS, vsBegin: TURT_VS_BEGIN, fsPars: TURT_FS_PARS, fsMap: TURT_SHELL_MAP, fsNormal: TURT_BUMP,
    fsRough: 'roughnessFactor = mix(0.62, 0.2, uTWet);', fsPreLights: '#ifdef USE_CLEARCOAT\n material.clearcoat = mix(0.12, 0.95, uTWet);\n#endif\n' });
  const skinMat = (part) => physical({ roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.3, sheen: 0.2, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xc8d0a0), envMapIntensity: 0.9 }, {
    key: 'turtskin' + part, uniforms: { uTWet: wet }, vsPars: TURT_VS, vsBegin: TURT_VS_BEGIN, fsPars: `#define TPART ${part}\n` + TURT_FS_PARS, fsMap: TURT_SKIN_MAP, fsNormal: TURT_BUMP,
    fsRough: 'roughnessFactor = mix(0.55, 0.24, uTWet); roughnessFactor = mix(roughnessFactor, 0.3, horn);', fsPreLights: '#ifdef USE_CLEARCOAT\n material.clearcoat = mix(0.15, 0.9, uTWet);\n#endif\n' });
  const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const root = new THREE.Group();
  const shell = mesh(surfaceNets(turtleShellSDF(), [-0.126, -0.002, -0.096], [0.126, 0.084, 0.096], 0.0011), shellMat);
  root.add(shell);
  const head = new THREE.Group(); head.position.set(...TURT_PIV.head);
  head.add(mesh(surfaceNets(turtleHeadSDF(), [-0.054, -0.019, -0.021], [0.102, 0.027, 0.021], 0.00055), skinMat(0)));
  const eyeMat = physical({ map: turtleEyeTexture(), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4 }, { key: 'turteye' });
  for (const s of [1, -1]) {
    const e = mesh(new THREE.SphereGeometry(0.0044, 24, 16), eyeMat);
    e.position.set(0.0768, 0.0132, s * 0.0112);
    e.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.42, 0.22, s * 0.88).normalize());
    head.add(e);
  }
  root.add(head);
  const fGeo = surfaceNets(turtleLegSDF(false), [-0.032, -0.02, -0.032], [0.078, 0.018, 0.032], 0.0006);
  const hGeo = surfaceNets(turtleLegSDF(true), [-0.034, -0.021, -0.036], [0.082, 0.02, 0.036], 0.0006);
  const fMat = skinMat(1), hMat = skinMat(2);
  const legs = [];
  for (const [hind, s] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
    const g = new THREE.Group(), pv = hind ? TURT_PIV.hl : TURT_PIV.fl;
    g.position.set(pv[0], pv[1], s * pv[2]); g.rotation.order = 'YZX';
    g.add(mesh(hind ? hGeo : fGeo, hind ? hMat : fMat)); root.add(g);
    legs.push({ g, hind: !!hind, s, cur: new THREE.Vector3(), phase: (hind ? (s > 0 ? Math.PI : 0) : (s > 0 ? 0 : Math.PI)) });
  }
  const tail = new THREE.Group(); tail.position.set(...TURT_PIV.tail); tail.rotation.set(0, Math.PI, 0);
  tail.add(mesh(surfaceNets(turtleTailSDF(), [-0.024, -0.013, -0.012], [0.046, 0.011, 0.012], 0.0006), skinMat(3)));
  root.add(tail);
  root.rotation.order = 'YZX';
  setLayer(root, LAYER.BOTH); scene.add(root);
  Object.assign(TURTLE, { root, head, legs, tail, wetU: wet });
  // start basking, turned three-quarters toward the opening view
  TURTLE.pos.copy(TURTLE.B);
  TURTLE.baskYaw = Math.atan2(-(5.3 - TURTLE.B.z), -0.24 - TURTLE.B.x) + 0.7;
  TURTLE.yaw = TURTLE.baskYaw;
}
// leg pose targets: [roll, yaw (outward/back sweep), pitch (tip up +)]
export function turtleLegPose(L, mode, ph, amt) {
  const s = L.s, v = L.cur;
  let roll = 0, yaw, pitch;
  if (mode === 'bask') {
    if (L.hind) { yaw = 2.5; pitch = -0.2; roll = -1.0; }             // hind legs stretched back, soles turned up
    else { yaw = 1.05; pitch = -0.28; roll = 0.15; }
  } else if (mode === 'walk') {
    const c = Math.cos(ph), sw = Math.max(0, Math.sin(ph));
    if (L.hind) { yaw = 2.1 + 0.35 * c; pitch = -0.42 + 0.3 * sw; roll = -0.2; }
    else { yaw = 0.95 - 0.38 * c; pitch = -0.5 + 0.3 * sw; roll = 0.15; }
  } else {                                                                 // swim: power stroke face-on, recovery feathered
    const c = Math.cos(ph), sn = Math.sin(ph), k = amt;
    if (L.hind) { yaw = 2.35 + 0.5 * c * k; pitch = -0.08 + 0.12 * sn * k; roll = -0.25 + 1.1 * Math.max(0, sn) * k; }
    else { yaw = 1.25 - 0.85 * c * k; pitch = 0.02 + 0.2 * sn * k; roll = 1.2 * Math.max(0, sn) * k; }
  }
  return [roll * s, -yaw * s, pitch];
}
export function turtleWaypoint() {
  for (let g = 0; g < 60; g++) {
    const x = rr(-2.6, 2.5), z = rr(-4.8, 4.8), sd = sdf(x, z);
    if (sd > -0.6 || Math.hypot(x - TURT_ROCK.x, z - TURT_ROCK.z) < 0.7 || Math.hypot(x - TURTLE.pos.x, z - TURTLE.pos.z) < 1.0) continue;
    const floor = pondDepth(x, z, -sd);
    TURTLE.wp.set(x, -Math.min(rr(0.22, 0.5), floor - 0.12), z); return;
  }
  TURTLE.wp.set(0, -0.35, 0);
}
export function updateTurtle(t, dt) {
  const T = TURTLE;
  if (!T.root || dt <= 0 || T.off) return;
  T.timer -= dt;
  const fx = Math.cos(T.yaw), fz = -Math.sin(T.yaw);
  let legMode = 'swim', stroke = 0, targetExt = 0.75, hPitch = 0, hYaw = 0, wantPitch = 0, wantRoll = 0;
  const onRock = (st) => st === 'walkDown' || st === 'climb' || st === 'turn' || st === 'turnDown' || (st === 'bask' && !T.settled);
  if (onRock(T.state)) {
    if (T.state === 'bask') T.settleT = (T.settleT || 0) + dt; else T.settleT = 0;
    if (T.settleT > 1.5) T.settled = true;
    // follow the rock surface under the shell; pitch / roll from the ground slope
    const hF = turtleRockHeight(T.pos.x + fx * 0.08, T.pos.z + fz * 0.08), hB = turtleRockHeight(T.pos.x - fx * 0.08, T.pos.z - fz * 0.08);
    const hR = turtleRockHeight(T.pos.x - fz * 0.06, T.pos.z + fx * 0.06), hL = turtleRockHeight(T.pos.x + fz * 0.06, T.pos.z - fx * 0.06);
    const valid = (h) => h > -1;
    const hc = Math.max(valid(hF) ? hF : -1, valid(hB) ? hB : -1, turtleRockHeight(T.pos.x, T.pos.z));
    if (valid(hF) && valid(hB)) wantPitch = Math.atan2(hF - hB, 0.16);
    if (valid(hL) && valid(hR)) wantRoll = Math.atan2(hL - hR, 0.12);
    const lift = T.state === 'bask' ? 0.0 : 0.01;
    const ty = (valid(hF) && valid(hB) ? (hF + hB) * 0.5 : hc) + lift - 0.003;
    T.pos.y = lerp(T.pos.y, Math.max(ty, hc - 0.02), 1 - Math.exp(-dt * 10));
  }
  if (T.state === 'bask') {
    legMode = 'bask'; targetExt = 1;
    T.wet = Math.max(0, T.wet - dt / 70);
    T.lookT -= dt;
    if (T.lookT < 0) { T.lookT = rr(2.5, 6); T.lookYaw = rr(-0.55, 0.55); T.lookPitch = rr(0.05, 0.35); }
    hYaw = T.lookYaw; hPitch = T.lookPitch;
    if (T.timer < 0) { T.state = 'turnDown'; T.settled = false; }
  }
  if (T.state === 'turnDown' || T.state === 'turn') {
    legMode = 'walk';
    const want = T.state === 'turnDown' ? Math.atan2(-T.rampDir.z, T.rampDir.x) : T.baskYaw;
    let dh = want - T.yaw; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    T.yaw += clamp(dh, -0.7 * dt, 0.7 * dt); T.gait += dt * 5;
    if (Math.abs(dh) < 0.03) {
      if (T.state === 'turnDown') T.state = 'walkDown';
      else { T.state = 'bask'; T.timer = rr(28, 45); }
    }
  }
  if (T.state === 'walkDown') {
    legMode = 'walk'; targetExt = 0.9; hPitch = -0.15;
    const v = 0.05;
    T.pos.x += fx * v * dt; T.pos.z += fz * v * dt; T.gait += dt * v * 110;
    if (T.pos.y < WATER_Y - 0.035 || turtleRockHeight(T.pos.x + fx * 0.1, T.pos.z + fz * 0.1) < -1) {
      T.state = 'dive'; T.timer = 1.6; T.speed = 0.22; T.wet = 1;
      if (typeof spawnSplash === 'function') spawnSplash(T.pos.x + fx * 0.05, T.pos.z + fz * 0.05, 0.9);
      addDrop(T.pos.x, T.pos.z, 0.14, -0.01); addDrop(T.pos.x + fx * 0.1, T.pos.z + fz * 0.1, 0.1, -0.006);
      splashAt(T.pos.x, WATER_Y, T.pos.z, 1.0);
      bubbleBurst(T.pos.x + fx * 0.05, WATER_Y - 0.04, T.pos.z + fz * 0.05, 70, 0.08, 0.0005, 0.006, 0.5);
      turtleWaypoint(); T.swimT = rr(32, 45); T.breathed = false;
    }
  }
  const inWater = T.state === 'dive' || T.state === 'swim' || T.state === 'surface' || T.state === 'return' || T.state === 'approach';
  if (inWater) {
    T.wet = 1;
    let target = T.wp, spd = 0.12, rise = 0;
    if (T.state === 'dive') { spd = 0.16; if (T.timer < 0) T.state = 'swim'; }
    if (T.state === 'swim') {
      T.swimT -= dt;
      if (Math.hypot(T.pos.x - T.wp.x, T.pos.z - T.wp.z) < 0.35) turtleWaypoint();
      if (!T.breathed && T.swimT < 18) { T.state = 'surface'; T.wp.set(T.pos.x + fx * 0.5, WATER_Y - 0.05, T.pos.z + fz * 0.5); T.timer = 9; }
      if (T.swimT < 0) T.state = 'return';
    }
    if (T.state === 'surface') {
      spd = 0.07; rise = 1;
      if (T.pos.y > WATER_Y - 0.075) { spd = 0.012; hPitch = 0.45; targetExt = 1; }
      else if (!T.exhaled && T.pos.y > WATER_Y - 0.2) { T.exhaled = true; bubbleBurst(T.pos.x + fx * 0.16, T.pos.y + 0.03, T.pos.z + fz * 0.16, 14, 0.01, 0.0008, 0.004, 0); }
      if (T.timer < 0) { T.breathed = true; T.exhaled = false; T.state = 'swim'; turtleWaypoint(); addDrop(T.pos.x + fx * 0.12, T.pos.z + fz * 0.12, 0.05, -0.003); }
    }
    if (T.state === 'return') {
      const D = T.rampDir;
      target = _tv1.set(T.E.x + D.x * 0.5, -0.12, T.E.z + D.z * 0.5);
      if (Math.hypot(T.pos.x - target.x, T.pos.z - target.z) < 0.12) T.state = 'approach';
    }
    if (T.state === 'approach') {
      target = _tv1.copy(T.E); spd = 0.07;
      if (Math.hypot(T.pos.x - T.E.x, T.pos.z - T.E.z) < 0.06) { T.state = 'climb'; addDrop(T.pos.x, T.pos.z, 0.08, -0.004); }
    }
    // steering: turn toward the target, avoid the banks, the bridge piers and the rock
    let dx = target.x - T.pos.x, dz = target.z - T.pos.z;
    const dl = Math.hypot(dx, dz) + 1e-4; dx /= dl; dz /= dl;
    const look = 0.35, lx = T.pos.x + fx * look, lz = T.pos.z + fz * look, sd = sdf(lx, lz);
    if (sd > -0.55) { const e = 0.03, gx = (sdf(lx + e, lz) - sdf(lx - e, lz)) / (2 * e), gz = (sdf(lx, lz + e) - sdf(lx, lz - e)) / (2 * e); dx -= gx * (sd + 0.55) * 5; dz -= gz * (sd + 0.55) * 5; }
    const avoid = T.state === 'approach' || T.state === 'return' ? [] : (WORLD.obstacles || []);
    for (const o of avoid.concat([{ x: -1.15, z: BRIDGE.z, r: 0.5 }, { x: 1.15, z: BRIDGE.z, r: 0.5 }])) {
      const ox = T.pos.x - o.x, oz = T.pos.z - o.z, d = Math.hypot(ox, oz); if (d < o.r + 0.3) { dx += ox / d * (o.r + 0.3 - d) * 4; dz += oz / d * (o.r + 0.3 - d) * 4; }
    }
    let dh = Math.atan2(-dz, dx) - T.yaw; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    T.yaw += clamp(dh * 1.2, -0.75, 0.75) * dt;
    T.speed = lerp(T.speed, spd * (0.55 + 0.45 * Math.cos(clamp(dh, -1.5, 1.5))), 1 - Math.exp(-dt * 1.5));
    T.pos.x += fx * T.speed * dt; T.pos.z += fz * T.speed * dt;
    const floor = -pondDepth(T.pos.x, T.pos.z, Math.max(0.01, -sdf(T.pos.x, T.pos.z))) + 0.05;
    const ty = Math.max(floor, target.y), vy = clamp((ty - T.pos.y) * 0.8, -0.06, rise ? 0.07 : 0.05);
    T.pos.y = Math.min(T.pos.y + vy * dt, WATER_Y - 0.055);
    wantPitch = clamp(Math.atan2(vy, Math.max(T.speed, 0.05)) * 0.8, -0.5, 0.5); wantRoll = clamp(-dh * 0.4, -0.3, 0.3);
    stroke = clamp(T.speed / 0.12, 0.25, 1.2);
    T.gait += dt * (2.2 + 4.5 * stroke);
    if (T.state !== 'surface') { hYaw = Math.sin(t * 0.4) * 0.15; hPitch = -wantPitch * 0.4; }
  }
  if (T.state === 'climb') {
    legMode = 'walk'; targetExt = 0.95; hPitch = 0.1;
    const bx = T.B.x - T.pos.x, bz = T.B.z - T.pos.z, bd = Math.hypot(bx, bz);
    let dh = Math.atan2(-bz, bx) - T.yaw; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    T.yaw += clamp(dh, -0.8 * dt, 0.8 * dt);
    const v = 0.035; T.pos.x += fx * v * dt; T.pos.z += fz * v * dt; T.gait += dt * v * 120;
    if (T.pos.y > WATER_Y + 0.005 && rand() < dt * 3) addDrop(T.pos.x - fx * 0.1, T.pos.z - fz * 0.1, 0.03, -0.0015);   // dripping
    if (bd < 0.02) { T.state = 'turn'; }
  }
  // pose the body
  T.pitch = lerp(T.pitch, wantPitch, 1 - Math.exp(-dt * 4)); T.roll = lerp(T.roll, wantRoll, 1 - Math.exp(-dt * 4));
  const bob = legMode === 'walk' ? Math.abs(Math.sin(T.gait)) * 0.003 : legMode === 'swim' ? Math.sin(T.gait * 2) * 0.002 * stroke : 0;
  T.root.position.set(T.pos.x, T.pos.y + bob, T.pos.z);
  T.root.rotation.set(T.roll, T.yaw, T.pitch);
  // limbs: ease toward the pose target so state changes never pop
  for (const L of T.legs) {
    const [r, y, p] = turtleLegPose(L, legMode, T.gait + L.phase, stroke);
    const k = 1 - Math.exp(-dt * (legMode === 'bask' ? 2.5 : 12));
    L.cur.x = lerp(L.cur.x, r, k); L.cur.y = lerp(L.cur.y, y, k); L.cur.z = lerp(L.cur.z, p, k);
    L.g.rotation.set(L.cur.x, L.cur.y, L.cur.z);
  }
  T.ext = lerp(T.ext, targetExt, 1 - Math.exp(-dt * 2));
  T.headYaw = lerp(T.headYaw, hYaw, 1 - Math.exp(-dt * 1.8)); T.headPitch = lerp(T.headPitch, hPitch, 1 - Math.exp(-dt * 1.8));
  T.head.position.set(TURT_PIV.head[0] + (T.ext - 0.75) * 0.04, TURT_PIV.head[1] + T.headPitch * 0.006, 0);
  T.head.rotation.set(0, T.headYaw, T.headPitch, 'YZX');
  T.tail.rotation.set(0, Math.PI + Math.sin(T.gait * 0.5) * 0.25 * (legMode === 'bask' ? 0.1 : 1), -0.15);
  T.wetU.value = lerp(T.wetU.value, T.wet, 1 - Math.exp(-dt * 3));
}
const _tv1 = new THREE.Vector3();

/* ------------------------------------------------------------------ 9f. FALLING CHERRY PETALS */
// Petals let go from the cherry crowns, flutter down tumbling on the breeze, then settle: on the pond they float
// and drift with the waves for a while before sinking; on land they rest on the grass. Airborne petals are
// mirrored in the water; settled ones use the surface layer (never mirrored).
