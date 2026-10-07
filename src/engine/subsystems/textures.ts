// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets } from "../geometry";
import { $, progress, toast, TEX } from "../state";
import { fbm2P, worleyP, WOR, hash3i, mix3, srgbHex, mulberry32 } from "../math";
/* ------------------------------------------------------------------ 2. PROCEDURAL TEXTURES */
export let MAX_ANISO = 8;
export function setMaxAnisotropy(val: number) {
  MAX_ANISO = val;
}
export function dataTex(data, w, h, srgb) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = MAX_ANISO;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
export function canvasTex(cv, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = MAX_ANISO; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
export function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// Height field (0..1, wrapping) -> tangent-space normal map. DataTexture rows run along +v.
export function heightToNormal(H, w, h, strength) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xl = (x - 1 + w) % w, xr = (x + 1) % w, yd = (y - 1 + h) % h, yu = (y + 1) % h;
    const dx = (H[y * w + xr] - H[y * w + xl]) * 0.5 * strength;
    const dy = (H[yu * w + x] - H[yd * w + x]) * 0.5 * strength;
    let nx = -dx, ny = -dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    out[i] = nx * 127.5 + 127.5; out[i + 1] = ny * 127.5 + 127.5; out[i + 2] = nz * 127.5 + 127.5; out[i + 3] = 255;
  }
  return out;
}
// Generic "albedo + height" generator: fn(u, v) returns [r,g,b (sRGB 0..255), height 0..1, rough 0..1]
export function genSurface(size, fn, normalStrength) {
  const alb = new Uint8Array(size * size * 4), H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = fn(x / size, y / size, x, y);
    const i = (y * size + x) * 4;
    alb[i] = r[0]; alb[i + 1] = r[1]; alb[i + 2] = r[2]; alb[i + 3] = clamp(r[4] === undefined ? 200 : r[4] * 255, 0, 255);
    H[y * size + x] = r[3];
  }
  return { map: dataTex(alb, size, size, true), normalMap: dataTex(heightToNormal(H, size, size, normalStrength), size, size, false) };
}

