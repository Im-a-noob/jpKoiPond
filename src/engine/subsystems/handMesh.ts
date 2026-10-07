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
import { buildSplashes } from "./handCollisions";
// A hand reaches out over the water and sprinkles floating pellets; koi sense it (distance-delayed), rush in,
// crowd and gulp at the surface with splashes; excitement decays naturally once the food is gone.
export const FEED = { active: false, t: 0, point: new THREE.Vector3(), toward: new THREE.Vector3(), side: new THREE.Vector3(),
  pellets: [], excite: 0, linger: 0, hand: null, shot: null, emitted: 0 };
export const SKIN_SSS = /* glsl */`
{
  // skin: wrapped diffuse with a reddish scattering tint, strongest where light grazes or shines through fingers
  vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float nl = dot(geometryNormal, Lv);
  float wrapL = max(0.0, (nl + 0.5) / 1.5) - max(0.0, nl);
  float thru = pow(max(dot(-geometryViewDir, Lv), 0.0), 6.0) * 0.6;
  reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * (wrapL * 0.55 + thru) * vec3(1.0, 0.45, 0.32);
}
`;
export const SKIN_FS_PARS = /* glsl */`
varying vec3 vBind;
uniform vec3 uJoints[15];
float sk3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sknoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sk3(i), sk3(i + vec3(1,0,0)), f.x), mix(sk3(i + vec3(0,1,0)), sk3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sk3(i + vec3(0,0,1)), sk3(i + vec3(1,0,1)), f.x), mix(sk3(i + vec3(0,1,1)), sk3(i + vec3(1,1,1)), f.x), f.y), f.z); }
// knuckle creases (bands across the finger, on the back of each joint) + faint dorsal veins + pores
float skinHeight(vec3 p){
  float h = 0.0;
  for (int i = 0; i < 15; i++) {
    vec3 d = p - uJoints[i];
    float near = (1.0 - smoothstep(0.003, 0.0085, length(d))) * smoothstep(-0.002, 0.004, d.y);
    h += near * (0.5 + 0.5 * sin(d.x * 2600.0 + sin(d.z * 900.0) * 1.5)) * 0.7;
    // flexion crease across the palm side of each joint
    float fold = (1.0 - smoothstep(0.0006, 0.0016, abs(d.x))) * (1.0 - smoothstep(0.006, 0.011, length(d.yz))) * smoothstep(0.001, -0.003, d.y);
    h -= fold * 2.2;
  }
  // the three main palm creases
  float palmS = smoothstep(-0.004, -0.011, p.y) * step(0.0, p.x) * step(p.x, 0.08);
  float cr = min(min(abs(p.z - 0.018 + p.x * 0.35), abs(p.z + 0.004 - p.x * 0.2)), abs(p.x - 0.05 + p.z * 0.5));
  h -= palmS * (1.0 - smoothstep(0.0005, 0.0015, cr)) * 1.6;
  float dorsal = smoothstep(0.004, 0.012, p.y) * smoothstep(0.075, 0.02, p.x) * smoothstep(-0.09, -0.02, p.x);
  float vein = smoothstep(0.9, 0.99, 1.0 - abs(sknoise(vec3(p.x * 60.0, 0.0, p.z * 140.0)) * 2.0 - 1.0)) * dorsal;
  float pores = sknoise(p * 2500.0) * 0.25 + smoothstep(0.7, 0.9, sknoise(p * 5200.0)) * 0.3;
  // fine skin relief: two crossing sets of shallow furrows (the diamond texture on the back of a hand)
  float n = sknoise(p * 300.0);
  float lines = pow(abs(sin((p.x * 0.7 + p.z) * 7000.0 + n * 3.0)), 8.0) + pow(abs(sin((p.x * 0.7 - p.z) * 6200.0 + n * 2.0)), 8.0);
  return (h * 0.35 - vein * 0.8 + pores - lines * 0.35) * 0.00012 + vein * 0.00018;
}
`;
export const SKIN_MAP = /* glsl */`
{
  float dorsal = smoothstep(0.004, 0.012, vBind.y) * smoothstep(0.075, 0.02, vBind.x) * smoothstep(-0.09, -0.02, vBind.x);
  float vein = smoothstep(0.9, 0.99, 1.0 - abs(sknoise(vec3(vBind.x * 60.0, 0.0, vBind.z * 140.0)) * 2.0 - 1.0)) * dorsal;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.82, 0.84, 0.98), vein * 0.5);          // faint bluish veins
  diffuseColor.rgb *= 0.96 + 0.08 * sknoise(vBind * 400.0);                                                  // blotchy skin tone
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 0.9, 0.88), smoothstep(0.55, 0.8, sknoise(vBind * 140.0)) * 0.35);   // capillary flush
  // sun-tanned back of the forearm, paler inner side; redder knuckle skin; faint freckles
  float fore = smoothstep(-0.03, -0.2, vBind.x);
  diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.9, 0.84, 0.8), vec3(1.03, 1.0, 0.98), smoothstep(0.0, -0.02, vBind.y)), fore);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.62, 0.56), smoothstep(0.82, 0.9, sknoise(vBind * 900.0)) * 0.25 * smoothstep(0.0, 0.01, vBind.y));
}
`;
export const SKIN_NORMAL = /* glsl */`
{
  float hgt = skinHeight(vBind);
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  float dhx = dFdx(hgt), dhy = dFdy(hgt);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  normal = normalize(abs(det) * normal - sign(det) * (dhx * r1 + dhy * r2));
}
`;
export function buildSkinTextures() {
  TEX.skin = genSurface(256, (u, v) => {
    const pores = hash3i(u * 256 | 0, v * 256 | 0, 2, 5) > 0.93 ? 0 : 1;
    const f = fbm2P(u * 24, v * 24, 24, 3, 12) * 0.5 + 0.5, lines = Math.abs(Math.sin((u * 30 + fbm2P(u * 4, v * 4, 4, 2, 3) * 2) * Math.PI));
    const h = f * 0.5 + pores * 0.3 + lines * 0.2;
    return [200, 150, 130, h, 0.5];
  }, 2.5);
  TEX.linen = genSurface(256, (u, v, x, y) => {
    const wx = Math.sin(x * Math.PI / 2) * 0.5 + 0.5, wy = Math.sin(y * Math.PI / 2) * 0.5 + 0.5, over = ((x >> 1) + (y >> 1)) % 2;
    const slub = fbm2P(u * 8, v * 64, 8, 2, 4) * 0.5 + 0.5;
    const h = over ? wx : wy, c = mix3(srgbHex(0x2c3c59), srgbHex(0x3a4e70), h * 0.18 + slub * 0.6 + fbm2P(u * 3, v * 3, 3, 2, 8) * 0.2);
    return [c[0], c[1], c[2], h * 0.5 + slub * 0.5, 0.9];
  }, 1.6);
}
// Procedural hand: one continuous SDF surface (palm, thenar/hypothenar pads, knuckles, tapered fingers and thumb,
// forearm) extracted with surface nets and skinned to a 16-bone rig; nails ride on the distal bones; linen sleeve.
export function buildHand() {
  buildSkinTextures();
  TEX.skin.normalMap.repeat.set(3, 3);
  const joints = [];
  const skin = physical({ color: 0xffffff, vertexColors: true, roughness: 0.5, sheen: 0.22, sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xffc7ae), clearcoat: 0.05, clearcoatRoughness: 0.5, envMapIntensity: 0.8 }, { key: 'skin2', fsPostLights: SKIN_SSS,
    uniforms: { uJoints: { value: joints } }, vsPars: 'varying vec3 vBind;\n', vsBegin: 'vBind = position;',
    fsRough: 'roughnessFactor = clamp(0.44 + 0.16 * sknoise(vBind * 180.0) - 0.08 * smoothstep(0.004, 0.012, vBind.y), 0.3, 0.7);',
    fsPars: SKIN_FS_PARS, fsMap: SKIN_MAP, fsNormal: SKIN_NORMAL });
  const nailMat = physical({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.25, clearcoat: 0.85, clearcoatRoughness: 0.15, sheen: 0.3, sheenColor: new THREE.Color(0xffe0d8) }, { key: 'skinnail' });
  const sleeveMat = physical({ map: TEX.linen.map, normalMap: TEX.linen.normalMap, roughness: 0.88, sheen: 0.7, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x8aa0c8), side: THREE.DoubleSide }, { key: 'sleeve' });
  TEX.linen.map.repeat.set(5, 2); TEX.linen.normalMap.repeat.set(5, 2);
  // ---- rig (rest pose)
  const X = new THREE.Vector3(1, 0, 0), rootBone = new THREE.Bone(), palmBone = new THREE.Bone(), bones = [rootBone, palmBone], segs = [];
  rootBone.add(palmBone);                        // wrist: the palm flexes on the forearm
  const FING = [['index', [0.081, 0.004, 0.03], 0.07, [0.043, 0.026, 0.021], [0.0088, 0.0081, 0.0074, 0.0066]],
    ['middle', [0.085, 0.004, 0.009], 0.0, [0.047, 0.029, 0.022], [0.0092, 0.0085, 0.0077, 0.0068]],
    ['ring', [0.081, 0.003, -0.012], -0.06, [0.044, 0.027, 0.021], [0.0085, 0.0079, 0.0072, 0.0064]],
    ['pinky', [0.073, 0.001, -0.031], -0.14, [0.034, 0.021, 0.018], [0.0074, 0.0068, 0.0062, 0.0056]]];
  const REST = [0.12, 0.16, 0.1];
  const J = {}, tips = {};
  const chain = (name, base, restQ, L, R) => {
    const b0 = new THREE.Bone(); b0.position.fromArray(base); b0.quaternion.copy(restQ); palmBone.add(b0);
    const b1 = new THREE.Bone(); b1.position.set(L[0], 0, 0); b0.add(b1);
    const b2 = new THREE.Bone(); b2.position.set(L[1], 0, 0); b1.add(b2);
    const tip = new THREE.Object3D(); tip.position.set(L[2], 0, 0); b2.add(tip);
    bones.push(b0, b1, b2); J[name] = [b0, b1, b2]; tips[name] = tip;
    return [b0, b1, b2];
  };
  for (const [name, base, splay, L, R] of FING) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, splay, -REST[0], 'YZX'));
    const [b0, b1, b2] = chain(name, base, q, L, R);
    b1.rotation.z = -REST[1]; b2.rotation.z = -REST[2];
    b0.userData = { restQ: q.clone(), L, R }; b1.userData = { L, R }; b2.userData = { L, R };
  }
  const tq = new THREE.Quaternion().setFromUnitVectors(X, new THREE.Vector3(0.62, -0.32, 0.72).normalize());
  const thumb = chain('thumb', [0.006, -0.009, 0.027], tq, [0.042, 0.032, 0.027], [0.0128, 0.011, 0.0098, 0.0088]);
  thumb[0].userData = { restQ: tq.clone() }; thumb[1].rotation.z = -0.15; thumb[2].rotation.z = -0.12;
  rootBone.updateMatrixWorld(true);
  for (const name of ['index', 'middle', 'ring', 'pinky', 'thumb']) for (let k = 0; k < 3; k++) joints.push(new THREE.Vector3().setFromMatrixPosition(J[name][k].matrixWorld));
  const wp = (o, x = 0) => new THREE.Vector3(x, 0, 0).applyMatrix4(o.matrixWorld).toArray();
  for (const [name, , , L, R] of FING) { const c = J[name]; for (let k = 0; k < 3; k++) segs.push({ bone: c[k], a: wp(c[k]), b: wp(c[k], L[k]), ra: R[k], rb: R[k + 1], finger: true }); }
  { const L = [0.042, 0.032, 0.027], R = [0.0128, 0.011, 0.0098, 0.0088]; for (let k = 0; k < 3; k++) segs.push({ bone: thumb[k], a: wp(thumb[k]), b: wp(thumb[k], L[k]), ra: R[k], rb: R[k + 1], finger: true }); }
  const armA = [-0.004, 0.002, 0], armB = [-0.62, 0.02, 0];
  // ---- field
  const f = (p) => {
    let d = SDFK.roundBox(p, [0.037, 0.0, 0.0], [0.046, 0.0125, 0.043], 0.011);
    d = SDFK.smin(d, SDFK.cone([p[0], p[1], p[2] * 0.8], armA, armB, 0.027, 0.037), 0.016);
    d = SDFK.smin(d, SDFK.ellipsoid(p, [0.014, -0.009, 0.029], [0.036, 0.016, 0.02]), 0.01);
    d = SDFK.smin(d, SDFK.ellipsoid(p, [0.022, -0.007, -0.031], [0.036, 0.013, 0.014]), 0.01);
    let fd = 1e9;
    for (const s of segs) {
      let sd = SDFK.cone(p, s.a, s.b, s.ra, s.rb);
      fd = SDFK.smin(fd, sd, 0.0035);
    }
    d = SDFK.smin(d, fd, 0.008);
    for (const [, base] of FING) d = SDFK.smin(d, SDFK.sphere(p, [base[0] - 0.002, base[1] + 0.006, base[2]], 0.0082), 0.005);   // knuckles
    // extensor tendons fanning from the wrist to each knuckle, standing just proud of the back of the hand
    for (const [, base] of FING) d = SDFK.smin(d, SDFK.cone(p, [-0.006, 0.0112, base[2] * 0.45], [base[0] - 0.012, base[1] + 0.0112, base[2]], 0.0024, 0.0021), 0.0035);
    d = SDFK.smin(d, SDFK.sphere(p, [-0.03, 0.004, -0.03], 0.0068), 0.006);                     // ulnar styloid at the wrist
    return d;
  };
  const geo = surfaceNets(f, [-0.64, -0.058, -0.068], [0.21, 0.056, 0.1], 0.0015);
  // ---- skin weights (inverse distance to each bone's segment, top four) and vertex tint
  const pa = geo.attributes.position, nV = pa.count, si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4), col = new Float32Array(nV * 3);
  const segD = (p, a, b) => { const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2]; const h = clamp(((p[0] - a[0]) * bx + (p[1] - a[1]) * by + (p[2] - a[2]) * bz) / (bx * bx + by * by + bz * bz), 0, 1); return [SDFK.len(p[0] - a[0] - bx * h, p[1] - a[1] - by * h, p[2] - a[2] - bz * h), h]; };
  const P = [0, 0, 0];
  for (let v = 0; v < nV; v++) {
    P[0] = pa.getX(v); P[1] = pa.getY(v); P[2] = pa.getZ(v);
    const cand = [];
    const [dr] = segD(P, [-0.4, 0, 0], [-0.012, 0, 0]), [dp] = segD(P, [-0.012, 0, 0], [0.07, 0, 0]);
    cand.push([0, Math.max(dr - 0.03, 0.0008)]); cand.push([1, Math.max(dp - 0.03, 0.0008)]);
    let tipK = 0;
    segs.forEach((s) => { const [d, h] = segD(P, s.a, s.b); cand.push([bones.indexOf(s.bone), Math.max(d - lerp(s.ra, s.rb, h), 0.0008)]); if (s.bone.children.some((c) => !c.isBone) && d < 0.013) tipK = Math.max(tipK, smoothstep(0.5, 1.0, h)); });
    cand.sort((a, b) => a[1] - b[1]);
    let sum = 0; const top = cand.slice(0, 4).map(([b, d]) => { const w = 1 / Math.pow(d, 3); sum += w; return [b, w]; });
    top.forEach(([b, w], k) => { si[v * 4 + k] = b; sw[v * 4 + k] = w / sum; });
    // colour: fingertips and knuckles flush pinker, palm side paler
    const palmSide = smoothstep(0.0, -0.012, P[1]) * smoothstep(-0.05, 0.02, P[0]);
    const knuck = FING.reduce((m, [, b]) => Math.max(m, 1 - smoothstep(0.004, 0.014, SDFK.len(P[0] - b[0], P[1] - b[1] - 0.008, P[2] - b[2]))), 0);
    const base = [0.88, 0.62, 0.5];
    col[v * 3] = base[0] * (1 + 0.06 * palmSide) * (1 + 0.04 * tipK + 0.03 * knuck);
    col[v * 3 + 1] = base[1] * (1 + 0.1 * palmSide) * (1 - 0.1 * tipK - 0.08 * knuck);
    col[v * 3 + 2] = base[2] * (1 + 0.12 * palmSide) * (1 - 0.08 * tipK - 0.08 * knuck);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col.map((c) => Math.pow(c, 2.2)), 3));
  // planar-ish UVs for the pore normal map
  const uvs = new Float32Array(nV * 2); for (let v = 0; v < nV; v++) { uvs[v * 2] = pa.getX(v) * 18; uvs[v * 2 + 1] = (pa.getZ(v) + pa.getY(v)) * 18; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const hand = new THREE.SkinnedMesh(geo, skin);
  hand.add(rootBone);
  hand.bind(new THREE.Skeleton(bones));
  hand.castShadow = hand.receiveShadow = true; hand.frustumCulled = false;
  const root = new THREE.Group();
  root.add(hand);
  // nails on the distal bones
  for (const name of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
    const b = J[name][2], L = name === 'thumb' ? 0.027 : FING.find((x) => x[0] === name)[3][2], R = name === 'thumb' ? 0.0098 : FING.find((x) => x[0] === name)[4][2];
    // nail plate: a thin curved shell set into the fingertip; lunula, pink nail bed, whiter free edge (vertex colours)
    const nu = 10, nw = 8, npos = [], ncol = [], nidx = [], Ln = L * 0.62, Wn = R * 0.78;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nw; j++) {
      const u = i / nu, v = j / nw * 2 - 1, w = Wn * (u < 0.15 ? 0.82 + u * 1.2 : 1) * (u > 0.9 ? Math.sqrt(1 - ((u - 0.9) / 0.1) ** 2) * 0.3 + 0.7 : 1);
      const x = L * 0.4 + u * Ln, z = v * w, y = R * 0.9 - (z * z) / (R * 2.4) - (u - 0.5) ** 2 * R * 0.12 + (u > 0.88 ? (u - 0.88) * R * 0.25 : 0);
      npos.push(x, y, z);
      const lun = (1 - smoothstep(0.1, 0.22, Math.hypot(u, v * 0.35))), free = smoothstep(0.84, 0.92, u);
      const c = [lerp(lerp(0.86, 0.95, lun), 0.97, free), lerp(lerp(0.62, 0.86, lun), 0.95, free), lerp(lerp(0.6, 0.84, lun), 0.9, free)];
      ncol.push(Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2));
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nw; j++) { const a = i * (nw + 1) + j, c2 = a + nw + 1; nidx.push(a, a + 1, c2, a + 1, c2 + 1, c2); }
    const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(npos, 3)); ng.setAttribute('color', new THREE.Float32BufferAttribute(ncol, 3)); ng.setIndex(nidx); ng.computeVertexNormals();
    const nm = new THREE.Mesh(ng, nailMat); nm.castShadow = true; b.add(nm);
  }
  // sleeve with a rolled cuff and a closed far end
  const sl = new THREE.CylinderGeometry(0.052, 0.064, 0.7, 32, 10, true); sl.rotateZ(Math.PI / 2); sl.translate(-0.66, 0.016, 0);
  const sp = sl.attributes.position;
  for (let i = 0; i < sp.count; i++) { const a = Math.atan2(sp.getZ(i), sp.getY(i) - 0.016); sp.setY(i, sp.getY(i) + 0.004 * Math.sin(a * 5 + sp.getX(i) * 30)); sp.setZ(i, sp.getZ(i) * 1.12); }
  sl.computeVertexNormals();
  const cuff = new THREE.TorusGeometry(0.056, 0.012, 12, 40); cuff.rotateY(Math.PI / 2); cuff.scale(1, 1, 1.12); { const cp = cuff.attributes.position; for (let i = 0; i < cp.count; i++) { const a = Math.atan2(cp.getZ(i), cp.getY(i)); cp.setX(i, cp.getX(i) + 0.003 * Math.sin(a * 7)); } cuff.computeVertexNormals(); } cuff.translate(-0.31, 0.016, 0);   // rolled-up cuff
  const cap = new THREE.CircleGeometry(0.066, 24); cap.rotateY(-Math.PI / 2); cap.scale(1, 1, 1.12); cap.translate(-1.01, 0.016, 0);
  for (const g of [sl, cuff, cap]) { const m = new THREE.Mesh(g, sleeveMat); m.castShadow = m.receiveShadow = true; root.add(m); }
  root.visible = false;
  root.traverse((o) => o.layers.set(LAYER.BOTH));                   // fingers dipped in the water stay visible through it
  scene.add(root);
  FEED.hand = { root, J, tips, mesh: hand, palm: palmBone };
  // floating pellets
  const pg = new THREE.IcosahedronGeometry(0.0058, 2);
  const ppos = pg.attributes.position;
  for (let i = 0; i < ppos.count; i++) { const k = 1 + 0.12 * vnoise3(ppos.getX(i) * 900, ppos.getY(i) * 900, ppos.getZ(i) * 900, 4); ppos.setXYZ(i, ppos.getX(i) * k, ppos.getY(i) * k * 0.85, ppos.getZ(i) * k); }
  pg.computeVertexNormals();
  const pm = physical({ color: 0xc08a4e, map: TEX.boulder.map, roughness: 0.62, clearcoat: 0.35 }, { key: 'pellet' });
  FEED.pelletMesh = new THREE.InstancedMesh(pg, pm, 80); FEED.pelletMesh.count = 0; FEED.pelletMesh.castShadow = true; FEED.pelletMesh.frustumCulled = false;
  setLayer(FEED.pelletMesh, LAYER.SURFACE); scene.add(FEED.pelletMesh);
  buildSplashes();
}
// Poses (absolute flexion per joint): pinch holding food, rubbing thumb against fingers, relaxed/open
const _tq = new THREE.Quaternion(), _tq2 = new THREE.Quaternion(), _ty = new THREE.Vector3(0, 1, 0), _tz = new THREE.Vector3(0, 0, 1);
export function poseHand(pinch, rub, t) {
  const J = FEED.hand.J, o = Math.sin(t * 18) * rub;
  const curl = (name, a, b, c) => {
    const j = J[name];
    _tq.setFromAxisAngle(_tz, -a + 0.12); j[0].quaternion.copy(j[0].userData.restQ).multiply(_tq);
    j[1].rotation.z = -b; j[2].rotation.z = -c;
  };
  curl('index', lerp(0.2, 0.72, pinch) + o * 0.1, lerp(0.2, 0.8, pinch) + o * 0.14, lerp(0.12, 0.45, pinch));
  curl('middle', lerp(0.22, 0.78, pinch) - o * 0.08, lerp(0.22, 0.82, pinch), lerp(0.12, 0.45, pinch));
  curl('ring', lerp(0.3, 1.0, pinch), lerp(0.3, 1.05, pinch), lerp(0.15, 0.65, pinch));
  curl('pinky', lerp(0.38, 1.1, pinch), lerp(0.35, 1.1, pinch), lerp(0.2, 0.7, pinch));
  const th = J.thumb;
  _tq.setFromAxisAngle(_ty, -0.55 * pinch + o * 0.18); _tq2.setFromAxisAngle(_tz, -0.25 * pinch);
  th[0].quaternion.copy(th[0].userData.restQ).multiply(_tq).multiply(_tq2);
  th[1].rotation.z = -(0.15 + pinch * 0.3); th[2].rotation.z = -(0.12 + pinch * 0.3 + o * 0.15);
}
// Relaxed open hand for stroking: fingers long and nearly straight, a little apart, softly following the curve below
export function poseHandFlat(k, t) {
  const J = FEED.hand.J, br = Math.sin(t * 1.3) * 0.02;
  const set = (name, a, b, c, sp) => {
    const j = J[name];
    _tq.setFromAxisAngle(_tz, -a); _tq2.setFromAxisAngle(_ty, sp); j[0].quaternion.copy(j[0].userData.restQ).multiply(_tq2).multiply(_tq);
    j[1].rotation.z = -b; j[2].rotation.z = -c;
  };
  set('index', 0.02 + br, lerp(0.14, 0.06, k), lerp(0.1, 0.05, k), 0.06);
  set('middle', 0.03, lerp(0.16, 0.07, k), lerp(0.11, 0.05, k), 0.0);
  set('ring', 0.05 - br, lerp(0.2, 0.1, k), lerp(0.13, 0.07, k), -0.05);
  set('pinky', 0.08, lerp(0.26, 0.14, k), lerp(0.16, 0.09, k), -0.12);
  const th = J.thumb;
  _tq.setFromAxisAngle(_ty, 0.1); _tq2.setFromAxisAngle(_tz, 0.05);
  th[0].quaternion.copy(th[0].userData.restQ).multiply(_tq).multiply(_tq2);
  th[1].rotation.z = -0.08; th[2].rotation.z = -0.06;
}
const _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), _hm = new THREE.Matrix4(), _tip = new THREE.Vector3(), _tip2 = new THREE.Vector3();
const _hf = new THREE.Vector3(), _hr = new THREE.Vector3(), _hu = new THREE.Vector3(), _hh = new THREE.Vector3(), _ha = new THREE.Vector3(), _hs = new THREE.Vector3(), _hx = new THREE.Vector3(), _hy = new THREE.Vector3(), _hz = new THREE.Vector3();
// Feeding shot: crouched at the shore nearest to where you are, looking down at the water. The hand is first-person:
// it reaches in from the lower-right edge of the frame and the sleeve runs out of view past the camera.
