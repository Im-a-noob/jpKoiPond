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
import { genSurface } from "./textures";
import { worleyP, WOR } from "../math";
export function buildPlantTextures() {
  // dense clipped-azalea foliage (opaque, triplanar) with Worley flower cells packed in alpha
  TEX.hedge = genSurface(512, (u, v) => {
    worleyP(u * 44, v * 44, 44, 91);
    const leaf = Math.max(0, 1 - WOR.f1 * 1.5), id = WOR.id, gap = smoothstep(0.0, 0.1, WOR.f2 - WOR.f1);
    let c = mix3(srgbHex(0x2e4a1c), srgbHex(0x55752e), id * 0.7 + leaf * 0.3);
    c = mix3(c, srgbHex(0x16230d), (1 - gap) * 0.7);
    worleyP(u * 11, v * 11, 11, 17);
    const flower = smoothstep(0.42, 0.22, WOR.f1) * (WOR.id > 0.35 ? 1 : 0);
    return [c[0], c[1], c[2], leaf * gap, flower];
  }, 5);
  // grass / iris blade streaks
  const cv = makeCanvas(64, 256), g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 256, 0, 0); grd.addColorStop(0, '#2c3d17'); grd.addColorStop(0.5, '#5f7a2e'); grd.addColorStop(1, '#a6a55a');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(${i % 2 ? '255,255,200' : '20,30,10'},0.12)`; g.lineWidth = 1; const x = Math.random() * 64; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 4, 256); g.stroke(); }
  TEX.blade = canvasTex(cv);
  const cv2 = makeCanvas(64, 256), g2 = cv2.getContext('2d');
  const grd2 = g2.createLinearGradient(0, 256, 0, 0); grd2.addColorStop(0, '#34502a'); grd2.addColorStop(1, '#5e8a43');
  g2.fillStyle = grd2; g2.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 26; i++) { const x = 2 + i * 2.4 + Math.random(); g2.strokeStyle = `rgba(${i % 3 ? '20,40,12' : '190,220,150'},${i % 3 ? 0.18 : 0.12})`; g2.lineWidth = 0.8; g2.beginPath(); g2.moveTo(x, 0); g2.lineTo(x, 256); g2.stroke(); }
  g2.strokeStyle = 'rgba(200,230,160,0.3)'; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(32, 0); g2.lineTo(32, 256); g2.stroke();
  const tipG = g2.createLinearGradient(0, 0, 0, 40); tipG.addColorStop(0, 'rgba(150,120,60,0.55)'); tipG.addColorStop(1, 'rgba(150,120,60,0)');
  g2.fillStyle = tipG; g2.fillRect(0, 0, 64, 40);                      // dry, bronzed leaf tips
  TEX.iris = canvasTex(cv2);
  // iris petal: violet with a yellow signal
  const cv3 = makeCanvas(128, 128), g3 = cv3.getContext('2d');
  const grd3 = g3.createRadialGradient(64, 110, 4, 64, 64, 70); grd3.addColorStop(0, '#f2c230'); grd3.addColorStop(0.18, '#e6e0f5'); grd3.addColorStop(0.35, '#6a3fb0'); grd3.addColorStop(1, '#3b1f78');
  g3.fillStyle = grd3; g3.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 18; i++) { g3.strokeStyle = 'rgba(40,10,70,0.35)'; g3.beginPath(); g3.moveTo(64, 120); g3.lineTo(i * 7.5, 0); g3.stroke(); }
  TEX.irisPetal = canvasTex(cv3);
  // water-lily petal: white to blush pink
  const cv4 = makeCanvas(64, 128), g4 = cv4.getContext('2d');
  const grd4 = g4.createLinearGradient(0, 128, 0, 0); grd4.addColorStop(0, '#fff9e8'); grd4.addColorStop(0.6, '#fbe3ea'); grd4.addColorStop(1, '#e9a0b8');
  g4.fillStyle = grd4; g4.fillRect(0, 0, 64, 128);
  TEX.lilyPetal = canvasTex(cv4);
}

