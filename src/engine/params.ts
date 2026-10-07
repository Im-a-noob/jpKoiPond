// @ts-nocheck
/* ------------------------------------------------------------------ 0. PARAMETERS */
const P = {
  timeOfDay: 10.5,        // hours, 6..19
  sunAzimuth: 55,         // degrees, rotates the whole sun path
  windSpeed: 0.35,        // 0..1
  windDir: 35,            // degrees (0 = +x)
  waterClarity: 1.6,      // 0.3 (murky) .. 2 (crystal) — scales absorption & scattering inversely
  waveHeight: 1.0,        // multiplier on 0.5–2 cm Gerstner amplitudes
  causticStrength: 1.0,
  fishCount: 20,
  quality: 'High',
  autoQuality: true,
  exposure: 0.9,
  weather: 'Sunny',
  movie: true, letterbox: true, tourSeasons: false,
  dof: true, fStop: 8, dofStrength: 1, sharpen: 0.35,   // f/8: the whole garden in focus, like a daylight landscape photo
  bloomStrength: 0.3,
  bloomThreshold: 0.9,
  ssao: true,
  godRays: true,
  grain: 0.01,
  vignette: 0.32,
  cameraMode: 'Cinematic',
  holdCamera: false,       // hold the current shot (no camera motion at all)
  freezeScene: false,      // stop time: fish, water, wind, everything
  stayAbove: true,         // cinematic path skips the underwater dive unless enabled
  cleanView: false,        // screenshot mode: hides every overlay
  pathSpeed: 1.0,
  audio: true,             // starts on the first click / key press (browser autoplay rules)
  volume: 0.7,
};
const WATER_Y = 0.0;
// Render layers: every camera sees layer 0 (lights); meshes live on exactly one of these.
const LAYER = { ABOVE: 1, UNDER: 2, BOTH: 3, WATER: 4, SKY: 5, SURFACE: 6 };   // SURFACE: lies on the water (pads, petals): never mirrored
const KOI_MAX = 20;

export { P, WATER_Y, LAYER, KOI_MAX };
