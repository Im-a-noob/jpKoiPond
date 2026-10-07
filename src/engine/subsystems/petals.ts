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

export const PETALS = { n: 220, list: [], mesh: null };
export function buildPetals() {
  const cv = makeCanvas(64, 64), g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 50, 2, 32, 30, 32); grd.addColorStop(0, '#fbe6ec'); grd.addColorStop(1, '#f2a9c1');
  g.fillStyle = grd; g.beginPath(); g.moveTo(32, 62); g.bezierCurveTo(62, 44, 60, 10, 40, 4); g.lineTo(32, 12); g.lineTo(24, 4); g.bezierCurveTo(4, 10, 2, 44, 32, 62); g.fill();
  const mat = physical({ map: canvasTex(cv), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.45, sheen: 0.7, sheenColor: new THREE.Color(0xffe0ea) },
    { key: 'petal', leaf: true, float: true, uniforms: { uTransl: { value: 0.8 } } });
  const geo = new THREE.PlaneGeometry(0.022, 0.024, 2, 2); geo.rotateX(-Math.PI / 2);
  const gp = geo.attributes.position; for (let i = 0; i < gp.count; i++) gp.setY(i, 0.0015 * (gp.getX(i) ** 2 + gp.getZ(i) ** 2) * 3000);
  geo.computeVertexNormals();
  PETALS.mesh = new THREE.InstancedMesh(geo, mat, PETALS.n); PETALS.mesh.frustumCulled = false; PETALS.mesh.receiveShadow = true;
  setLayer(PETALS.mesh, LAYER.SURFACE); scene.add(PETALS.mesh);
  for (let i = 0; i < PETALS.n; i++) {
    let x, z, guard = 0;
    do { x = rand() < 0.55 ? rr(-3.2, -1.2) : rr(-3.3, 3.0); z = rand() < 0.55 ? rr(-6, 1) : rr(-6, 5.5); } while (sdf(x, z) > -0.12 && guard++ < 60);
    PETALS.list.push({ x, z, rot: rand() * 6.28, spin: rr(-0.2, 0.2), s: rr(0.7, 1.3) });
  }
}
const _pm4 = new THREE.Matrix4(), _pq4 = new THREE.Quaternion(), _pe4 = new THREE.Euler(), _ps4 = new THREE.Vector3(), _pv4 = new THREE.Vector3();
export function updatePetals(dt) {
  if (!PETALS.mesh) return;
  const wx = SH.uWindDir.value.x * P.windSpeed * 0.02, wz = SH.uWindDir.value.y * P.windSpeed * 0.02;
  PETALS.list.forEach((q, i) => {
    q.x += wx * dt * (0.6 + SH.uGust.value); q.z += wz * dt * (0.6 + SH.uGust.value); q.rot += q.spin * dt;
    const sd = sdf(q.x, q.z);
    if (sd > -0.08) { const e = 0.03, gx = (sdf(q.x + e, q.z) - sdf(q.x - e, q.z)) / (2 * e), gz = (sdf(q.x, q.z + e) - sdf(q.x, q.z - e)) / (2 * e); q.x -= gx * (sd + 0.08); q.z -= gz * (sd + 0.08); }
    _pv4.set(q.x, WATER_Y, q.z); _pe4.set(0, q.rot, 0); _pq4.setFromEuler(_pe4); _ps4.setScalar(q.s);
    PETALS.mesh.setMatrixAt(i, _pm4.compose(_pv4, _pq4, _ps4));
  });
  PETALS.mesh.instanceMatrix.needsUpdate = true;
}

// Distant mountain ridges with aerial perspective (they fade into the horizon haze)