export { TEX };
export async function buildTextures() {
  const S = 256;

  // --- Water detail normal: tileable FBM ripples
  {
    const N = 512, H = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      H[y * N + x] = fbm2P(u * 8, v * 8, 8, 5, 11, 0.55) * 0.6 + fbm2P(u * 16 + 3.1, v * 16, 16, 3, 29) * 0.25;
    }
    TEX.waterNormal = dataTex(heightToNormal(H, N, N, 26), N, N, false);
  }
  await progress(0.08, 'Water ripple normals');

  // --- Caustics: Voronoi cell-edge network, softened (two copies are multiplied in-shader)
  {
    const N = 512, data = new Uint8Array(N * N * 4); let sum = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N * 7, v = y / N * 7;
      // domain-warp for organic, non-polygonal cells
      const wu = u + fbm2P(x / N * 4, y / N * 4, 4, 3, 5) * 0.35, wv = v + fbm2P(x / N * 4 + 7, y / N * 4, 4, 3, 6) * 0.35;
      worleyP(wu, wv, 7, 77);
      const edge = WOR.f2 - WOR.f1;
      const c = Math.pow(1 - smoothstep(0.0, 0.34, edge), 2.2) * 0.85 + 0.15 * (1 - WOR.f1);
      const i = (y * N + x) * 4; const b = clamp(c, 0, 1) * 255;
      data[i] = data[i + 1] = data[i + 2] = b; data[i + 3] = 255; sum += c;
    }
    TEX.caustics = dataTex(data, N, N, false);
    TEX.causticMean = sum / (N * N);
  }
  await progress(0.16, 'Caustic patterns');

  // --- Granite: speckled feldspar/quartz/biotite with subtle grain
  {
    TEX.granite = genSurface(512, (u, v) => {
      const base = fbm2P(u * 6, v * 6, 6, 4, 101) * 0.5 + 0.5;
      const sp = hash3i(Math.floor(u * 512), Math.floor(v * 512), 7, 3);
      const sp2 = fbm2P(u * 96, v * 96, 96, 2, 7) * 0.5 + 0.5;
      let c = mix3(srgbHex(0x837f79), srgbHex(0x9c978e), base);
      if (sp2 > 0.74) c = mix3(c, srgbHex(0x3a3836), smoothstep(0.74, 0.82, sp2) * 0.65);   // biotite flecks
      else if (sp > 0.95) c = mix3(c, srgbHex(0xcdc8bd), 0.45);                             // quartz glints
      else if (sp2 < 0.3) c = mix3(c, srgbHex(0xa08a7a), 0.35);                             // pink feldspar tint
      const h = base * 0.4 + sp2 * 0.5 + sp * 0.1;
      return [c[0], c[1], c[2], h, 0.78];
    }, 5);
    TEX.boulder = genSurface(512, (u, v) => {
      const b = fbm2P(u * 5, v * 5, 5, 5, 211) * 0.5 + 0.5;
      const f = fbm2P(u * 40, v * 40, 40, 3, 17) * 0.5 + 0.5;
      const lich = smoothstep(0.62, 0.72, fbm2P(u * 9, v * 9, 9, 4, 303) * 0.5 + 0.5);
      let c = mix3(srgbHex(0x6d6860), srgbHex(0x958d80), b * 0.7 + f * 0.3);
      c = mix3(c, srgbHex(0xa7a48f), lich * 0.55);
      return [c[0], c[1], c[2], b * 0.6 + f * 0.4, 0.8];
    }, 6);
    TEX.moss = genSurface(256, (u, v) => {
      const a = fbm2P(u * 16, v * 16, 16, 4, 404) * 0.5 + 0.5, b = hash3i(u * 256 | 0, v * 256 | 0, 1, 9);
      const c = mix3(srgbHex(0x3f5a1c), srgbHex(0x7f9a34), a * 0.8 + b * 0.2);
      return [c[0], c[1], c[2], a * 0.7 + b * 0.3, 0.9];
    }, 4);
  }
  await progress(0.26, 'Granite, boulders and moss');

  // --- Gravel: dense pebbles (Worley domes), fine & high-frequency normal
  {
    TEX.gravel = genSurface(512, (u, v) => {
      // two interleaved pebble sizes bedded in coarse sand
      worleyP(u * 14, v * 14, 14, 55); const f1a = WOR.f1, ea = WOR.f2 - WOR.f1, ida = WOR.id;
      worleyP(u * 27 + 0.37, v * 27 + 0.11, 27, 56); const f1b = WOR.f1, eb = WOR.f2 - WOR.f1, idb = WOR.id;
      const domeA = smoothstep(0.6, 0.12, f1a) * smoothstep(0.0, 0.16, ea);
      const domeB = smoothstep(0.58, 0.12, f1b) * smoothstep(0.0, 0.14, eb) * 0.92;
      const useA = domeA >= domeB, dome = useA ? domeA : domeB, id = useA ? ida : idb;
      const tones = [0x9c907c, 0x847a6a, 0x6f685f, 0xb0a792, 0x5e5850, 0x93806a, 0xa89f8f, 0x77746c];
      const fine = fbm2P(u * 96, v * 96, 96, 2, 8) * 0.5 + 0.5;
      let peb = srgbHex(tones[Math.floor(id * tones.length)]).map((q) => q * (0.86 + 0.2 * fine));
      const sand = mix3(srgbHex(0x6e6556), srgbHex(0x958a76), hash3i(u * 512 | 0, v * 512 | 0, 4, 2) * 0.6 + fine * 0.4);
      const c = mix3(sand, peb, smoothstep(0.04, 0.3, dome));
      return [c[0], c[1], c[2], Math.pow(dome, 0.6) * 0.85 + fine * 0.08, 0.92];
    }, 7);
  }
  await progress(0.34, 'Pond gravel');

  // --- Ground: fine moss/grass lawn with soil patches
  {
    TEX.ground = genSurface(512, (u, v, x, y) => {
      const patch = fbm2P(u * 4, v * 4, 4, 4, 606) * 0.5 + 0.5;
      const blade = hash3i(x, y >> 1, 3, 1);
      const fine = fbm2P(u * 48, v * 48, 48, 3, 88) * 0.5 + 0.5;
      let c = mix3(srgbHex(0x34461c), srgbHex(0x56692c), fine * 0.6 + blade * 0.4);
      c = mix3(c, srgbHex(0x2b3a17), smoothstep(0.4, 0.2, patch) * 0.6);   // dense moss
      c = mix3(c, srgbHex(0x6b6a3a), smoothstep(0.6, 0.75, patch) * 0.45); // drier grass
      c = mix3(c, srgbHex(0x4f4232), smoothstep(0.78, 0.9, patch) * 0.6);  // bare soil
      return [c[0], c[1], c[2], fine * 0.5 + blade * 0.5, 0.95];
    }, 3);
  }
  await progress(0.4, 'Moss lawn');

  // --- Wood (cedar): grain stretched along u, annual rings, pores
  {
    TEX.wood = genSurface(512, (u, v) => {
      // flat-sawn cedar: warped annual rings with dark latewood, fine fibres along the grain, occasional knots
      const warp = fbm2P(u * 2, v * 6, 2, 3, 71) * 0.9 + fbm2P(u * 8, v * 16, 8, 2, 13) * 0.15;
      let kd = 9;
      for (const [kx, ky] of [[0.23, 0.31], [0.71, 0.77]]) { const dx = (((u - kx + 1.5) % 1) - 0.5) * 3, dy = (((v - ky + 1.5) % 1) - 0.5) * 9; kd = Math.min(kd, Math.hypot(dx, dy)); }
      const ring = Math.sin((v * 26 + warp * 5 + 0.6 / (kd + 0.25)) * Math.PI * 2) * 0.5 + 0.5, late = Math.pow(ring, 6);
      const fibre = fbm2P(u * 96, v * 384, 96, 2, 3) * 0.5 + 0.5, blot = fbm2P(u * 3, v * 3, 3, 3, 21) * 0.5 + 0.5;
      let c = mix3(srgbHex(0xab6c42), srgbHex(0x86492a), late * 0.75 + (1 - fibre) * 0.25);
      c = mix3(c, srgbHex(0xc48a58), smoothstep(0.55, 0.75, blot) * 0.3);
      const knot = smoothstep(0.32, 0.06, kd); c = mix3(c, srgbHex(0x40200f), knot * 0.85);
      return [c[0], c[1], c[2], late * 0.35 + fibre * 0.45 + knot * 0.3, 0.6];
    }, 3);
  }
  // --- Bark: deep vertical fissures
  {
    TEX.bark = genSurface(512, (u, v) => {
      // furrowed bark: long, slightly wandering vertical fissures that break the surface into small elongated plates,
      // flaking edges, grey-green lichen patches and a few specks of moss (no big regular "snakeskin" cells)
      const warp = fbm2P(u * 6, v * 2, 6, 3, 12) * 0.05;
      worleyP((u + warp) * 22, v * 6, 22, 515);
      const plateEdge = smoothstep(0.0, 0.09, WOR.f2 - WOR.f1), id = WOR.id;
      const fis = Math.abs(fbm2P((u + warp) * 18, v * 1.5, 18, 3, 7));
      const furrow = smoothstep(0.0, 0.16, fis);
      const flake = fbm2P(u * 64, v * 32, 64, 3, 9) * 0.5 + 0.5, grain = fbm2P(u * 96, v * 12, 96, 2, 21) * 0.5 + 0.5;
      const lich = smoothstep(0.62, 0.75, fbm2P(u * 5, v * 3, 5, 4, 31) * 0.5 + 0.5) * smoothstep(0.3, 0.6, flake);
      const h = furrow * (0.55 + 0.45 * plateEdge) * (0.8 + 0.2 * flake);
      let c = mix3(srgbHex(0x1c1714), mix3(srgbHex(0x4d443c), srgbHex(0x736a60), id * 0.5 + grain * 0.5), h);
      c = mix3(c, srgbHex(0x8a7a66), smoothstep(0.75, 0.95, flake) * h * 0.3);          // paler freshly exposed bark
      c = mix3(c, srgbHex(0x8a937a), lich * 0.7);                                          // crustose lichen
      c = mix3(c, srgbHex(0x3f5226), smoothstep(0.8, 0.92, fbm2P(u * 9, v * 5, 9, 3, 41) * 0.5 + 0.5) * (1 - h) * 0.6);   // moss in the furrows
      return [c[0], c[1], c[2], h * 0.85 + flake * 0.15, 0.92 - lich * 0.1];
    }, 7);
  }
  // --- Roof tiles (kawara): rows of round-profile pan tiles
  {
    TEX.roof = genSurface(512, (u, v) => {
      const cols = 16, rows = 12;
      const cu = (u * cols) % 1, rv = (v * rows) % 1;
      const barrel = Math.sin(cu * Math.PI);                 // round tile profile
      const lap = smoothstep(0.0, 0.18, rv) * (1 - 0.35 * rv); // overlap step at each course
      const n = fbm2P(u * 32, v * 32, 32, 3, 44) * 0.5 + 0.5;
      const h = barrel * 0.6 + lap * 0.4;
      let c = mix3(srgbHex(0x2f3336), srgbHex(0x4b5054), barrel * 0.7 + n * 0.3);
      c = mix3(c, srgbHex(0x1c1e20), (1 - lap) * 0.6);
      return [c[0], c[1], c[2], h, 0.55 + n * 0.2];
    }, 8);
  }
  await progress(0.48, 'Cedar, bark and roof tiles');

  // --- Leaf-card atlases (drawn on canvas with alpha)
  TEX.mapleLeaves = leafCard('maple');
  TEX.pineNeedles = leafCard('pine');
  TEX.greenLeaves = leafCard('deciduous');
  TEX.shrubLeaves = leafCard('shrub');
  TEX.bloomLeaves = leafCard('bloom');
  TEX.conifer = leafCard('conifer');
  TEX.sakura = leafCard('sakura');
  TEX.hydrangea = leafCard('hydrangea'); TEX.bigleaf = leafCard('bigleaf'); TEX.camellia = leafCard('camellia'); TEX.bambooLeaves = leafCard('bamboo'); TEX.kikyo = leafCard('kikyo');
  // cherry bark: smooth, dark red-brown with horizontal lenticel dashes and peeling coppery bands
  TEX.sakuraBark = genSurface(512, (u, v) => {
    const n = fbm2P(u * 6, v * 6, 6, 4, 31) * 0.5 + 0.5, fine = fbm2P(u * 48, v * 48, 48, 2, 32) * 0.5 + 0.5;
    const row = v * 30, rid = Math.floor(row), fr = row - rid, cols = 5, off = hash3i(rid, 0, 1, 77) * cols;
    const cu = (u * cols + off) % 1, len = 0.25 + 0.5 * hash3i(rid, Math.floor(u * cols + off), 2, 78);
    const lent = smoothstep(0.2, 0.08, Math.abs(fr - 0.5)) * smoothstep(0.0, 0.06, cu) * smoothstep(len, len - 0.06, cu);
    const band = smoothstep(0.62, 0.72, fbm2P(u * 2, v * 3, 2, 3, 33) * 0.5 + 0.5);
    let c = mix3(srgbHex(0x2e2224), srgbHex(0x4d3a38), n * 0.7 + fine * 0.3);
    c = mix3(c, srgbHex(0x6e4232), band * 0.55);
    c = mix3(c, srgbHex(0x8c7a68), lent * 0.8);
    c = mix3(c, srgbHex(0x7c8472), smoothstep(0.7, 0.85, fbm2P(u * 12, v * 12, 12, 3, 34) * 0.5 + 0.5) * 0.45);   // grey-green lichen
    return [c[0], c[1], c[2], 0.5 + fine * 0.15 + lent * 0.25 - band * 0.05, 0.75 - band * 0.2];
  }, 5);
  TEX.lily = lilyTex();
  await progress(0.56, 'Foliage cards');
}

