// @ts-nocheck
// Geometry helpers
import * as THREE from "three";
import { clamp, lerp, smoothstep, vnoise3, fbm3, rand, rr, mulberry32 } from "./math";

/* ------------------------------------------------------------------ 3. GEOMETRY HELPERS */
export function mergeGeos(geos) {
  let nv = 0, ni = 0; const hasColor = geos.some((g) => g.attributes.color), hasBox = geos.some((g) => g.attributes.aBox);
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const col = hasColor ? new Float32Array(nv * 3).fill(1) : null, idx = new Uint32Array(ni);
  const box = hasBox ? new Float32Array(nv * 3) : null, half = hasBox ? new Float32Array(nv * 4) : null;
  let vo = 0, io = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
    nor.set(g.attributes.normal.array.subarray(0, n * 3), vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), vo * 2);
    if (col && g.attributes.color) col.set(g.attributes.color.array.subarray(0, n * 3), vo * 3);
    if (box && g.attributes.aBox) { box.set(g.attributes.aBox.array.subarray(0, n * 3), vo * 3); half.set(g.attributes.aHalf.array.subarray(0, n * 4), vo * 4); }
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io++] = a[i] + vo; }
    else for (let i = 0; i < n; i++) idx[io++] = i + vo;
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (box) { out.setAttribute('aBox', new THREE.BufferAttribute(box, 3)); out.setAttribute('aHalf', new THREE.BufferAttribute(half, 4)); }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}
// Weld coincident vertices (position only) so displaced shapes stay closed and shade smoothly.
export function weld(geo, tol = 1e-4) {
  const p = geo.attributes.position, map = new Map(), newPos = [], remap = new Uint32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const key = Math.round(p.getX(i) / tol) + '_' + Math.round(p.getY(i) / tol) + '_' + Math.round(p.getZ(i) / tol);
    let k = map.get(key);
    if (k === undefined) { k = newPos.length / 3; map.set(key, k); newPos.push(p.getX(i), p.getY(i), p.getZ(i)); }
    remap[i] = k;
  }
  const src = geo.index ? geo.index.array : Array.from({ length: p.count }, (_, i) => i);
  const idx = new Uint32Array(src.length); for (let i = 0; i < src.length; i++) idx[i] = remap[src[i]];
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
// Box with chamfered/rounded edges and slight chisel irregularity (for cut granite)
export function roundedBox(sx, sy, sz, r, seed) {
  const g = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  const p = g.attributes.position, h = [sx / 2, sy / 2, sz / 2];
  const remap = (u, hh) => { const a = Math.abs(u), s = Math.sign(u); if (a > 0.49) return s * hh; if (a > 0.24) return s * (hh - r); return 0; };
  for (let i = 0; i < p.count; i++) {
    const v = [p.getX(i), p.getY(i), p.getZ(i)].map((u, k) => remap(u, h[k]));
    const c = v.map((x, k) => clamp(x, -(h[k] - r), h[k] - r));
    const d = [v[0] - c[0], v[1] - c[1], v[2] - c[2]], l = Math.hypot(d[0], d[1], d[2]);
    if (l > 1e-6) for (let k = 0; k < 3; k++) v[k] = c[k] + (d[k] / l) * r;
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  const w = weld(g, 1e-4);
  const wp = w.attributes.position;
  for (let i = 0; i < wp.count; i++) {
    const x = wp.getX(i), y = wp.getY(i), z = wp.getZ(i);
    const n = fbm3(x * 9 + seed, y * 9, z * 9, 3, seed) * 0.006;
    wp.setXYZ(i, x * (1 + n / sx), y * (1 + n / sy), z * (1 + n / sz));
  }
  w.computeVertexNormals();
  return w;
}
// Noise-displaced icosphere boulder with a flattened base
export function rockGeo(seed, detail = 4, flat = -0.35, angular = 0, flatTop = true) {
  const g = weld(new THREE.IcosahedronGeometry(1, detail), 1e-5);
  const p = g.attributes.position, R = mulberry32(Math.floor(seed * 1000) + 7);
  // a few fracture planes give the stone flat faces and edges instead of a blob
  const cuts = [];
  for (let k = 0; k < 5 + angular * 6; k++) {
    const u = R() * 2 - 1, a = R() * Math.PI * 2, sq = Math.sqrt(1 - u * u);
    cuts.push([sq * Math.cos(a), u * 0.7, sq * Math.sin(a), (0.62 + R() * 0.22) * (1 - angular * 0.18)]);
  }
  if (angular && flatTop) cuts.push([0, 1, 0, 0.45 + R() * 0.2]);   // flat, weathered top
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + 0.24 * fbm3(x * 1.2 + seed, y * 1.2, z * 1.2, 4, seed) + 0.07 * fbm3(x * 3.5, y * 3.5 + seed, z * 3.5, 3, seed + 1)
      + 0.02 * fbm3(x * 9, y * 9, z * 9 + seed, 2, seed + 2);
    x *= d; y *= d; z *= d;
    for (const [nx, ny, nz, k] of cuts) {
      const t = x * nx + y * ny + z * nz;
      if (t > k) { const q = (t - k) * (0.85 + angular * 0.15); x -= nx * q; y -= ny * q; z -= nz * q; }
    }
    if (y < flat) y = flat + (y - flat) * 0.25;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}
// Tapered tube along a curve (branches / trunks). uv.y runs along length in metres * uvScale.
export function taperTube(curve, tubSeg, radSeg, r0, r1, uvScale = 1) {
  const frames = curve.computeFrenetFrames(tubSeg, false), len = curve.getLength();
  const pos = [], nor = [], uv = [], idx = [], P = new THREE.Vector3();
  for (let i = 0; i <= tubSeg; i++) {
    const t = i / tubSeg; curve.getPointAt(t, P);
    const N = frames.normals[i], B = frames.binormals[i], r = lerp(r0, r1, Math.pow(t, 0.8));
    for (let j = 0; j <= radSeg; j++) {
      const a = (j / radSeg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const nx = N.x * c + B.x * s, ny = N.y * c + B.y * s, nz = N.z * c + B.z * s;
      pos.push(P.x + nx * r, P.y + ny * r, P.z + nz * r); nor.push(nx, ny, nz);
      uv.push(j / radSeg * Math.max(1, Math.round((2 * Math.PI * r0) / 0.3)), t * len * uvScale);
    }
  }
  for (let i = 0; i < tubSeg; i++) for (let j = 0; j < radSeg; j++) {
    const a = i * (radSeg + 1) + j, b = a + radSeg + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);          // outward-facing winding (matches the explicit normals)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
// Box whose UVs are scaled by face size so wood grain density is uniform (grain along local x)
// Timber member with chamfered edges (grain along local x). aBox = local position, aHalf = half extents + board seed
// (+2 when the board is nailed) so the shader can add per-board tint, edge wear and nail heads.
export function woodBox(lx, ly, lz, grainScale = 1, flags = 0) {
  const g = new THREE.BoxGeometry(lx, ly, lz, 4, 4, 4);
  const p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal, h = [lx / 2, ly / 2, lz / 2];
  const r = Math.min(0.004, Math.min(lx, ly, lz) * 0.16), seed = rand();
  const box = new Float32Array(p.count * 3), half = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    let su, sv;
    if (ax > 0.5) { su = lz; sv = ly; } else if (ay > 0.5) { su = lx; sv = lz; } else { su = lx; sv = ly; }
    uv.setXY(i, uv.getX(i) * su * 0.6 * grainScale, uv.getY(i) * sv * 2.5 * grainScale);
    const v = [p.getX(i), p.getY(i), p.getZ(i)].map((u, k) => { const a2 = Math.abs(u) / h[k]; return a2 > 0.99 ? Math.sign(u) * h[k] : a2 > 0.49 ? Math.sign(u) * (h[k] - r) : u; });
    const c = v.map((x, k) => clamp(x, -(h[k] - r), h[k] - r)), d = [v[0] - c[0], v[1] - c[1], v[2] - c[2]], l = Math.hypot(d[0], d[1], d[2]);
    if (l > 1e-7) for (let k = 0; k < 3; k++) v[k] = c[k] + (d[k] / l) * r;
    p.setXYZ(i, v[0], v[1], v[2]);
    box.set(v, i * 3); half.set([h[0], h[1], h[2], seed + flags], i * 4);
  }
  g.setAttribute('aBox', new THREE.BufferAttribute(box, 3));
  g.setAttribute('aHalf', new THREE.BufferAttribute(half, 4));
  g.computeVertexNormals();
  return g;
}
export function placed(geo, pos, rotY = 0, rotX = 0, rotZ = 0) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ'));
  m.setPosition(pos.x, pos.y, pos.z);
  return geo.applyMatrix4(m);
}
export function setLayer(obj, layer) { obj.traverse((o) => o.layers.set(layer)); return obj; }
// ---- Signed-distance modelling helpers + naive Surface Nets extraction (used for the hand and the frog)
export const SDFK = {
  len: (x, y, z) => Math.sqrt(x * x + y * y + z * z),
  smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); },
  smax(a, b, k) { return -SDFK.smin(-a, -b, k); },
  sphere(p, c, r) { return SDFK.len(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r; },
  ellipsoid(p, c, r) {
    const x = (p[0] - c[0]) / r[0], y = (p[1] - c[1]) / r[1], z = (p[2] - c[2]) / r[2];
    const k0 = Math.sqrt(x * x + y * y + z * z), k1 = Math.sqrt(x * x / (r[0] * r[0]) + y * y / (r[1] * r[1]) + z * z / (r[2] * r[2]));
    return k0 * (k0 - 1) / (k1 || 1e-6);
  },
  // capsule with linearly varying radius between a and b (Quilez round cone, approximated per segment)
  cone(p, a, b, ra, rb) {
    const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2], pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
    const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
    return SDFK.len(pax - bax * h, pay - bay * h, paz - baz * h) - lerp(ra, rb, h);
  },
  roundBox(p, c, h, r) {
    const qx = Math.abs(p[0] - c[0]) - h[0] + r, qy = Math.abs(p[1] - c[1]) - h[1] + r, qz = Math.abs(p[2] - c[2]) - h[2] + r;
    return SDFK.len(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
  },
};
// Naive surface nets: one vertex per sign-changing cell (mean of edge crossings), quads across sign-changing edges,
// normals from the field gradient. Returns an indexed BufferGeometry.
export function surfaceNets(f, min, max, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1, ny = Math.ceil((max[1] - min[1]) / cell) + 1, nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const V = new Float32Array(nx * ny * nz), id = (i, j, k) => (k * ny + j) * nx + i, P3 = [0, 0, 0];
  // coarse pass (every 4th node); fine evaluation only inside a narrow band around the surface
  const C = 4, cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1, VC = new Float32Array(cx * cy * cz), band = cell * C * 2.5;
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) { P3[0] = min[0] + i * C * cell; P3[1] = min[1] + j * C * cell; P3[2] = min[2] + k * C * cell; VC[(k * cy + j) * cx + i] = f(P3); }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = VC[(Math.round(k / C) * cy + Math.round(j / C)) * cx + Math.round(i / C)];
    if (Math.abs(c) > band) { V[id(i, j, k)] = c; continue; }
    P3[0] = min[0] + i * cell; P3[1] = min[1] + j * cell; P3[2] = min[2] + k * cell; V[id(i, j, k)] = f(P3);
  }
  const vert = new Int32Array(nx * ny * nz).fill(-1), pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8), co = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { cv[c] = V[id(i + co[c][0], j + co[c][1], k + co[c][2])]; if (cv[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += co[a][0] + (co[b][0] - co[a][0]) * t; sy += co[a][1] + (co[b][1] - co[a][1]) * t; sz += co[a][2] + (co[b][2] - co[a][2]) * t; n++;
    }
    vert[id(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }
  const idx = [], nor = new Float32Array(pos.length), e = cell * 0.5, Q = [0, 0, 0];
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const g = (dx, dy, dz) => { Q[0] = x + dx; Q[1] = y + dy; Q[2] = z + dz; return f(Q); };
    let gx = g(e, 0, 0) - g(-e, 0, 0), gy = g(0, e, 0) - g(0, -e, 0), gz = g(0, 0, e) - g(0, 0, -e); const l = Math.hypot(gx, gy, gz) || 1;
    nor[v * 3] = gx / l; nor[v * 3 + 1] = gy / l; nor[v * 3 + 2] = gz / l;
  }
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // orient by the field gradient
    const ax = pos[b * 3] - pos[a * 3], ay = pos[b * 3 + 1] - pos[a * 3 + 1], az = pos[b * 3 + 2] - pos[a * 3 + 2];
    const bx = pos[c * 3] - pos[a * 3], by = pos[c * 3 + 1] - pos[a * 3 + 1], bz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
    if (fx * (nor[a * 3] + nor[c * 3]) + fy * (nor[a * 3 + 1] + nor[c * 3 + 1]) + fz * (nor[a * 3 + 2] + nor[c * 3 + 2]) >= 0) idx.push(a, b, c, a, c, d);
    else idx.push(a, c, b, a, d, c);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const s0 = V[id(i, j, k)] < 0;
    if (s0 !== (V[id(i + 1, j, k)] < 0)) quad(vert[id(i, j - 1, k - 1)], vert[id(i, j, k - 1)], vert[id(i, j, k)], vert[id(i, j - 1, k)]);
    if (s0 !== (V[id(i, j + 1, k)] < 0)) quad(vert[id(i - 1, j, k - 1)], vert[id(i, j, k - 1)], vert[id(i, j, k)], vert[id(i - 1, j, k)]);
    if (s0 !== (V[id(i, j, k + 1)] < 0)) quad(vert[id(i - 1, j - 1, k)], vert[id(i, j - 1, k)], vert[id(i, j, k)], vert[id(i - 1, j, k)]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export function instanced(geo: any, mat: any, matrices: any[], layer: any, cast = true) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  matrices.forEach((mm, i) => m.setMatrixAt(i, mm));
  m.count = matrices.length; m.castShadow = cast; m.receiveShadow = true;
  m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
  if (typeof setLayer === 'function') setLayer(m, layer);
  return m;
}



