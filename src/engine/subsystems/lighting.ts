// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER, KOI_MAX } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets } from "../geometry";
import { $, progress, toast } from "../state";
import { setMaxAnisotropy } from "./textures";
import { WX } from "./weather";
export const SHADOW = { frame: 0, dirty: true };
/* ------------------------------------------------------------------ 4. RENDERER, SKY, SUN, ENVIRONMENT */
function getOrCreateCanvas(): HTMLCanvasElement {
  if (typeof document !== 'undefined') {
    let c = document.getElementById('c') as HTMLCanvasElement | null;
    if (!c) {
      c = document.createElement('canvas');
      c.id = 'c';
    }
    return c;
  }
  return null as any;
}

export const canvas: HTMLCanvasElement = getOrCreateCanvas();
export const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
});
export const RES = { scale: 1 };   // adaptive resolution multiplier (1 .. 0.6)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
const _w = typeof window !== "undefined" ? window.innerWidth : 800; const _h = typeof window !== "undefined" ? window.innerHeight : 600;
renderer.setSize(_w, _h, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;              // ACES is applied in our own composite pass
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;                   // updated once per frame, not once per pass
setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(52, (typeof window !== "undefined" ? window.innerWidth / window.innerHeight : 1.33), 0.02, 260);   // close near plane for macro shots
camera.position.set(-0.6, 0.4, 5.3);

// One global clip plane is always bound (a no-op in the main pass) so programs never recompile between passes.
export const CLIP_NONE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e4);
export const CLIP_KEEP_ABOVE = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y + 0.02);
export const CLIP_KEEP_BELOW = new THREE.Plane(new THREE.Vector3(0, -1, 0), WATER_Y + 0.04);
renderer.clippingPlanes = [CLIP_NONE];

// Shared uniforms referenced (not copied) by every patched material
export { KOI_MAX };                   // koi shadow slots in every underwater shader (the roster must fit)
export const SH = {
  uTime: { value: 0 },
  uWaterY: { value: WATER_Y },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunDirW: { value: new THREE.Vector3(0, 1, 0) },      // refracted sun direction below the surface
  uSunColor: { value: new THREE.Color() },              // colour * intensity
  uAbsorb: { value: new THREE.Vector3(0.35, 0.08, 0.04) },
  uScatter: { value: 0.04 },
  uInscatter: { value: new THREE.Color() },
  uCamUnder: { value: 0 },
  tCaustics: { value: null },
  uCausticStr: { value: 1 },
  uCausticNorm: { value: 1 },
  uWindDir: { value: new THREE.Vector2(1, 0) },
  uWind: { value: 0.35 },
  uGust: { value: 0 },
  uWavesS: { value: null },          // set to WAVES once built: floating objects follow the same surface
  tRippleS: { value: null },
  uSimS: { value: new THREE.Vector4() },
  // weather (section 13e)
  uSnowCover: { value: 0 }, uWet: { value: 0 }, uAutumn: { value: 0 }, uFogDensity: { value: 0.004 }, uFogColor: { value: new THREE.Color(0.5, 0.58, 0.68) },
  uRain: { value: 0 }, uIce: { value: 0 },
  // koi silhouettes for their soft underwater shadows (section 11): xyz + size, heading * girth + tail swing
  uKoiA: { value: Array.from({ length: KOI_MAX }, () => new THREE.Vector4()) },
  uKoiB: { value: Array.from({ length: KOI_MAX }, () => new THREE.Vector4()) },
};

