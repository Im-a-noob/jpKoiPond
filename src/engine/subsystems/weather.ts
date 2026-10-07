// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets } from "../geometry";
import { $, progress, toast } from "../state";
import { WORLD, sdf } from "./terrain";
import { skyUniforms, updateSun, SH, scene, camera, setEnvDirty, SHADOW } from "./lighting";
import { updateWaves } from "./waterSurface";
import { compositePass } from "./postprocessing";
import { TEX } from "./textures";
import { PETALS } from "./petals";
import { SAKURA } from "./fallingPetals";
import { DRAGON } from "./dragonflies";
import { TURTLE } from "./turtle";
import { STATE, RT } from "../state";
import { addDrop } from "./waterRipples";
import { GUI_CTRL, setBtnLabel } from "./controls";
/* ------------------------------------------------------------------ 13e. WEATHER & SEASONS */
// Four moods, blended over a few seconds: a clear spring day; a June rain (tsuyu: overcast light, wet dark stone and
// glossy puddle sheen, rain streaks, drop rings all over the pond, mist, rain on leaves and water); autumn (low golden
// sun, deciduous foliage turning red / orange / gold, falling leaves instead of petals, warm haze, red dragonflies,
// spider lilies); winter (pale overcast, snow falling and settling on every upward surface, ice sheets creeping out
// from the banks, bare deciduous trees, camellias in bloom, the turtle and frog hibernating, koi slow and deep).
export const WX_PRESETS = {
  Sunny:  { tod: 10.5, cloud: 0.55, turb: 2.0, skyScale: 0.34, cloudBright: 1.0, overcast: 0.0, sunMul: 1.0, hemiMul: 1.0, fog: 0.004, fogCol: [0.5, 0.58, 0.68], rain: 0, wet: 0, snow: 0, cover: 0, autumn: 0, ice: 0, wind: 0.35, expo: 0.9, grade: [1.035, 1.0, 0.955] },
  Rain:   { tod: 13.0, cloud: 1.0, turb: 6.0, skyScale: 0.22, cloudBright: 0.52, overcast: 0.85, sunMul: 0.1, hemiMul: 2.1, fog: 0.02, fogCol: [0.2, 0.225, 0.25], rain: 1, wet: 1, snow: 0, cover: 0, autumn: 0, ice: 0, wind: 0.55, expo: 1.15, grade: [0.97, 1.0, 1.03] },
  Autumn: { tod: 15.7, cloud: 0.42, turb: 4.5, skyScale: 0.34, cloudBright: 1.05, overcast: 0.0, sunMul: 0.95, hemiMul: 1.0, fog: 0.013, fogCol: [0.62, 0.52, 0.4], rain: 0, wet: 0, snow: 0, cover: 0, autumn: 1, ice: 0, wind: 0.45, expo: 0.95, grade: [1.07, 1.0, 0.9] },
  Winter: { tod: 11.5, cloud: 0.95, turb: 3.0, skyScale: 0.3, cloudBright: 0.95, overcast: 0.7, sunMul: 0.3, hemiMul: 1.9, fog: 0.024, fogCol: [0.56, 0.6, 0.66], rain: 0, wet: 0, snow: 1, cover: 1, autumn: 0.75, ice: 1, wind: 0.2, expo: 1.0, grade: [0.95, 1.0, 1.06] },
};
export const WX = { name: 'Sunny', cur: JSON.parse(JSON.stringify(WX_PRESETS.Sunny)), from: null, t: 1, applied: 'Sunny' };
export const WX_LETTER = { Sunny: 'S', Rain: 'R', Autumn: 'A', Winter: 'W' };
export function seasonal(o, seasons) { if (o) WORLD.seasonal.push({ o, s: seasons }); return o; }
export function setWeather(name) {
  if (!WX_PRESETS[name]) return;
  WX.from = JSON.parse(JSON.stringify(WX.cur)); WX.name = name; WX.t = 0; P.weather = name;
  if (GUI_CTRL.weather) GUI_CTRL.weather.updateDisplay();
  setBtnLabel('tb-weather', name); const b = $('tb-weather'); if (b) b.title = 'Weather: ' + name + ' · change the season (T)';
  toast({ Sunny: 'Sunny spring day', Rain: 'Rain (tsuyu)', Autumn: 'Autumn colours', Winter: 'Winter: snowfall' }[name]);
}
export function cycleWeather() { const k = Object.keys(WX_PRESETS); setWeather(k[(k.indexOf(WX.name) + 1) % k.length]); }
export function updateWeather(dt) {
  if (WX.t < 1 && WX.from) {
    WX.t = Math.min(1, WX.t + dt / 4);
    const k = smoothstep(0, 1, WX.t), to = WX_PRESETS[WX.name];
    for (const key in to) {
      if (Array.isArray(to[key])) WX.cur[key] = to[key].map((v, i) => lerp(WX.from[key][i], v, k));
      else WX.cur[key] = lerp(WX.from[key], to[key], k);
    }
    if (WX.t >= 0.5 && WX.applied !== WX.name) applySeason(WX.name);
    applyWeather();
  }
}
export function applyWeather() {
  const c = WX.cur;
  P.timeOfDay = c.tod; P.windSpeed = c.wind; P.exposure = c.expo;
  skyUniforms.uCloudCover.value = c.cloud; skyUniforms.turbidity.value = c.turb; skyUniforms.uSkyScale.value = c.skyScale;
  skyUniforms.uOvercast.value = c.overcast; skyUniforms.uOvercastCol.value.setRGB(c.fogCol[0] / c.skyScale, c.fogCol[1] / c.skyScale, c.fogCol[2] / c.skyScale);
  updateSun(); updateWaves();
  SH.uSnowCover.value = c.cover; SH.uWet.value = c.wet; SH.uAutumn.value = c.autumn; SH.uFogDensity.value = c.fog; SH.uFogColor.value.setRGB(...c.fogCol);
  SH.uRain.value = c.rain; SH.uIce.value = c.ice;
  if (compositePass) compositePass.uniforms.uGrade.value.set(...c.grade);
  for (const k of ['time', 'wind', 'expo']) if (GUI_CTRL[k]) GUI_CTRL[k].updateDisplay();
}
export function applySeason(name) {
  WX.applied = name;
  const L = WX_LETTER[name], spring = L === 'S' || L === 'R', autumn = L === 'A', winter = L === 'W';
  for (const e of WORLD.seasonal) e.o.visible = e.s.includes(L);
  // cherry crowns: blossom in spring, turning foliage in autumn, bare in winter
  const sk = WORLD.leafMesh && WORLD.leafMesh.sakura;
  if (sk) { const tex = autumn ? TEX.greenLeaves : TEX.sakura; sk.material.map = tex; sk.customDepthMaterial.map = tex; sk.material.userData.uniforms.uDecid.value = autumn ? 1 : 0; }
  const hy = WORLD.leafMesh && WORLD.leafMesh.hydrangea;
  if (hy) hy.material.color.setRGB(...(autumn ? [0.78, 0.62, 0.5] : [1, 1, 1]));          // dried 'antique' heads in autumn
  for (const m of WORLD.bloomMats || []) m.userData.uniforms.uBloom.value = spring ? 1 : 0;
  if (PETALS.mesh) { PETALS.mesh.visible = !winter; PETALS.mesh.material.color.setRGB(...(autumn ? [1.0, 0.5, 0.25] : [1, 1, 1])); }
  if (SAKURA.air) {
    SAKURA.air.visible = SAKURA.rest.visible = !winter; SAKURA.off = winter;
    const tex = autumn ? SAKURA.leafTex : SAKURA.petalTex; SAKURA.air.material.map = tex;
    SAKURA.scale = autumn ? 2.4 : 1;
    const warm = [[0.85, 0.2, 0.08], [0.95, 0.45, 0.1], [0.9, 0.65, 0.15], [0.7, 0.15, 0.1]];
    for (let i = 0; i < SAKURA.n; i++) { const w = warm[i % 4]; SAKURA.air.setColorAt(i, autumn ? new THREE.Color(...w) : new THREE.Color(1, 1, 1)); SAKURA.rest.setColorAt(i, autumn ? new THREE.Color(...w) : new THREE.Color(1, 1, 1)); }
    SAKURA.air.instanceColor.needsUpdate = SAKURA.rest.instanceColor.needsUpdate = true;
  }
  DRAGON.off = !(L === 'S' || L === 'A');
  for (const D of DRAGON.list) D.root.visible = !DRAGON.off;
  if (TURTLE.root) { TURTLE.off = winter; TURTLE.root.visible = !winter; }
  setEnvDirty(true); SHADOW.dirty = true;
}