// Palmate maple, pine needle tufts, etc. Each card holds a cluster of leaves on transparent ground.
export function leafCard(kind) {
  const N = 512, cv = makeCanvas(N, N), g = cv.getContext('2d');
  const R = mulberry32(kind.length * 977 + 13);
  const rr2 = (a, b) => a + (b - a) * R();
  g.clearRect(0, 0, N, N);
  g.lineCap = 'round';
  function palmate(x, y, s, rot, col) {
    // Acer palmatum: seven pointed, finely serrated lobes; darker base, lighter tips, pale veins
    g.save(); g.translate(x, y); g.rotate(rot);
    const lobes = 7, path = new Path2D();
    for (let i = 0; i <= 280; i++) {
      const a = (i / 280) * Math.PI * 2;
      const lobe = Math.pow(Math.abs(Math.cos(a * lobes / 2)), 2.2);
      const serr = 1 + 0.045 * Math.sin(a * 90) * lobe;
      const r = s * (0.24 + 0.76 * lobe) * serr * (a > Math.PI * 0.8 && a < Math.PI * 1.2 ? 0.45 : 1);
      const px = Math.sin(a) * r, py = -Math.cos(a) * r;
      i ? path.lineTo(px, py) : path.moveTo(px, py);
    }
    const grd = g.createRadialGradient(0, 0, 1, 0, 0, s);
    const shade = (dl) => col.replace(/,([\d.]+)%,([\d.]+)\)$/, (m0, l, al) => `,${Math.max(8, +l + dl)}%,${al})`);
    grd.addColorStop(0, shade(-10)); grd.addColorStop(1, shade(8));
    g.fillStyle = grd; g.fill(path);
    g.strokeStyle = 'rgba(255,190,170,0.28)'; g.lineWidth = 1;
    for (let k = 0; k < lobes; k++) { const a = (k / lobes) * Math.PI * 2 + Math.PI / lobes; if (Math.abs(a - Math.PI) < 0.5) continue; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(a) * s * 0.85, -Math.cos(a) * s * 0.85); g.stroke(); }
    g.strokeStyle = 'rgba(60,20,10,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, s * 0.2); g.lineTo(0, s * 0.55); g.stroke();
    g.restore();
  }
  function ovate(x, y, w, h, rot, col, vein = true) {
    g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = col; g.beginPath();
    g.moveTo(0, -h); g.bezierCurveTo(w, -h * 0.5, w * 0.8, h * 0.6, 0, h); g.bezierCurveTo(-w * 0.8, h * 0.6, -w, -h * 0.5, 0, -h); g.fill();
    if (vein) { g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = Math.max(1, w * 0.08); g.beginPath(); g.moveTo(0, -h * 0.9); g.lineTo(0, h); g.stroke(); }
    g.restore();
  }
  const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
  if (kind === 'maple') {
    // twigs then ~34 leaves
    g.strokeStyle = '#3a2418'; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(N / 2, N / 2); g.lineTo(rr2(40, N - 40), rr2(40, N - 40)); g.stroke(); }
    for (let i = 0; i < 38; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * N * 0.38;
      palmate(N / 2 + Math.cos(a) * d, N / 2 + Math.sin(a) * d, rr2(34, 58), R() * 6.28, hsl(rr2(352, 370) % 360, rr2(58, 76), rr2(30, 45)));
    }
  } else if (kind === 'pine') {
    for (let t = 0; t < 9; t++) {
      const cx = rr2(90, N - 90), cy = rr2(90, N - 90);
      g.strokeStyle = '#3b2c20'; g.lineWidth = 5; g.beginPath(); g.moveTo(cx, cy + 60); g.lineTo(cx, cy); g.stroke();
      for (let i = 0; i < 90; i++) {
        const a = -Math.PI / 2 + rr2(-1.5, 1.5), len = rr2(40, 95);
        g.strokeStyle = hsl(rr2(95, 125), rr2(30, 45), rr2(16, 28)); g.lineWidth = rr2(1.6, 2.8);
        g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(a) * len * 0.5, cy + Math.sin(a) * len * 0.5 - 6, cx + Math.cos(a) * len, cy + Math.sin(a) * len); g.stroke();
      }
    }
  } else if (kind === 'deciduous') {
    g.strokeStyle = '#3a3020'; g.lineWidth = 3;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(N / 2, N * 0.9); g.lineTo(rr2(40, N - 40), rr2(40, N - 60)); g.stroke(); }
    for (let i = 0; i < 70; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * N * 0.4;
      ovate(N / 2 + Math.cos(a) * d, N / 2 + Math.sin(a) * d, rr2(14, 22), rr2(26, 40), R() * 6.28, hsl(rr2(75, 100), rr2(38, 55), rr2(24, 40)));
    }
  } else if (kind === 'shrub' || kind === 'bloom') {
    for (let i = 0; i < 150; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * N * 0.44;
      ovate(N / 2 + Math.cos(a) * d, N / 2 + Math.sin(a) * d, rr2(8, 13), rr2(15, 22), R() * 6.28, hsl(rr2(85, 110), rr2(35, 50), rr2(18, 32)), false);
    }
    if (kind === 'bloom') {
      // five-petal azalea flowers only (white; tinted per instance), laid over the shrub shell
      g.clearRect(0, 0, N, N);
      for (let i = 0; i < 30; i++) {
        const a = R() * Math.PI * 2, d = Math.sqrt(R()) * N * 0.38, x = N / 2 + Math.cos(a) * d, y = N / 2 + Math.sin(a) * d, s = rr2(18, 28);
        for (let p = 0; p < 5; p++) ovate(x + Math.cos(p * 1.2566) * s * 0.55, y + Math.sin(p * 1.2566) * s * 0.55, s * 0.45, s * 0.6, p * 1.2566 + Math.PI / 2, hsl(0, 0, rr2(88, 96)), false);
        g.fillStyle = 'rgba(120,40,60,0.8)'; g.beginPath(); g.arc(x, y, s * 0.18, 0, 6.28); g.fill();
      }
    }
  } else if (kind === 'sakura') {
    // Somei-yoshino: clusters of 3-5 pale blush flowers on long pedicels, notched petals, pink centres and stamens,
    // deep-pink buds and a few bronze young leaves along dark twigs
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) { g.strokeStyle = '#4a3430'; g.lineWidth = rr2(1.5, 3); g.beginPath(); g.moveTo(N / 2 + rr2(-50, 50), N * 0.97); g.quadraticCurveTo(rr2(80, N - 80), rr2(160, 360), rr2(30, N - 30), rr2(30, N - 80)); g.stroke(); }
    for (let i = 0; i < 4; i++) ovate(rr2(60, N - 60), rr2(60, N - 60), rr2(8, 12), rr2(16, 24), R() * 6.28, hsl(rr2(14, 36), rr2(40, 55), rr2(30, 40)));
    const flower = (x, y, s, rot, squash) => {
      g.save(); g.translate(x, y); g.rotate(rot); g.scale(1, squash);
      for (let p = 0; p < 5; p++) {
        g.save(); g.rotate(p * 1.2566 + rr2(-0.08, 0.08));
        const L = s * rr2(0.92, 1.05), W = s * 0.62;
        const grd = g.createLinearGradient(0, 0, 0, -L); grd.addColorStop(0, '#ef8fae'); grd.addColorStop(0.3, '#fbd5e0'); grd.addColorStop(1, '#fff3f6');
        g.fillStyle = grd; g.beginPath(); g.moveTo(0, 0);
        g.bezierCurveTo(W * 0.9, -L * 0.25, W * 0.75, -L * 0.95, W * 0.2, -L); g.lineTo(0, -L * 0.86); g.lineTo(-W * 0.2, -L);
        g.bezierCurveTo(-W * 0.75, -L * 0.95, -W * 0.9, -L * 0.25, 0, 0); g.fill();
        g.strokeStyle = 'rgba(225,140,165,0.3)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(0, -2); g.lineTo(0, -L * 0.8); g.stroke();
        g.restore();
      }
      g.fillStyle = '#c84a70'; g.beginPath(); g.arc(0, 0, s * 0.2, 0, 6.28); g.fill();
      for (let k = 0; k < 14; k++) { const a = k * 0.449 + rr2(-0.1, 0.1), r = s * rr2(0.3, 0.45); g.strokeStyle = 'rgba(250,240,235,0.9)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke(); g.fillStyle = '#d9b25c'; g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 1.3, 0, 6.28); g.fill(); }
      g.restore();
    };
    for (let c = 0; c < 24; c++) {
      const cx = rr2(60, N - 60), cy = rr2(60, N - 60), nF = 3 + (R() * 3 | 0);
      for (let f = 0; f < nF; f++) {
        const a = R() * 6.28, L = rr2(16, 34), fx = cx + Math.cos(a) * L, fy = cy + Math.sin(a) * L;
        g.strokeStyle = '#8a5048'; g.lineWidth = 1.0; g.beginPath(); g.moveTo(cx, cy); g.lineTo(fx, fy); g.stroke();
        if (R() < 0.12) { g.fillStyle = hsl(rr2(340, 350), 60, 62); g.beginPath(); g.ellipse(fx, fy, 5, 8, a + 1.57, 0, 6.28); g.fill(); }
        else flower(fx, fy, rr2(14, 20), R() * 6.28, rr2(0.55, 1.0));
      }
    }
  } else if (kind === 'hydrangea') {
    // mophead: densely packed four-sepal florets (near-white; tinted blue / purple / pink per instance)
    for (let i = 0; i < 120; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * N * 0.43, x = N / 2 + Math.cos(a) * d, y = N / 2 + Math.sin(a) * d, s = rr2(20, 30), rot = R() * 6.28, l = rr2(78, 94);
      for (let p = 0; p < 4; p++) {
        const pa = rot + p * Math.PI / 2;
        g.save(); g.translate(x + Math.cos(pa) * s * 0.42, y + Math.sin(pa) * s * 0.42); g.rotate(pa + Math.PI / 2);
        const grd = g.createRadialGradient(0, s * 0.3, 1, 0, 0, s * 0.6); grd.addColorStop(0, hsl(0, 0, l - 12)); grd.addColorStop(1, hsl(0, 0, l));
        g.fillStyle = grd; g.beginPath(); g.ellipse(0, 0, s * 0.36, s * 0.46, 0, 0, 6.28); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, s * 0.35); g.lineTo(0, -s * 0.35); g.stroke();
        g.restore();
      }
      g.fillStyle = 'rgba(40,40,60,0.45)'; g.beginPath(); g.arc(x, y, 2.2, 0, 6.28); g.fill();
    }
  } else if (kind === 'bigleaf') {
    // broad ovate leaves with an acuminate tip, fine serration and pinnate veins (hydrangea / peony foliage)
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * N * 0.34, x = N / 2 + Math.cos(a) * d, y = N / 2 + Math.sin(a) * d, w = rr2(26, 40), h = rr2(50, 72), rot = R() * 6.28;
      g.save(); g.translate(x, y); g.rotate(rot);
      const path = new Path2D(), side = (sgn) => { for (let k = 0; k <= 40; k++) { const t = k / 40, hw = w * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.85) * (1 + 0.05 * ((k % 2) ? 1 : -1) * Math.min(1, t * 3)); path.lineTo(sgn * hw, h - 2 * h * t); } };
      path.moveTo(0, h); side(1); for (let k = 40; k >= 0; k--) { const t = k / 40, hw = w * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.85) * (1 + 0.05 * ((k % 2) ? 1 : -1) * Math.min(1, t * 3)); path.lineTo(-hw, h - 2 * h * t); }
      const grd = g.createLinearGradient(-w, 0, w, 0); const L0 = rr2(18, 26); grd.addColorStop(0, hsl(rr2(92, 108), 45, L0 - 3)); grd.addColorStop(0.5, hsl(rr2(92, 105), 42, L0 + 4)); grd.addColorStop(1, hsl(rr2(95, 110), 48, L0 - 5));
      g.fillStyle = grd; g.fill(path);
      g.strokeStyle = 'rgba(190,220,150,0.28)'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(0, h); g.lineTo(0, -h * 0.95); g.stroke();
      g.lineWidth = 0.7; for (let k = 1; k <= 6; k++) { const yy = h - k * h * 0.28; for (const sg of [1, -1]) { g.beginPath(); g.moveTo(0, yy); g.quadraticCurveTo(sg * w * 0.45, yy - h * 0.12, sg * w * 0.78, yy - h * 0.3); g.stroke(); } }
      g.restore();
    }
  } else if (kind === 'camellia') {
    // Camellia japonica: glossy dark elliptic leaves, crimson cup-shaped flowers with a golden stamen boss
    for (let i = 0; i < 64; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * N * 0.44;
      ovate(N / 2 + Math.cos(a) * d, N / 2 + Math.sin(a) * d, rr2(14, 19), rr2(28, 36), R() * 6.28, hsl(rr2(105, 125), rr2(40, 55), rr2(14, 24)));
    }
    for (let i = 0; i < 5; i++) { g.strokeStyle = 'rgba(230,255,220,0.25)'; g.lineWidth = 3; g.beginPath(); const x = rr2(60, N - 60), y = rr2(60, N - 60); g.arc(x, y, 14, 3.6, 4.6); g.stroke(); }
    for (let f = 0; f < 1; f++) {
      const x = rr2(120, N - 120), y = rr2(120, N - 120), s = rr2(42, 52);
      for (let p = 0; p < 6; p++) { const pa = p * 1.047 + R() * 0.3; g.save(); g.translate(x + Math.cos(pa) * s * 0.42, y + Math.sin(pa) * s * 0.42); g.rotate(pa + Math.PI / 2);
        const grd = g.createRadialGradient(0, s * 0.3, 2, 0, 0, s * 0.62); grd.addColorStop(0, '#7a0614'); grd.addColorStop(0.6, '#b8102a'); grd.addColorStop(1, '#d42a40');
        g.fillStyle = grd; g.beginPath(); g.ellipse(0, 0, s * 0.42, s * 0.5, 0, 0, 6.28); g.fill(); g.restore(); }
      g.fillStyle = '#f2e6a0'; g.beginPath(); g.arc(x, y, s * 0.2, 0, 6.28); g.fill();
      for (let k = 0; k < 28; k++) { const aa = R() * 6.28, rr0 = s * rr2(0.08, 0.2); g.fillStyle = '#e8b820'; g.beginPath(); g.arc(x + Math.cos(aa) * rr0, y + Math.sin(aa) * rr0, 2.4, 0, 6.28); g.fill(); }
    }
  } else if (kind === 'bamboo') {
    // sprays of long lanceolate leaves hanging from thin twigs
    for (let sp = 0; sp < 5; sp++) {
      const x0 = rr2(120, N - 120), y0 = rr2(40, 160);
      g.strokeStyle = '#6a7a3a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + rr2(-40, 40), y0 + 90); g.stroke();
      for (let l = 0; l < 7; l++) {
        const ang = Math.PI / 2 + rr2(-1.1, 1.1), L = rr2(130, 190), W = rr2(11, 16), bx = x0 + rr2(-20, 20), by = y0 + rr2(20, 90);
        g.save(); g.translate(bx, by); g.rotate(ang - Math.PI / 2);
        const grd = g.createLinearGradient(0, 0, 0, L); grd.addColorStop(0, hsl(rr2(80, 95), 40, 26)); grd.addColorStop(1, hsl(rr2(75, 90), 45, 38));
        g.fillStyle = grd; g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(W, L * 0.15, W * 0.8, L * 0.7, 0, L); g.bezierCurveTo(-W * 0.8, L * 0.7, -W, L * 0.15, 0, 0); g.fill();
        g.strokeStyle = 'rgba(220,240,180,0.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 2); g.lineTo(0, L * 0.95); g.stroke();
        g.restore();
      }
    }
  } else if (kind === 'kikyo') {
    // Platycodon: open five-pointed violet-blue stars with darker veins, balloon buds, slender leaves
    for (let i = 0; i < 26; i++) ovate(rr2(40, N - 40), rr2(60, N - 20), rr2(7, 10), rr2(18, 26), rr2(-0.6, 0.6), hsl(rr2(90, 110), 40, rr2(22, 32)));
    for (let f = 0; f < 9; f++) {
      const x = rr2(60, N - 60), y = rr2(50, N - 120), s = rr2(26, 36);
      if (R() < 0.3) { g.fillStyle = hsl(260, 45, 58); g.beginPath(); g.ellipse(x, y, s * 0.35, s * 0.42, 0, 0, 6.28); g.fill(); continue; }
      g.save(); g.translate(x, y); g.rotate(R() * 6.28);
      const path = new Path2D(); for (let k = 0; k <= 10; k++) { const aa = k / 10 * Math.PI * 2 - Math.PI / 2, r = k % 2 ? s * 0.45 : s; path.lineTo(Math.cos(aa) * r, Math.sin(aa) * r); }
      const grd = g.createRadialGradient(0, 0, 2, 0, 0, s); grd.addColorStop(0, '#d8d2f0'); grd.addColorStop(0.35, '#7a62c8'); grd.addColorStop(1, '#5a44b0');
      g.fillStyle = grd; g.fill(path); g.strokeStyle = 'rgba(40,20,90,0.5)'; g.lineWidth = 0.8;
      for (let k = 0; k < 5; k++) { const aa = k / 5 * Math.PI * 2 - Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(aa) * s * 0.9, Math.sin(aa) * s * 0.9); g.stroke(); }
      g.fillStyle = '#f4f0e0'; g.beginPath(); g.arc(0, 0, s * 0.1, 0, 6.28); g.fill(); g.restore();
    }
  } else if (kind === 'conifer') {
    for (let i = 0; i < 260; i++) {
      const x = rr2(30, N - 30), y = rr2(30, N - 30), a = rr2(-2.6, -0.5), len = rr2(30, 70);
      g.strokeStyle = hsl(rr2(110, 140), rr2(25, 40), rr2(12, 22)); g.lineWidth = rr2(2, 4);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
  }
  return canvasTex(cv, true);
}

export function lilyTex() {
  const N = 256, cv = makeCanvas(N, N), g = cv.getContext('2d');
  const grd = g.createRadialGradient(N / 2, N / 2, 4, N / 2, N / 2, N / 2);
  grd.addColorStop(0, '#5f7a2c'); grd.addColorStop(0.8, '#3f5f22'); grd.addColorStop(1, '#6b3a2a');
  g.fillStyle = grd; g.fillRect(0, 0, N, N);
  g.strokeStyle = 'rgba(160,190,90,0.35)'; g.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2; g.beginPath(); g.moveTo(N / 2, N / 2); g.lineTo(N / 2 + Math.cos(a) * N / 2, N / 2 + Math.sin(a) * N / 2); g.stroke(); }
  return canvasTex(cv, true);
}

