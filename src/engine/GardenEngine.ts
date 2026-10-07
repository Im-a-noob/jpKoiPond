// @ts-nocheck
/**
 * GardenEngine - Modular Orchestrator
 * Coordinates Three.js subsystems, render loop, resize observer, and React integration.
 */
import * as THREE from "three";
import * as dat from "dat.gui";
import { P, WATER_Y, LAYER } from "./params";
import { rand, rr, clamp, lerp, smoothstep, vnoise3, fbm3, DEG } from "./math";
import { rockGeo, taperTube, woodBox, mergeGeos } from "./geometry";
import { KOI_COLLECTION_DATA } from "./koiData";
import { $, progress, toast } from "./state";
import * as Subsystems from "./subsystems";
import {
  renderer, scene, camera, shadowCam, reflCam, refrCam, sun, SH, RES,
  makeTargets, buildPost, renderPost,
  buildSDF, setupWaterfallSite, buildTextures, buildPlantTextures,
  buildTerrain, buildStones, woodMaterials, buildBridge, buildPavilion,
  buildVegetation, buildTurtle, buildUnderwaterLife, buildWater,
  buildWaterfall, buildLanterns, buildPetals, buildFallingPetals,
  buildDragonflies, buildBubbles, buildPrecip, buildMountains,
  buildKoi, buildHand, updateSun, updateWaves, updateClarity,
  buildParticles, buildDivePost, setupControls,
  updateEnv, updateCamera,
  updateParticles, updateAudio, updateFish, updateFeeding, updateStroke,
  updatePondLife, updateWaterfall, updateUnderwaterLife, updateLanterns,
  updatePetals, updateFallingPetals, updateDragonflies, updateBubbles,
  updateWeather, updatePrecip, updateMountains, hoverRipples, stepRipples,
  renderWaterPasses, mirrorCamera, setCamLayers,
  startAudio, startFeeding, startStroke, setHold, setFreeze, setClean,
  cycleWeather, setWeather, setMuted, setGuide, toggleCameraMode,
  RT, TEX, CTRL, FOLLOW, WX_PRESETS, KOI_N,
  waterHeightAt, sdf, skyUniforms, waterMat, reflMatrix,
  FEED, WORLD, VIEWS, goToView, onCameraMode, envDirty
} from "./subsystems";
import { shared } from "./state";

export interface GardenEngineOptions {
  onProgress?: (progress: number, message: string) => void;
  onToast?: (message: string) => void;
  onCaption?: (caption: string) => void;
  onHUDStats?: (stats: any) => void;
  onFollowKoi?: (koi: any) => void;
  onCameraModeChange?: (mode: string) => void;
  onWeatherChange?: (weather: string) => void;
  onMuteChange?: (muted: boolean) => void;
  onHoldChange?: (held: boolean) => void;
  onFreezeChange?: (frozen: boolean) => void;
  onReady?: () => void;
}

