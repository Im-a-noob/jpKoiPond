// @ts-nocheck
import * as THREE from "three";
import { P, WATER_Y, LAYER } from "../params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG } from "../math";
import { rockGeo, taperTube, woodBox, mergeGeos, weld, roundedBox, placed, setLayer, surfaceNets } from "../geometry";
import { $, progress, toast } from "../state";
import { FEED } from "./handMesh";
import { STATE } from "../state";
import { SH, camera, sunState } from "./lighting";
import { WX } from "./weather";
import { WF, wfWorld } from "./waterfallMesh";
import { splashSound } from "./bubbles";
const _sv = new THREE.Vector3(), _fw = new THREE.Vector3();
/* --- Ambient soundscape (WebAudio, fully generated): lapping water, trickle, drips and plops, a shishi-odoshi,
       leaves in the wind, distant birds, frog croaks, feeding splashes; room reverb; muffled low-pass under water */
export const AUDIO = { ctx: null };
export function noiseBuffer(ctx, sec, kind) {
  const len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let b0 = 0, b1 = 0, b2 = 0, br = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { br = (br + 0.02 * w) / 1.02; d[i] = br * 3.5; }
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12; }
      else d[i] = w * 0.5;
    }
    // crossfade the loop seam
    const f = Math.min(2000, len >> 3); for (let i = 0; i < f; i++) { const t = i / f; d[i] = d[i] * t + d[len - f + i] * (1 - t); }
  }
  return buf;
}
export function startAudio(force) {
  if (!P.audio && !force) return;
  try {
    if (AUDIO.ctx) { AUDIO.ctx.resume(); AUDIO.master.gain.setTargetAtTime(P.volume, AUDIO.ctx.currentTime, 0.4); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    // master chain: sources -> dry + reverb -> underwater low-pass -> master
    const master = ctx.createGain(); master.gain.value = 0;
    const under = ctx.createBiquadFilter(); under.type = 'lowpass'; under.frequency.value = 18000; under.Q.value = 0.6;
    const bus = ctx.createGain(), wet = ctx.createGain(); wet.gain.value = 0.28;
    const verb = ctx.createConvolver();
    { const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 400 ? i / 400 : 1); }
      verb.buffer = ir; }
    bus.connect(under); bus.connect(verb); verb.connect(wet); wet.connect(under);
    under.connect(master); master.connect(ctx.destination);
    const pink = noiseBuffer(ctx, 6, 'pink'), brown = noiseBuffer(ctx, 6, 'brown'), white = noiseBuffer(ctx, 3, 'white');
    const loop = (buf, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(now + Math.random()); return s; };
    const lfo = (freq, depth, target, offset = 0) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = freq; g.gain.value = depth; o.connect(g).connect(target); o.start(now + offset); return o; };
    // 1) gentle lapping: low band of brown noise swelling slowly
    const lap = ctx.createBiquadFilter(); lap.type = 'bandpass'; lap.frequency.value = 420; lap.Q.value = 0.7;
    const lapG = ctx.createGain(); lapG.gain.value = 0.22; lfo(0.13, 0.1, lapG.gain); lfo(0.31, 0.05, lapG.gain, 1.3);
    loop(brown).connect(lap).connect(lapG).connect(bus);
    // 2) a small trickle (bamboo spout): narrow band, fluttering amplitude
    const tri = ctx.createBiquadFilter(); tri.type = 'bandpass'; tri.frequency.value = 2300; tri.Q.value = 2.2;
    const triG = ctx.createGain(); triG.gain.value = 0.05; lfo(5.3, 0.025, triG.gain); lfo(1.7, 0.015, triG.gain);
    const triP = ctx.createStereoPanner(); triP.pan.value = 0.55;
    loop(white, 0.9).connect(tri).connect(triG).connect(triP).connect(bus);
    // 3) leaves in the wind: pink noise, band-limited, driven by the gusts
    const leafHP = ctx.createBiquadFilter(); leafHP.type = 'highpass'; leafHP.frequency.value = 900;
    const leafLP = ctx.createBiquadFilter(); leafLP.type = 'lowpass'; leafLP.frequency.value = 5200;
    const leafG = ctx.createGain(); leafG.gain.value = 0.05;
    loop(pink, 1.1).connect(leafHP).connect(leafLP).connect(leafG).connect(bus);
    // 4) underwater rumble (only audible below the surface)
    const rum = ctx.createBiquadFilter(); rum.type = 'lowpass'; rum.frequency.value = 160;
    const rumG = ctx.createGain(); rumG.gain.value = 0;
    loop(brown, 0.6).connect(rum).connect(rumG).connect(master);
    // 5) feeding activity bed: churned water
    const churn = ctx.createBiquadFilter(); churn.type = 'bandpass'; churn.frequency.value = 900; churn.Q.value = 0.8;
    const churnG = ctx.createGain(); churnG.gain.value = 0; lfo(7.1, 0.0, churnG.gain);
    loop(white, 1.3).connect(churn).connect(churnG).connect(bus);
    // 6) the waterfall: broadband splash + low body, placed in the stereo field and attenuated by distance
    const fallHi = ctx.createBiquadFilter(); fallHi.type = 'bandpass'; fallHi.frequency.value = 1600; fallHi.Q.value = 0.45;
    const fallLo = ctx.createBiquadFilter(); fallLo.type = 'lowpass'; fallLo.frequency.value = 420;
    const fallG = ctx.createGain(); fallG.gain.value = 0; const fallP = ctx.createStereoPanner();
    const fallLoG = ctx.createGain(); fallLoG.gain.value = 0.5;
    loop(white, 1.0).connect(fallHi).connect(fallG); loop(brown, 1.2).connect(fallLo).connect(fallLoG).connect(fallG);
    fallG.connect(fallP).connect(bus);
    // 7) rain: a soft broadband hiss on leaves and water
    const rainHP = ctx.createBiquadFilter(); rainHP.type = 'highpass'; rainHP.frequency.value = 700;
    const rainLP = ctx.createBiquadFilter(); rainLP.type = 'lowpass'; rainLP.frequency.value = 9000;
    const rainG = ctx.createGain(); rainG.gain.value = 0;
    loop(pink, 1.0).connect(rainHP).connect(rainLP).connect(rainG).connect(bus);
    master.gain.setTargetAtTime(P.volume, now, 0.8);
    Object.assign(AUDIO, { ctx, master, under, bus, lapG, leafG, rumG, churnG, white, fallG, fallP, rainG, nextBird: 1.5, nextDrip: 1, nextShishi: rr(12, 30), splashT: 0 });
  } catch (e) { console.warn('audio unavailable', e); }
}
export function stopAudio() { if (AUDIO.ctx) AUDIO.master.gain.setTargetAtTime(0, AUDIO.ctx.currentTime, 0.25); }
// one-shot helpers
export function tone(type, f0, f1, dur, gain, pan = 0, t0 = 0, dest) {
  const ctx = AUDIO.ctx, t = ctx.currentTime + t0, o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  p.pan.value = pan; o.connect(g).connect(p).connect(dest || AUDIO.bus); o.start(t); o.stop(t + dur + 0.05);
}
export function burst(freq, q, dur, gain, pan = 0, t0 = 0, sweepTo) {
  const ctx = AUDIO.ctx, t = ctx.currentTime + t0, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
  s.buffer = AUDIO.white; f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t); if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur); f.Q.value = q;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  p.pan.value = pan; s.connect(f).connect(g).connect(p).connect(AUDIO.bus); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
}
// Birds: a Japanese bush-warbler style call, soft trills and short chirps, placed far off in the stereo field
export function birdCall() {
  const pan = rr(-0.85, 0.85), kind = rand();
  if (kind < 0.35) {                                   // long rising whistle, then a quick descending flourish
    tone('sine', 1400, 1750, 0.9, 0.05, pan);
    tone('sine', 2600, 2100, 0.12, 0.05, pan, 1.0); tone('sine', 2400, 1700, 0.18, 0.05, pan, 1.14); tone('sine', 2000, 1500, 0.25, 0.04, pan, 1.35);
  } else if (kind < 0.7) {                             // trill
    const f = rr(3200, 4600), n = 6 + (rand() * 8 | 0);
    for (let i = 0; i < n; i++) tone('sine', f * rr(0.97, 1.03), f * 0.8, 0.05, 0.022, pan, i * 0.07);
  } else {                                             // two or three short chirps
    const f = rr(2400, 3800), n = 2 + (rand() * 2 | 0);
    for (let i = 0; i < n; i++) tone('sine', f, f * 1.35, 0.07, 0.03, pan, i * rr(0.12, 0.2));
  }
}
export function shishiOdoshi() {                              // bamboo deer-scarer: a hollow wooden knock and its echo off the garden
  const pan = 0.6;
  tone('sine', 820, 700, 0.18, 0.14, pan); tone('triangle', 330, 290, 0.25, 0.1, pan); burst(1800, 6, 0.05, 0.12, pan);
  tone('sine', 820, 700, 0.12, 0.03, pan, 0.28);
  burst(600, 1.2, 0.5, 0.05, pan, 0.02, 300);          // water pouring out of the tipped stem
}
export function audioEvent(name, arg) {
  if (!AUDIO.ctx || !P.audio) return;
  const ctx = AUDIO.ctx;
  if (name === 'plip') { tone('sine', rr(1800, 2600), rr(900, 1200), 0.06, 0.03, rr(-0.3, 0.3)); }
  else if (name === 'gulp') { tone('sine', rr(380, 480), rr(140, 180), 0.12, 0.09, rr(-0.3, 0.3)); burst(rr(700, 1100), 1.5, 0.12, 0.06, rr(-0.3, 0.3)); }
  else if (name === 'splash') { if (ctx.currentTime - AUDIO.splashT < 0.05) return; AUDIO.splashT = ctx.currentTime; burst(rr(900, 1500), 0.9, rr(0.15, 0.35), 0.05 * Math.min(1.5, arg || 1), rr(-0.4, 0.4), 0, 400); }
  else if (name === 'frogLand') { tone('sine', rr(170, 210), rr(90, 110), 0.09, 0.07, -0.2); burst(rr(1400, 2000), 1.2, 0.08, 0.025, -0.2, 0, 700); }
  else if (name === 'feedStart') { burst(3000, 2, 0.4, 0.02, 0.2, 0.3, 1500); }
  else if (name === 'croak') {
    const n = arg || 2, pan = -0.35;
    for (let k = 0; k < n; k++) {
      const t = k * 0.62, o = ctx.createOscillator(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(95, ctx.currentTime + t); o.frequency.linearRampToValueAtTime(78, ctx.currentTime + t + 0.4);
      f1.type = 'bandpass'; f1.frequency.value = 520; f1.Q.value = 3; f2.type = 'bandpass'; f2.frequency.value = 1250; f2.Q.value = 4;
      const am = ctx.createOscillator(), amg = ctx.createGain(); am.frequency.value = 26; amg.gain.value = 0.04; am.connect(amg).connect(g.gain);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.45);
      o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(p).connect(AUDIO.bus); p.pan.value = pan;
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.5); am.start(ctx.currentTime + t); am.stop(ctx.currentTime + t + 0.5);
    }
  }
}
export function updateAudio(dt) {
  if (!AUDIO.ctx || !P.audio) return;
  const ctx = AUDIO.ctx, now = ctx.currentTime, ex = typeof FEED !== 'undefined' ? FEED.excite : 0;
  AUDIO.master.gain.setTargetAtTime(P.volume, now, 0.3);
  // underwater: everything muffled, a low rumble swells in
  AUDIO.under.frequency.setTargetAtTime(STATE.under ? 420 : 18000, now, STATE.under ? 0.05 : 0.15);
  AUDIO.rumG.gain.setTargetAtTime(STATE.under ? 0.35 : 0, now, 0.2);
  AUDIO.leafG.gain.setTargetAtTime(STATE.under ? 0.005 : 0.02 + 0.12 * P.windSpeed * (0.4 + SH.uGust.value), now, 0.4);
  AUDIO.lapG.gain.setTargetAtTime(0.16 + 0.1 * P.windSpeed + 0.15 * ex, now, 0.5);
  AUDIO.churnG.gain.setTargetAtTime(0.06 * ex, now, 0.3);
  if (AUDIO.rainG) {
    AUDIO.rainG.gain.setTargetAtTime(WX.cur.rain * (STATE.under ? 0.04 : 0.28), now, 0.5);
    if (WX.cur.rain > 0.2 && rand() < dt * 9 * WX.cur.rain) splashSound(0.03, rr(-0.9, 0.9), rr(0.1, 0.3));   // individual drops plinking on the pond
  }
  if (WF.site && AUDIO.fallG) {
    const I = WF.impacts[1] ? WF.impacts[1].p : wfWorld(0, 0, 0.2), dx = I.x - camera.position.x, dz = I.z - camera.position.z, d = Math.hypot(dx, dz, I.y - camera.position.y);
    camera.getWorldDirection(_fw); const rightX = -_fw.z, rightZ = _fw.x, rl = Math.hypot(rightX, rightZ) || 1;
    AUDIO.fallG.gain.setTargetAtTime((STATE.under ? 0.15 : 0.32) / (1 + d * d * 0.09), now, 0.2);
    AUDIO.fallP.pan.setTargetAtTime(clamp((dx * rightX + dz * rightZ) / rl / Math.max(d, 0.5), -0.9, 0.9), now, 0.2);
  }
  // sporadic events
  AUDIO.nextDrip -= dt;
  if (AUDIO.nextDrip < 0) { AUDIO.nextDrip = rr(1.5, 5) / (1 + ex * 3); if (rand() < 0.6) tone('sine', rr(900, 1400), rr(350, 500), rr(0.08, 0.14), rr(0.015, 0.035), rr(-0.7, 0.7)); else burst(rr(500, 900), 2, 0.1, 0.02, rr(-0.7, 0.7)); }
  AUDIO.nextShishi -= dt;
  if (AUDIO.nextShishi < 0) { AUDIO.nextShishi = rr(45, 80); if (!STATE.under) shishiOdoshi(); }
  AUDIO.nextBird -= dt;
  if (AUDIO.nextBird < 0) { AUDIO.nextBird = rr(3, 11); if (!STATE.under && sunState.elev > 3 * DEG && WX.cur.rain < 0.3 && WX.cur.snow < 0.3) birdCall(); }
}

