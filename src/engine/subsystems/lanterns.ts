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
import { ground } from "./terrain";
import { sunState } from "./lighting";
export const LANTERNS = [];
export function buildLanterns() {
  const granite = WORLD.granite;
  const glow = new THREE.MeshBasicMaterial({ color: 0xffb060 });
  const spots = [[-4.3, -3.3], [3.65, -6.9]];
  for (const [x0, z0] of spots) {
    let x = x0, z = z0; const gy = ground(x, z);
    const parts = [];
    const hexCyl = (r0, r1, h, y, seg = 6) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg, 1); g.translate(0, y + h / 2, 0); return g; };
    parts.push(hexCyl(0.2, 0.24, 0.09, 0));                 // base
    parts.push(hexCyl(0.15, 0.2, 0.06, 0.09));
    parts.push(new THREE.CylinderGeometry(0.075, 0.09, 0.62, 16).translate(0, 0.15 + 0.31, 0));   // post
    parts.push(hexCyl(0.2, 0.13, 0.1, 0.77));                // platform (chūdai)
    // light box: four corner posts leaving openings
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const g = new THREE.BoxGeometry(0.045, 0.2, 0.045); g.translate(Math.cos(a) * 0.12, 0.97, Math.sin(a) * 0.12); parts.push(g); }
    parts.push(hexCyl(0.17, 0.17, 0.03, 0.87)); parts.push(hexCyl(0.16, 0.16, 0.02, 1.07));
    // curved cap with upturned corners
    const cap = new THREE.CylinderGeometry(0.03, 0.3, 0.16, 6, 4, false); const cp = cap.attributes.position;
    for (let i = 0; i < cp.count; i++) { const px = cp.getX(i), pz = cp.getZ(i), py = cp.getY(i), r = Math.hypot(px, pz); const ang = Math.atan2(pz, px); const corner = Math.pow(Math.abs(Math.cos(ang * 3)), 8); cp.setY(i, py - 0.05 * (r / 0.3) ** 2 + corner * 0.05 * (r / 0.3) ** 4); }
    cap.computeVertexNormals(); cap.translate(0, 1.17, 0); parts.push(cap);
    parts.push(new THREE.SphereGeometry(0.045, 14, 10).translate(0, 1.29, 0));
    parts.push(new THREE.ConeGeometry(0.03, 0.06, 12).translate(0, 1.35, 0));
    const g = mergeGeos(parts.map((p) => { if (!p.attributes.normal) p.computeVertexNormals(); return p; }));
    const m = new THREE.Mesh(g, granite); m.position.set(x, gy - 0.03, z); m.rotation.y = rand() * 6; m.castShadow = m.receiveShadow = true;
    setLayer(m, LAYER.ABOVE); scene.add(m);
    const light = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.17, 6), glow.clone()); light.position.set(x, gy - 0.03 + 0.97, z);
    setLayer(light, LAYER.ABOVE); scene.add(light); LANTERNS.push(light);
  }
}
export function updateLanterns() {
  const dusk = 1 - smoothstep(4 * DEG, 18 * DEG, sunState.elev);
  for (const L of LANTERNS) { L.material.color.setRGB(0.08 + 3.2 * dusk, 0.05 + 1.9 * dusk, 0.02 + 0.7 * dusk); }
}

// Cherry petals drifting on the surface (instanced, riding the waves, pushed by the wind, gathering along the edges)