export function createGardenEngine(targetCanvas: HTMLCanvasElement, options: GardenEngineOptions = {}) {
  shared.options = options;
  shared.canvas = targetCanvas;
  let isDisposed = false;
  let animFrameId: number = 0;
  let envTimer = 0;

/* ------------------------------------------------------------------ 14. GUI, QUALITY, MAIN LOOP */
const GUI_CTRL = {};
function setQuality(q, silent) {
  P.quality = q;
  const w = typeof window !== 'undefined' ? window.innerWidth : 800;
  const h = typeof window !== 'undefined' ? window.innerHeight : 600;
  renderer.setPixelRatio((q === 'High' ? Math.min(devicePixelRatio, 1.6) : 1) * RES.scale);   // near-native on Retina: crisp, still ~60-90 fps
  renderer.setSize(w, h, false);
  sun.shadow.mapSize.set(q === 'High' ? 4096 : 2048, q === 'High' ? 4096 : 2048);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  for (const m of WORLD.leafMats || []) { m.alphaToCoverage = q === 'High'; m.needsUpdate = true; }
  makeTargets();
  if (GUI_CTRL.quality) GUI_CTRL.quality.updateDisplay();
}
function buildGUI() {
  const gui = new dat.GUI({ width: 290 });
  const fE = gui.addFolder('Environment');
  GUI_CTRL.weather = fE.add(P, 'weather', Object.keys(WX_PRESETS)).name('Weather / season').onChange(setWeather);
  GUI_CTRL.time = fE.add(P, 'timeOfDay', 6, 19, 0.05).name('Time of day').onChange(updateSun);
  fE.add(P, 'sunAzimuth', -180, 180, 1).name('Sun azimuth').onChange(updateSun);
  GUI_CTRL.wind = fE.add(P, 'windSpeed', 0, 1, 0.01).name('Wind').onChange(updateWaves);
  fE.add(P, 'windDir', 0, 360, 1).name('Wind direction').onChange(updateWaves);
  fE.open();
  const fW = gui.addFolder('Water');
  fW.add(P, 'waterClarity', 0.3, 2.0, 0.01).name('Clarity').onChange(updateClarity);
  fW.add(P, 'waveHeight', 0, 2.5, 0.01).name('Wave height').onChange(updateWaves);
  fW.add(P, 'causticStrength', 0, 2, 0.01).name('Caustics').onChange((v) => (SH.uCausticStr.value = v));
  fW.open();
  const fK = gui.addFolder('Koi');
  GUI_CTRL.fish = fK.add(P, 'fishCount', 0, KOI_N, 1).name('Fish count');
  fK.add({ feed: () => startFeeding() }, 'feed').name('Feed the koi (E)');
  fK.open();
  const fR = gui.addFolder('Rendering');
  GUI_CTRL.quality = fR.add(P, 'quality', ['Low', 'High']).name('Quality').onChange(setQuality);
  fR.add(P, 'autoQuality').name('Auto-drop to Low');
  GUI_CTRL.expo = fR.add(P, 'exposure', 0.3, 2, 0.01).name('Exposure');
  GUI_CTRL.bloom = fR.add(P, 'bloomStrength', 0, 1.5, 0.01).name('Bloom');
  fR.add(P, 'bloomThreshold', 0.2, 3, 0.01).name('Bloom threshold');
  GUI_CTRL.ssao = fR.add(P, 'ssao').name('SSAO');
  GUI_CTRL.god = fR.add(P, 'godRays').name('God rays');
  fR.add(P, 'grain', 0, 0.08, 0.001).name('Film grain');
  fR.add(P, 'vignette', 0, 1, 0.01).name('Vignette');
  fR.add(P, 'sharpen', 0, 1, 0.01).name('Lens sharpening');
  const fL = gui.addFolder('Lens (depth of field)');
  fL.add(P, 'dof').name('Depth of field + autofocus');
  fL.add(P, 'fStop', 1.4, 16, 0.1).name('Aperture (f-stop)');
  fL.add(P, 'dofStrength', 0, 2, 0.01).name('Max bokeh size');
  const fC = gui.addFolder('Camera');
  fC.add(P, 'movie').name('Cinematic = film tour');
  fC.add(P, 'letterbox').name('Letterbox bars');
  fC.add(P, 'tourSeasons').name('Change season each loop');
  GUI_CTRL.cam = fC.add(P, 'cameraMode', ['Cinematic', 'Manual', 'Follow koi', 'Follow turtle']).name('Mode').onChange(onCameraMode);
  const fV = gui.addFolder('Close-ups');
  for (const name of ['Turtle', ...Object.keys(VIEWS)]) fV.add({ go: () => goToView(name) }, 'go').name(name);
  fV.add({ go: () => { P.cameraMode = 'Follow koi'; onCameraMode(); } }, 'go').name('Follow a koi (K)');
  fC.add(P, 'pathSpeed', 0.2, 3, 0.01).name('Path speed');
  fC.add(P, 'stayAbove').name('Stay above water');
  GUI_CTRL.hold = fC.add(P, 'holdCamera').name('Hold shot (P)').onChange((v) => setHold(v));
  GUI_CTRL.freeze = fC.add(P, 'freezeScene').name('Freeze time (O)').onChange((v) => setFreeze(v));
  fC.add({ clean: () => setClean(true) }, 'clean').name('Clean view for screenshots (V)');
  fC.add(P, 'volume', 0, 1, 0.01).name('Volume');
  GUI_CTRL.audio = fC.add(P, 'audio').name('Sound').onChange((v) => setMuted(!v));
  fC.open();
  gui.close();                                        // keep the frame clean; 'Open Controls' (or H) brings it back
  GUI_CTRL.gui = gui;
}

// Frame timing: FPS counter + automatic drop to Low when frame time > 25 ms for 2 s
const perf = { ms: 16.7, fps: 60, slow: 0, acc: 0, frames: 0, sinceStart: 0 };
function updatePerf(rawDt) {
  perf.sinceStart += rawDt; perf.acc += rawDt; perf.frames++;
  if (rawDt > 0.25) return;                 // tab was hidden or a shader compiled: not a steady-state frame
  perf.ms = lerp(perf.ms, rawDt * 1000, 0.08);
  if (perf.acc >= 0.5) { perf.fps = perf.frames / perf.acc; perf.acc = 0; perf.frames = 0; }
  if (P.autoQuality && perf.sinceStart > 8) {
    // first trade resolution smoothly (down to 70 %), and only then drop to Low quality
    perf.slow = perf.ms > 22 ? perf.slow + rawDt : 0;
    perf.fast = perf.ms < 13 ? (perf.fast || 0) + rawDt : 0;
    if (perf.slow > 1.5) {
      perf.slow = 0;
      if (RES.scale > 0.62) { RES.scale = Math.max(0.6, RES.scale - 0.1); setQuality(P.quality, true); }
      else if (P.quality === 'High') { setQuality('Low'); toast('Frame time stayed over 22 ms — switched to Low quality'); }
    } else if (perf.fast > 4 && RES.scale < 1) { perf.fast = 0; RES.scale = Math.min(1, RES.scale + 0.1); setQuality(P.quality, true); }
  }
}
const STATE = { under: false, wasUnder: false, exitT: 99, depth: 0 };
let hudTimer = 0;
function updateHUD(dt) {
  hudTimer -= dt; if (hudTimer > 0) return; hudTimer = 0.25;
  $('hud').textContent = `${perf.fps.toFixed(0).padStart(3)} fps  ${perf.ms.toFixed(1).padStart(5)} ms\n${P.quality} · ${STATE.under ? 'underwater ' + STATE.depth.toFixed(2) + ' m' : 'above water'} · ${P.cameraMode}`;
  if (options.onHUDStats) {
    options.onHUDStats({
      fps: Math.round(perf.fps),
      ms: perf.ms,
      quality: P.quality,
      underwater: STATE.under,
      depth: STATE.depth,
      cameraMode: P.cameraMode,
      weather: P.weather,
      timeOfDay: P.timeOfDay,
    });
  }
}
function updateWind(t) {
  SH.uGust.value = clamp(0.5 + 0.9 * fbm3(t * 0.12, 3.3, 1.1, 3, 77), 0, 1);
}
function updateWaterState(t, dt) {
  const p = camera.position, wh = waterHeightAt(p.x, p.z, t);
  const inPond = sdf(p.x, p.z) < 0.15;
  STATE.wasUnder = STATE.under;
  STATE.under = inPond && p.y < wh - 0.005;
  STATE.depth = Math.max(0, wh - p.y);
  if (STATE.wasUnder && !STATE.under) STATE.exitT = 0; else STATE.exitT += dt;
  // lit water-body colour for in-scattering (sun + sky), dimmer with the camera's depth when submerged
  const irr = SH.uSunColor.value.r * Math.max(0.1, SH.uSunDir.value.y) * 0.9 + 0.55 * skyUniforms.uCloudBright.value;
  const dim = STATE.under ? Math.exp(-0.9 * STATE.depth / P.waterClarity) : 1;
  SH.uInscatter.value.setRGB(0.009 * irr * dim, 0.042 * irr * dim, 0.048 * irr * dim);
  waterMat.uniforms.uFoamColor.value.setRGB(0.8, 0.85, 0.82).multiplyScalar(irr * 0.22);
}
function updateWaterUniforms() {
  const u = waterMat.uniforms;
  u.uUnder.value = STATE.under ? 1 : 0;
  u.uGustW.value = SH.uGust.value * (0.3 + P.windSpeed * 1.2) + FEED.excite * 0.4;
  u.tRefl.value = RT.refl.texture; u.tRefr.value = RT.refr.texture; u.tRefrDepth.value = RT.refr.depthTexture;
  u.uInvRes.value.set(1 / RT.w, 1 / RT.h);
  u.uReflMatrix.value.copy(reflMatrix);
  u.uProj.value.copy(camera.projectionMatrix);
  u.uNear.value = camera.near; u.uFar.value = camera.far;
}
const clock = new THREE.Clock();
const SHADOW = { frame: 0, dirty: true };
let running = false;
function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta(), cdt = Math.min(rawDt, 0.05), dt = P.freezeScene ? 0 : cdt;   // camera keeps its own clock
  const t = (SH.uTime.value += dt);
  updatePerf(rawDt);
  updateWind(t);
  updateCamera(cdt, t);
  camera.updateMatrixWorld();
  updateWaterState(t, dt);
  updateParticles();
  updateAudio(dt);
  if (typeof updateFish === 'function') updateFish(dt, t);
  updateFeeding(dt, t);
  updateStroke(dt, t);
  updatePondLife(t, dt);
  updateWaterfall(t, dt);
  updateUnderwaterLife(t);
  updateLanterns();
  updatePetals(dt);
  updateFallingPetals(t, dt);
  updateDragonflies(t, dt);
  updateBubbles(t, dt);
  updateWeather(cdt);
  updatePrecip(t, dt);
  updateMountains();
  hoverRipples();
  stepRipples(dt);
  envTimer -= dt;
  if (envDirty && envTimer <= 0) { updateEnv(); envTimer = 0.2; }

  // 1) shadows: rendered once per frame through a camera that sees every layer
  SHADOW.frame++;
  if (SHADOW.dirty || SHADOW.frame % (P.quality === 'High' ? 2 : 3) === 0) {
    SHADOW.dirty = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(RT.tiny); renderer.render(scene, shadowCam);
  }
  // 2) reflection + refraction targets, 3) main HDR pass, 4) post
  renderWaterPasses(STATE.under);
  mirrorCamera(camera, reflCam);
  updateWaterUniforms();
  setCamLayers(camera, STATE.under ? [LAYER.UNDER, LAYER.BOTH, LAYER.WATER, LAYER.SURFACE] : [LAYER.ABOVE, LAYER.BOTH, LAYER.WATER, LAYER.SKY, LAYER.SURFACE]);
  SH.uCamUnder.value = STATE.under ? 1 : 0;
  renderer.setClearColor(STATE.under ? SH.uInscatter.value : 0x000000, 1);
  renderer.setRenderTarget(RT.main); renderer.clear(); renderer.render(scene, camera);
  renderPost();
  updateHUD(dt);
}



  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      makeTargets();
    });
  }