/* --- Sky: Preetham analytic daylight (after three.js examples/Sky.js, MIT) + procedural FBM cloud deck */
export const SKY_VS = /* glsl */`
uniform vec3 sunPosition;
uniform float rayleigh;
uniform float turbidity;
uniform float mieCoefficient;
uniform vec3 up;
varying vec3 vWorldPosition;
varying vec3 vSunDirection;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
const float e = 2.71828182845904523536028747135266249775724709369995957;
const float pi = 3.141592653589793238462643383279502884197169;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;
float sunIntensity( float zenithAngleCos ) {
  zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
  return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
}
vec3 totalMie( float T ) {
  float c = ( 0.2 * T ) * 10E-18;
  return 0.434 * c * MieConst;
}
void main() {
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position.z = gl_Position.w; // pin to the far plane
  vSunDirection = normalize( sunPosition );
  vSunE = sunIntensity( dot( vSunDirection, up ) );
  vSunfade = 1.0 - clamp( 1.0 - exp( ( sunPosition.y / 450000.0 ) ), 0.0, 1.0 );
  float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );
  vBetaR = totalRayleigh * rayleighCoefficient;
  vBetaM = totalMie( turbidity ) * mieCoefficient;
}`;
export const SKY_FS = /* glsl */`
varying vec3 vWorldPosition;
varying vec3 vSunDirection;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
uniform float mieDirectionalG;
uniform vec3 up;
uniform float uSkyScale;
uniform float uSunDisk;
uniform float uTime;
uniform float uCloudCover;
uniform float uCloudBright;
uniform float uOvercast;
uniform vec3 uOvercastCol;
const float pi = 3.141592653589793238462643383279502884197169;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.99995;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;
float rayleighPhase( float cosTheta ) { return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) ); }
float hgPhase( float cosTheta, float g ) {
  float g2 = pow( g, 2.0 );
  float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
  return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
}
// value-noise FBM for the cloud deck
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+1.0), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  vec3 direction = normalize( vWorldPosition - cameraPosition );
  float zenithAngle = acos( max( 0.0, dot( up, direction ) ) );
  float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
  float sR = rayleighZenithLength * inverse;
  float sM = mieZenithLength * inverse;
  vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );
  float cosTheta = dot( direction, vSunDirection );
  float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
  vec3 betaRTheta = vBetaR * rPhase;
  float mPhase = hgPhase( cosTheta, mieDirectionalG );
  vec3 betaMTheta = vBetaM * mPhase;
  vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
  Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 1.0 / 2.0 ) ), clamp( pow( 1.0 - dot( up, vSunDirection ), 5.0 ), 0.0, 1.0 ) );
  vec3 L0 = vec3( 0.1 ) * Fex;
  float sundisk = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta );
  L0 += ( vSunE * 19000.0 * Fex ) * sundisk * uSunDisk * (1.0 - uOvercast);
  vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );
  vec3 col = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );
  // Preetham's gamma-like compression washes the blue out; restore saturation away from the sun disc
  float skyL = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(skyL), col, 1.9), vec3(0.0)) * (1.0 - sundisk) + col * sundisk;

  // Cloud deck: FBM on a plane, lit brighter toward the sun, soft self-shadowed interiors
  if (direction.y > 0.0) {
    vec2 cp = direction.xz / (direction.y + 0.1) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
    float n = fbm(cp);
    float cov = smoothstep(0.58 - uCloudCover * 0.2, 0.74, n) * smoothstep(0.0, 0.12, direction.y);
    // crude self-shadowing: sample the deck a little toward the sun; denser there -> darker base
    float toward = fbm(cp + vSunDirection.xz * 0.12);
    float shade = clamp(1.0 - (toward - n) * 4.0, 0.35, 1.0);
    float silver = pow(max(cosTheta, 0.0), 8.0);
    vec3 cloudCol = vec3(1.0, 0.985, 0.96) * uCloudBright * (mix(0.55, 1.05, shade) + silver * 0.9);
    col = mix(col, cloudCol, cov);
  }
  // Below the horizon: fade to a dim ground bounce so the IBL has a sensible lower hemisphere
  // overcast: a flat, soft grey deck, a little brighter overhead
  col = mix(col, uOvercastCol * (0.85 + 0.3 * smoothstep(0.0, 0.8, direction.y)) * (0.92 + 0.08 * fbm(direction.xz / (direction.y + 0.2) * 2.0 + uTime * 0.004)), uOvercast * smoothstep(-0.1, 0.12, direction.y));
  float below = smoothstep(0.0, -0.25, direction.y);
  col = mix(col, vec3(0.03, 0.034, 0.02) * uCloudBright, below);
  gl_FragColor = vec4( col * uSkyScale, 1.0 );
}`;
export const skyUniforms = {
  sunPosition: { value: new THREE.Vector3(0, 1, 0) },
  turbidity: { value: 2.0 }, rayleigh: { value: 2.1 }, mieCoefficient: { value: 0.003 }, mieDirectionalG: { value: 0.8 },
  up: { value: new THREE.Vector3(0, 1, 0) },
  uSkyScale: { value: 0.34 }, uSunDisk: { value: 1.0 }, uTime: SH.uTime,
  uCloudCover: { value: 0.55 }, uCloudBright: { value: 1.0 }, uOvercast: { value: 0 }, uOvercastCol: { value: new THREE.Color(1, 1, 1) },
};
const skyMat = new THREE.ShaderMaterial({ name: 'Sky', uniforms: skyUniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false });
const skyGeo = new THREE.BoxGeometry(1, 1, 1);
const sky = new THREE.Mesh(skyGeo, skyMat);
sky.scale.setScalar(900); sky.frustumCulled = false; sky.renderOrder = -10;
setLayer(sky, LAYER.SKY); scene.add(sky);

