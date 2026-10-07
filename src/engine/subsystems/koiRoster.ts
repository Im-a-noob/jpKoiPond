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
export const KOI_STYLES = {
  // flags: utsuri (sumi wraps the flanks, menware on the head), hajiro (white fin tips), doitsu (scaleless, mirror-scale rows)
  kohaku:   { steps: 3, base: 0xe8e4dc, hi: 0xe8481c, sumi: 0x151416, belly: 0xebe7e0, fin: 0xe6e2db, finBase: 0xef6a2a, hiCover: 0.56, sumiCover: 0, moto: 0.9 },
  sanke:    { steps: 3, base: 0xe8e4dc, hi: 0xea4d1e, sumi: 0x121214, belly: 0xebe7e0, fin: 0xe6e2db, finBase: 0xee6428, hiCover: 0.52, sumiCover: 0.3, moto: 0.85 },
  showa:    { base: 0xe5e0d8, hi: 0xdf3f1a, sumi: 0x0f0f11, belly: 0xe3ded6, fin: 0xe2ddd6, finBase: 0x141416, hiCover: 0.45, sumiCover: 0.62, moto: 1, utsuri: 1, hajiro: 0.35 },
  yamabuki: { base: 0xf6ae1c, hi: 0xf6ae1c, sumi: 0x000000, belly: 0xf9c95a, fin: 0xf7c35a, finBase: 0xf0a020, hiCover: 0, sumiCover: 0, moto: 0.4, metal: 1, irid: 0.55, retic: -0.32 },
  asagi:    { base: 0x6d8094, hi: 0xde5a26, sumi: 0x000000, belly: 0xe7dfd6, fin: 0xe9e4de, finBase: 0xde6a2e, hiCover: 0, sumiCover: 0, moto: 1, retic: 0.8, asagi: 1 },
  tancho:   { base: 0xebe8e2, hi: 0xd92a1b, sumi: 0x000000, belly: 0xedeae4, fin: 0xe8e4dc, finBase: 0xe8e4dc, hiCover: 0, sumiCover: 0, moto: 0, tancho: 1 },
  platinum: { base: 0xe4e2dc, hi: 0xe4e2dc, sumi: 0x000000, belly: 0xefede8, fin: 0xeae8e3, finBase: 0xdad7d0, hiCover: 0, sumiCover: 0, moto: 0.3, metal: 1, irid: 0.6, retic: 0.2 },
  chagoi:   { base: 0x7b5634, hi: 0x7b5634, sumi: 0x000000, belly: 0x9b7a55, fin: 0x8c6a48, finBase: 0x6e4c30, hiCover: 0, sumiCover: 0, moto: 0.6, retic: -0.7 },
  bekko:    { base: 0xe8e4dc, hi: 0xe8e4dc, sumi: 0x131315, belly: 0xebe7e0, fin: 0xe6e2db, finBase: 0x303032, hiCover: 0, sumiCover: 0.28, moto: 0.5 },
  orenji:   { base: 0xf86e12, hi: 0xf86e12, sumi: 0x000000, belly: 0xfa9a40, fin: 0xf4a052, finBase: 0xe46a18, hiCover: 0, sumiCover: 0, moto: 0.4, metal: 1, irid: 0.5, retic: -0.2 },   // Orenji Ogon
  karasu:   { base: 0x141316, hi: 0x141316, sumi: 0x0b0b0d, belly: 0x2e2a27, fin: 0x1b1a1d, finBase: 0x0e0e10, hiCover: 0, sumiCover: 0, moto: 0, retic: 0.3, hajiro: 0.9 },  // Karasugoi, 'crow' koi
  shiroutsuri: { base: 0xe9e6df, hi: 0xe9e6df, sumi: 0x0f0f11, belly: 0xe8e4dc, fin: 0xe6e2db, finBase: 0x121214, hiCover: 0, sumiCover: 0.55, moto: 1, utsuri: 1 },
  hiutsuri: { base: 0xdc4a1c, hi: 0xdc4a1c, sumi: 0x0f0f11, belly: 0xe8763e, fin: 0xec8a4a, finBase: 0x141416, hiCover: 0, sumiCover: 0.5, moto: 1, utsuri: 1 },
  kujaku:   { base: 0xe2e0da, hi: 0xf07024, sumi: 0x2a2a2e, belly: 0xecebe6, fin: 0xe9e7e2, finBase: 0xef7a30, hiCover: 0.5, sumiCover: 0, moto: 0.6, metal: 1, irid: 0.6, retic: -0.85 },  // peacock: metallic, matsuba net
  doitsu:   { steps: 2.5, base: 0xebe8e1, hi: 0xe64418, sumi: 0x151416, belly: 0xedeae4, fin: 0xe6e2db, finBase: 0xef6a2a, hiCover: 0.6, sumiCover: 0, moto: 0.9, doitsu: 1 },   // Doitsu Kohaku (German, scaleless)
  goshiki:  { base: 0xcfd1d4, hi: 0xc8341c, sumi: 0x000000, belly: 0xdcdad6, fin: 0xdcdad6, finBase: 0xc54020, hiCover: 0.5, sumiCover: 0, moto: 0.7, retic: -0.75 },
  benigoi:  { base: 0xd4461a, hi: 0xd4461a, sumi: 0x000000, belly: 0xe8814a, fin: 0xe07a42, finBase: 0xcc4a1c, hiCover: 0, sumiCover: 0, moto: 0.3, retic: -0.32 },
  ochiba:   { base: 0x8a97a4, hi: 0xa8662e, sumi: 0x000000, belly: 0xd9d6cf, fin: 0xc9ccd0, finBase: 0xa0602c, hiCover: 0.45, sumiCover: 0, moto: 0.6, retic: 0.55 },   // Ochiba Shigure, 'autumn leaves on water'
};
// The pond's collection: [variety, size class (S juvenile ~25 cm, M ~45 cm, L jumbo ~70 cm), options: fly = butterfly / long-fin, gin = Gin Rin sparkle scales]
export const KOI_ROSTER_DEF = [
  ['kohaku', 'L'], ['sanke', 'M'], ['yamabuki', 'L'], ['showa', 'L'], ['orenji', 'M', { gin: 1 }], ['karasu', 'M'], ['tancho', 'M'], ['bekko', 'S'],
  ['sanke', 'S'], ['asagi', 'M'], ['platinum', 'M', { fly: 1 }], ['chagoi', 'L'], ['shiroutsuri', 'M'], ['hiutsuri', 'S'], ['kujaku', 'M', { fly: 1 }],
  ['doitsu', 'M'], ['goshiki', 'S'], ['benigoi', 'S'], ['ochiba', 'M'], ['kohaku', 'S', { gin: 1 }],
];
export const KOI_ROSTER = KOI_ROSTER_DEF.map((r) => r[0]);
export const KOI_N = KOI_ROSTER.length;
export const KOI_SIZE_RANGE = { S: [0.21, 0.29], M: [0.38, 0.5], L: [0.62, 0.74] };

// Pattern fields per fish (resolution-independent edges are recovered in the shader):
// R = hi (red) field, G = sumi (black) field, B = fine tone variation, A = belly / ventral field. 0.5 = pattern edge.