async function init() {
  try {
    await progress(0.02, 'Tracing the pond outline');
    buildSDF();
    setupWaterfallSite();
    await buildTextures();
    buildPlantTextures();
    SH.tCaustics.value = TEX.caustics;
    SH.uCausticNorm.value = 1 / (TEX.causticMean * TEX.causticMean);
    await progress(0.6, 'Shaping terrain and basin');
    buildTerrain();
    await progress(0.66, 'Setting stones');
    buildStones();
    woodMaterials();
    await progress(0.72, 'Building the bridge and pavilion');
    buildBridge();
    buildPavilion();
    await progress(0.8, 'Planting the garden');
    buildVegetation();
    buildTurtle();
    buildUnderwaterLife();
    await progress(0.86, 'Filling the pond');
    buildWater();
    buildWaterfall();
    buildLanterns();
    buildPetals();
    buildFallingPetals();
    buildDragonflies();
    buildBubbles();
    buildPrecip();
    buildMountains();
    if (typeof buildKoi === 'function') buildKoi();
    buildHand();
    updateSun(); updateWaves(); updateClarity();
    makeTargets();
    buildPost();
    buildParticles();
    buildDivePost();
    buildGUI();
    setupControls();
    $('feedbtn')?.addEventListener('click', () => { startAudio(); startFeeding(); });
    $('tb-cam')?.addEventListener('click', () => { startAudio(); toggleCameraMode(); });
    $('tb-hold')?.addEventListener('click', () => setHold(!P.holdCamera));
    $('tb-weather')?.addEventListener('click', () => { startAudio(); cycleWeather(); });
    $('tb-sound')?.addEventListener('click', () => setMuted(P.audio));
    $('help-close')?.addEventListener('click', () => setGuide(false));
    $('help-open')?.addEventListener('click', () => setGuide(true));
    { let m = false, g = true; try { m = localStorage.getItem('koi.muted') === '1'; g = localStorage.getItem('koi.guide') !== '0'; } catch (e) { /* storage unavailable */ }
      if (m) setMuted(true); setGuide(g); }
    $('strokebtn')?.addEventListener('click', () => { startAudio(); startStroke(); });
    $('tb-freeze')?.addEventListener('click', () => setFreeze(!P.freezeScene));
    $('tb-clean')?.addEventListener('click', () => setClean(true));
    await progress(0.93, 'Compiling shaders');
    updateEnv();
    const all = camera.clone(); all.layers.enableAll();
    renderer.compile(scene, all);
    await progress(1, 'Ready');
    clock.getDelta();
    frame();
    setTimeout(() => {
      try {
        const l = $('loader');
        if (l && l.style) l.style.opacity = '0';
        setTimeout(() => {
          try {
            if (l && typeof l.remove === 'function') l.remove();
          } catch (e) {}
        }, 900);
      } catch (e) {}
    }, 150);
  } catch (err: any) {
    console.error(err);
    const msgEl = $('loadmsg');
    if (msgEl) msgEl.textContent = 'Failed to start: ' + (err?.message || err);
  }
}

  // Single clean animation loop
  const _origFrame = frame;
  frame = () => {
    if (isDisposed) return;
    animFrameId = requestAnimationFrame(frame);
    _origFrame();
  };

  // Start initialization
  init().then(() => {
    options.onReady?.();
  });

  return {
    getParams: () => P,
    feed: () => {
      startAudio();
      startFeeding();
    },
    stroke: () => {
      startAudio();
      startStroke();
    },
    toggleCameraMode: () => {
      startAudio();
      toggleCameraMode();
      options.onCameraModeChange?.(P.cameraMode);
    },
    setCameraMode: (mode: string) => {
      startAudio();
      P.cameraMode = mode;
      Subsystems.onCameraMode?.();
      options.onCameraModeChange?.(mode);
    },
    followKoi: (idx: number) => {
      startAudio();
      P.cameraMode = "Follow koi";
      FOLLOW.idx = idx;
      Subsystems.onCameraMode?.();
      options.onCameraModeChange?.("Follow koi");
      options.onFollowKoi?.(KOI_COLLECTION_DATA[idx % KOI_N]);
    },
    unfollowKoi: () => {
      P.cameraMode = "Cinematic";
      Subsystems.onCameraMode?.();
      options.onCameraModeChange?.("Cinematic");
      options.onFollowKoi?.(null);
    },
    cycleWeather: () => {
      startAudio();
      cycleWeather();
      options.onWeatherChange?.(P.weather);
    },
    setWeather: (weather: string) => {
      startAudio();
      setWeather(weather);
      options.onWeatherChange?.(weather);
    },
    setMuted: (muted: boolean) => {
      setMuted(muted);
      options.onMuteChange?.(muted);
    },
    toggleMute: () => {
      setMuted(P.audio);
      options.onMuteChange?.(!P.audio);
    },
    setVolume: (vol: number) => {
      P.volume = vol;
    },
    setHold: (hold: boolean) => {
      setHold(hold);
      options.onHoldChange?.(hold);
    },
    setFreeze: (freeze: boolean) => {
      setFreeze(freeze);
      options.onFreezeChange?.(freeze);
    },
    setClean: (clean: boolean) => {
      setClean(clean);
    },
    setWaterClarity: (clarity: number) => {
      P.waterClarity = clarity;
      updateClarity();
    },
    setWaveHeight: (h: number) => {
      P.waveHeight = h;
      updateWaves();
    },
    setTimeOfDay: (hours: number) => {
      P.timeOfDay = hours;
      updateSun();
    },
    setCausticStrength: (str: number) => {
      P.causticStrength = str;
      SH.uCausticStr.value = str;
    },
    setBloomStrength: (b: number) => {
      P.bloomStrength = b;
    },
    setQuality: (q: string) => {
      setQuality(q);
    },
    toggleGUI: () => {
      const d = document.querySelector(".dg.ac") as HTMLElement | null;
      if (d) d.style.display = d.style.display === "none" ? "" : "none";
    },
    dispose: () => {
      isDisposed = true;
      cancelAnimationFrame(animFrameId);
      try {
        renderer.dispose();
      } catch (e) {}
      try {
        const d = document.querySelector(".dg.ac");
        if (d && d.parentElement) d.parentElement.removeChild(d);
      } catch (e) {}
    }
  };
}