// Sun & fill
export const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.00025;
sun.shadow.normalBias = 0.025;
{
  const c = sun.shadow.camera; c.left = -13; c.right = 13; c.top = 13; c.bottom = -13; c.near = 1; c.far = 90;
}
sun.target.position.set(0, 0, -1.5);
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0x9cc4ef, 0x4b5a2c, 0.28);
scene.add(hemi);

// Kelvin -> sRGB (Tanner Helland fit)
export function kelvinToRGB(k) {
  const t = k / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
}

// Environment: sky rendered to a cube (no sun disc — the DirectionalLight carries the sun), then PMREM for IBL.
export const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const cubeCam = new THREE.CubeCamera(0.1, 1000, cubeRT);
const skyScene = new THREE.Scene();
{ const s2 = new THREE.Mesh(skyGeo, skyMat); s2.scale.setScalar(900); s2.frustumCulled = false; skyScene.add(s2); }
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
export let envDirty = true;
export let envTimer = 0;
export function setEnvDirty(v = true) { envDirty = v; }
export function updateEnv() {
  const prevClip = renderer.clippingPlanes; renderer.clippingPlanes = [];
  skyUniforms.uSunDisk.value = 0;
  cubeCam.update(renderer, skyScene);
  const rt = pmrem.fromCubemap(cubeRT.texture);
  if (envRT) envRT.dispose();
  envRT = rt; scene.environment = envRT.texture;
  skyUniforms.uSunDisk.value = 1;
  renderer.clippingPlanes = prevClip;
  envDirty = false;
}

export const sunState = { elev: 0, intensity: 0 };
export function updateSun() {
  const f = clamp((P.timeOfDay - 6) / 13, 0, 1);
  const elev = Math.max(0.6 * DEG, Math.sin(Math.PI * f) * 62 * DEG);
  const az = (90 - 180 * f + P.sunAzimuth) * DEG;
  const d = new THREE.Vector3(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)).normalize();
  const K = lerp(2600, 5500, smoothstep(1 * DEG, 32 * DEG, elev));
  const [r, g, b] = kelvinToRGB(K);
  const inten = 3.3 * smoothstep(-0.5 * DEG, 14 * DEG, elev) * WX.cur.sunMul;
  sun.color.setRGB(r, g, b, THREE.SRGBColorSpace);
  sun.intensity = inten;
  sun.position.copy(d).multiplyScalar(45).add(sun.target.position);
  skyUniforms.sunPosition.value.copy(d);
  skyUniforms.uCloudBright.value = (0.3 + 1.5 * smoothstep(0, 40 * DEG, elev)) * WX.cur.cloudBright;
  SH.uSunDir.value.copy(d);
  SH.uSunColor.value.copy(sun.color).multiplyScalar(inten);
  // Snell: refracted sun direction under water (pointing up toward the sun)
  const sinT = Math.cos(elev) / 1.333, cosT = Math.sqrt(1 - sinT * sinT);
  const hx = d.x, hz = d.z, hl = Math.hypot(hx, hz) || 1;
  SH.uSunDirW.value.set((hx / hl) * sinT, cosT, (hz / hl) * sinT);
  hemi.intensity = (0.1 + 0.22 * smoothstep(0, 30 * DEG, elev)) * WX.cur.hemiMul;
  sunState.elev = elev; sunState.intensity = inten;
  envDirty = true;
  if (typeof SHADOW !== 'undefined') SHADOW.dirty = true;
}