// --- precipitation: rain streaks (line segments) and snowflakes (soft points), in a box that follows the camera
export const PRECIP = { nR: 3200, nS: 6500, rain: null, snow: null, R: [], S: [] };
export const SNOW_VS = /* glsl */`
attribute float aSize;
uniform float uScale;
varying float vFade;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1); vFade = smoothstep(0.15, 0.6, -mv.z) * (1.0 - smoothstep(9.0, 12.0, -mv.z)); }`;
export const SNOW_FS = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.12, d) * uOpacity * vFade; if (a < 0.01) discard; gl_FragColor = vec4(uColor, a); }`;
export function buildPrecip() {
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRECIP.nR * 6), 3));
  PRECIP.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  const sg = new THREE.BufferGeometry(), sz = new Float32Array(PRECIP.nS);
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRECIP.nS * 3), 3));
  for (let i = 0; i < PRECIP.nS; i++) sz[i] = rr(0.016, 0.045);
  sg.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  PRECIP.snow = new THREE.Points(sg, new THREE.ShaderMaterial({ vertexShader: SNOW_VS, fragmentShader: SNOW_FS, transparent: true, depthWrite: false,
    uniforms: { uScale: { value: 600 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0 } } }));
  for (const m of [PRECIP.rain, PRECIP.snow]) { m.frustumCulled = false; setLayer(m, LAYER.SURFACE); scene.add(m); }
  for (let i = 0; i < PRECIP.nR; i++) PRECIP.R.push(new THREE.Vector3(rr(-8, 8), rr(-4, 7), rr(-8, 8)));
  for (let i = 0; i < PRECIP.nS; i++) PRECIP.S.push({ p: new THREE.Vector3(rr(-7, 7), rr(-4, 6), rr(-7, 7)), ph: rand() * 6.28, v: rr(0.55, 1.0) });
}
export function updatePrecip(t, dt) {
  if (!PRECIP.rain) return;
  const c = WX.cur, cam = camera.position, wx = SH.uWindDir.value.x * P.windSpeed, wz = SH.uWindDir.value.y * P.windSpeed;
  const wrap = (p, R, H) => {                               // keep every particle in a box around the camera
    if (p.x - cam.x > R) p.x -= 2 * R; else if (p.x - cam.x < -R) p.x += 2 * R;
    if (p.z - cam.z > R) p.z -= 2 * R; else if (p.z - cam.z < -R) p.z += 2 * R;
    if (p.y < Math.max(WATER_Y, cam.y - 5)) { p.y = cam.y + H * (0.6 + rand() * 0.4); p.x = cam.x + rr(-R, R); p.z = cam.z + rr(-R, R); }
    if (p.y > cam.y + H) p.y -= H;
  };
  const light = 0.6 + 0.5 * (SH.uSunColor.value.r + SH.uSunColor.value.g) * 0.2 + WX.cur.hemiMul * 0.2;
  // rain
  const rOn = c.rain > 0.01 && !STATE.under;
  PRECIP.rain.visible = rOn;
  if (rOn) {
    const n = Math.floor(PRECIP.nR * c.rain), a = PRECIP.rain.geometry.attributes.position.array, vy = 6.5, sx = wx * 1.8, sz = wz * 1.8;
    for (let i = 0; i < n; i++) {
      const p = PRECIP.R[i]; if (dt > 0) { p.y -= vy * dt; p.x += sx * dt; p.z += sz * dt; } wrap(p, 8, 7);
      const k = i * 6; a[k] = p.x; a[k + 1] = p.y; a[k + 2] = p.z; a[k + 3] = p.x - sx * 0.035; a[k + 4] = p.y + vy * 0.035; a[k + 5] = p.z - sz * 0.035;
    }
    PRECIP.rain.geometry.setDrawRange(0, n * 2); PRECIP.rain.geometry.attributes.position.needsUpdate = true;
    PRECIP.rain.material.opacity = 0.3 * c.rain; PRECIP.rain.material.color.setRGB(0.5 * light, 0.55 * light, 0.6 * light);
    // a few heavier drops leave proper ripples in the simulation too
    if (dt > 0 && rand() < dt * 6 * c.rain) { const x = cam.x + rr(-5, 5), z = cam.z + rr(-6, 3); if (sdf(x, z) < -0.1) addDrop(x, z, 0.05, -0.0015); }
  }
  // snow
  const sOn = c.snow > 0.01 && !STATE.under;
  PRECIP.snow.visible = sOn;
  if (sOn) {
    const n = Math.floor(PRECIP.nS * c.snow), a = PRECIP.snow.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const q = PRECIP.S[i], p = q.p;
      if (dt > 0) { p.y -= q.v * dt; p.x += (wx * 0.6 + Math.sin(t * 0.9 + q.ph) * 0.25) * dt; p.z += (wz * 0.6 + Math.cos(t * 0.7 + q.ph * 1.3) * 0.25) * dt; }
      wrap(p, 7, 6);
      a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
    }
    PRECIP.snow.geometry.setDrawRange(0, n); PRECIP.snow.geometry.attributes.position.needsUpdate = true;
    const u = PRECIP.snow.material.uniforms; u.uOpacity.value = 0.85 * c.snow; u.uColor.value.setRGB(0.95 * light, 0.97 * light, 1.0 * light);
    u.uScale.value = RT.h * 0.55;
  }
}

