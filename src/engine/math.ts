/**
 * Procedural math and noise generation utilities.
 */

export function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export let rng = mulberry32(20240917);
export const rand = () => rng();
export const rr = (a: number, b: number) => a + (b - a) * rng();
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const DEG = Math.PI / 180;

export function hash3i(x: number, y: number, z: number, s: number) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(s | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

// 3D value noise in [-1, 1]
export function vnoise3(x: number, y: number, z: number, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const h = (a: number, b: number, c: number) => hash3i(xi + a, yi + b, zi + c, s);
  return (
    lerp(
      lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v),
      lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v),
      w
    ) * 2 - 1
  );
}

export function fbm3(x: number, y: number, z: number, oct = 4, s = 0) {
  let a = 0.5, f = 1, sum = 0, n = 0;
  for (let o = 0; o < oct; o++) {
    sum += a * vnoise3(x * f, y * f, z * f, s + o * 17);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return sum / n;
}

// 2D value noise, periodic with integer period p (for seamless textures)
export function vnoise2P(x: number, y: number, p: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = fade(x - xi), v = fade(y - yi);
  const X0 = ((xi % p) + p) % p, Y0 = ((yi % p) + p) % p, X1 = (X0 + 1) % p, Y1 = (Y0 + 1) % p;
  return (
    lerp(
      lerp(hash3i(X0, Y0, 0, s), hash3i(X1, Y0, 0, s), u),
      lerp(hash3i(X0, Y1, 0, s), hash3i(X1, Y1, 0, s), u),
      v
    ) * 2 - 1
  );
}

export function fbm2P(x: number, y: number, p: number, oct: number, s: number, gain = 0.5) {
  let a = 0.5, f = 1, sum = 0, n = 0;
  for (let o = 0; o < oct; o++) {
    sum += a * vnoise2P(x * f, y * f, p * f, s + o * 31);
    n += a;
    a *= gain;
    f *= 2;
  }
  return sum / n;
}

export const WOR = { f1: 0, f2: 0, id: 0 };
export function worleyP(x: number, y: number, p: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 1e9, d2 = 1e9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ((xi + dx) % p + p) % p, cy = ((yi + dy) % p + p) % p;
      const px = cx + hash3i(cx, cy, 1, s), py = cy + hash3i(cx, cy, 2, s);
      const d = (x - (xi + dx + px - cx)) ** 2 + (y - (yi + dy + py - cy)) ** 2;
      if (d < d1) { d2 = d1; d1 = d; id = hash3i(cx, cy, 3, s); }
      else if (d < d2) { d2 = d; }
    }
  }
  WOR.f1 = Math.sqrt(d1); WOR.f2 = Math.sqrt(d2); WOR.id = id;
  return WOR;
}

export function srgbHex(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function mix3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
