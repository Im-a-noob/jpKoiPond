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
import { waterHeightAt } from "./water";
import { randDir } from "./trees";
import { sdfGx, sdfGz, ground } from "./terrain";
import { addDrop } from "./water";

export const SAKURA = { spawn: [], list: [], air: null, rest: null, n: 320 };
export function buildFallingPetals() {
  if (!SAKURA.spawn.length) return;
  const cv = makeCanvas(64, 64), g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 58, 2, 32, 28, 34); grd.addColorStop(0, '#f4a8c0'); grd.addColorStop(0.35, '#fcdde6'); grd.addColorStop(1, '#fff4f7');
  g.fillStyle = grd; g.beginPath(); g.moveTo(32, 62); g.bezierCurveTo(60, 46, 62, 12, 42, 3); g.lineTo(32, 11); g.lineTo(22, 3); g.bezierCurveTo(2, 12, 4, 46, 32, 62); g.fill();
  g.strokeStyle = 'rgba(230,150,175,0.35)'; g.lineWidth = 0.7;
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(32, 60); g.quadraticCurveTo(32 + i * 5, 34, 32 + i * 7, 10); g.stroke(); }
  const tex = canvasTex(cv);
  // autumn: a palmate maple leaf, tinted per instance
  const lc = makeCanvas(64, 64), lg = lc.getContext('2d'); lg.fillStyle = '#ffffff'; lg.beginPath();
  for (let i = 0; i <= 90; i++) { const a = (i / 90) * Math.PI * 2, lobe = Math.pow(Math.abs(Math.cos(a * 3.5)), 0.6), r = 29 * (0.32 + 0.68 * lobe) * (a > Math.PI * 0.8 && a < Math.PI * 1.2 ? 0.5 : 1); lg.lineTo(32 + Math.sin(a) * r, 32 - Math.cos(a) * r); }
  lg.fill(); lg.strokeStyle = 'rgba(80,30,10,0.45)'; for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; lg.beginPath(); lg.moveTo(32, 32); lg.lineTo(32 + Math.sin(a) * 25, 32 - Math.cos(a) * 25); lg.stroke(); }
  SAKURA.petalTex = tex; SAKURA.leafTex = canvasTex(lc); SAKURA.scale = 1;
  const mat = physical({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, sheen: 0.7, sheenColor: new THREE.Color(0xffe4ec), envMapIntensity: 0.6 },
    { key: 'sakurapetal', leaf: true, uniforms: { uTransl: { value: 0.85 } } });
  const geo = new THREE.PlaneGeometry(0.016, 0.018, 2, 2); geo.rotateX(-Math.PI / 2);
  const gp = geo.attributes.position; for (let i = 0; i < gp.count; i++) gp.setY(i, 1.6 * (gp.getX(i) ** 2 + gp.getZ(i) ** 2));   // gently cupped
  geo.computeVertexNormals();
  SAKURA.air = new THREE.InstancedMesh(geo, mat, SAKURA.n); SAKURA.rest = new THREE.InstancedMesh(geo, mat, SAKURA.n);
  for (const m of [SAKURA.air, SAKURA.rest]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.receiveShadow = true; }
  SAKURA.air.castShadow = true;
  for (let i = 0; i < SAKURA.n; i++) { SAKURA.air.setColorAt(i, new THREE.Color(1, 1, 1)); SAKURA.rest.setColorAt(i, new THREE.Color(1, 1, 1)); }
  setLayer(SAKURA.air, LAYER.ABOVE); setLayer(SAKURA.rest, LAYER.SURFACE); scene.add(SAKURA.air, SAKURA.rest);
  for (let i = 0; i < SAKURA.n; i++) {
    const q = { p: new THREE.Vector3(), v: new THREE.Vector3(), axis: randDir(), ang: rand() * 6.28, spin: rr(3, 8), ph: rand() * 6.28, s: rr(0.8, 1.25), state: 0, t: 0, yaw: 0 };
    petalRespawn(q);
    // pre-age so the garden already has petals in the air, on the water and on the grass
    const r = rand();
    if (r < 0.45) q.p.y -= rr(0, Math.max(0.1, q.p.y - 0.3));
    else {
      if (r < 0.8) {                                   // already afloat: somewhere on the pond off the tree's shore
        const k = sdf(q.p.x, q.p.z) + rr(0.3, 1.6);
        q.p.x -= sdfGx(q.p.x, q.p.z) * k; q.p.z -= sdfGz(q.p.x, q.p.z) * k;
      }
      settlePetal(q, rr(0, 1));
    }
    SAKURA.list.push(q);
  }
}
export function petalRespawn(q) {
  const s = SAKURA.spawn[(rand() * SAKURA.spawn.length) | 0];
  q.p.set(s.x + rr(-0.25, 0.25), s.y + rr(-0.15, 0.1), s.z + rr(-0.25, 0.25)); q.v.set(0, 0, 0);
  q.state = 0; q.t = 0; q.axis.copy(randDir()); q.spin = rr(3, 8);
}
export function settlePetal(q, age) {
  const sd = sdf(q.p.x, q.p.z);
  q.state = sd < -0.05 ? 1 : 2;                       // 1 floating on the pond, 2 resting on land
  q.life = q.state === 1 ? rr(35, 60) : rr(18, 35); q.t = age * q.life; q.yaw = rand() * 6.28; q.tilt = rr(-0.25, 0.25);
  if (q.state === 2) q.p.y = ground(q.p.x, q.p.z) + 0.004;
}
const _sm4 = new THREE.Matrix4(), _sq4 = new THREE.Quaternion(), _sq5 = new THREE.Quaternion(), _ss4 = new THREE.Vector3(), _se4 = new THREE.Euler();
export const _ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
export function updateFallingPetals(t, dt) {
  if (!SAKURA.air || dt <= 0 || SAKURA.off) return;
  const wind = P.windSpeed, wx = SH.uWindDir.value.x, wz = SH.uWindDir.value.y, gust = 0.6 + SH.uGust.value;
  for (let i = 0; i < SAKURA.n; i++) {
    const q = SAKURA.list[i];
    if (q.state === 0) {
      // flutter: sinking at ~0.3 m/s with a side-slip that follows the tumble, carried by the breeze
      const flutter = Math.sin(t * 2.3 + q.ph), sway = Math.cos(t * 1.7 + q.ph * 1.3);
      q.v.x = lerp(q.v.x, wx * wind * 0.35 * gust + sway * 0.14, 1 - Math.exp(-dt * 2));
      q.v.z = lerp(q.v.z, wz * wind * 0.35 * gust + flutter * 0.12, 1 - Math.exp(-dt * 2));
      // the cool air over the pond draws a light breeze off the banks: petals near the water drift out over it
      const sd0 = sdf(q.p.x, q.p.z);
      if (sd0 > -0.3 && sd0 < 3.5) { const k = 0.09 * dt; q.v.x -= sdfGx(q.p.x, q.p.z) * k * 1.6; q.v.z -= sdfGz(q.p.x, q.p.z) * k * 1.6; }
      q.v.y = lerp(q.v.y, -0.26 - 0.1 * Math.abs(flutter), 1 - Math.exp(-dt * 3));
      q.p.addScaledVector(q.v, dt); q.ang += q.spin * dt;
      const sd = sdf(q.p.x, q.p.z);
      const floor = sd < -0.05 ? waterHeightAt(q.p.x, q.p.z, t) + 0.002 : ground(q.p.x, q.p.z) + 0.004;
      if (q.p.y <= floor) {
        q.p.y = floor; settlePetal(q, 0);
        if (q.state === 1 && rand() < 0.3) addDrop(q.p.x, q.p.z, 0.025, -0.0006);
      }
      _sq4.setFromAxisAngle(q.axis, q.ang); _ss4.setScalar(q.s * SAKURA.scale);
      SAKURA.air.setMatrixAt(i, _sm4.compose(q.p, _sq4, _ss4)); SAKURA.rest.setMatrixAt(i, _ZERO_M);
    } else {
      q.t += dt;
      if (q.state === 1) {                             // drift with the breeze and ride the waves, then sink away
        q.p.x += wx * wind * 0.02 * dt; q.p.z += wz * wind * 0.02 * dt;
        const sd = sdf(q.p.x, q.p.z); if (sd > -0.08) { q.p.x -= sdfGx(q.p.x, q.p.z) * (sd + 0.08); q.p.z -= sdfGz(q.p.x, q.p.z) * (sd + 0.08); }
        q.p.y = waterHeightAt(q.p.x, q.p.z, t) + 0.0015 - smoothstep(q.life - 4, q.life, q.t) * 0.02;
        q.yaw += dt * 0.05;
      }
      const fade = 1 - smoothstep(q.life - 3, q.life, q.t);
      _se4.set(q.tilt * 0.3, q.yaw, q.tilt * 0.2); _sq4.setFromEuler(_se4); _ss4.setScalar(q.s * SAKURA.scale * Math.max(0.001, fade));
      SAKURA.rest.setMatrixAt(i, _sm4.compose(q.p, _sq4, _ss4)); SAKURA.air.setMatrixAt(i, _ZERO_M);
      if (q.t > q.life) petalRespawn(q);
    }
  }
  SAKURA.air.instanceMatrix.needsUpdate = true; SAKURA.rest.instanceMatrix.needsUpdate = true;
}
