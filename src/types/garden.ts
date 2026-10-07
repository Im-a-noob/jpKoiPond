export interface KoiInfo {
  id: number;
  name: string;
  kanji: string;
  romaji: string;
  variety: string;
  category: string;
  size: 'small' | 'medium' | 'jumbo';
  lengthCm: number;
  description: string;
  patternDescription: string;
  colorPalette: string[];
  rarity: 'Common' | 'Uncommon' | 'Rare' | 'Prized';
  scaleType: 'Wagoi (Scaled)' | 'Doitsu (Scaleless/Mirror)' | 'Gin Rin (Diamond Scaled)' | 'Butterfly (Hirenaga)';
}

export type WeatherMode = 'Sunny' | 'Rain' | 'Autumn' | 'Winter';

export type CameraMode = 'Cinematic' | 'Manual' | 'Follow' | 'Follow koi';

export type QualityLevel = 'High' | 'Med' | 'Low' | 'Auto';

export interface GardenHUDStats {
  fps: number;
  ms?: number;
  quality?: string;
  underwater?: boolean;
  depth?: number;
  resolution?: string;
  timeOfDay?: string | number;
  fishCount?: number;
  weather?: WeatherMode | string;
  cameraMode?: CameraMode | string;
  caption?: string;
  isUnderwater?: boolean;
  isHeld?: boolean;
  isFrozen?: boolean;
  waterClarity?: number;
  followedKoi?: KoiInfo | null;
}

export interface GardenEngineParams {
  timeOfDay: number;
  sunAzimuth: number;
  windSpeed: number;
  windDir: number;
  waterClarity: number;
  waveHeight: number;
  causticStrength: number;
  fishCount: number;
  quality: QualityLevel;
  autoQuality: boolean;
  exposure: number;
  weather: WeatherMode;
  movie: boolean;
  letterbox: boolean;
  tourSeasons: boolean;
  dof: boolean;
  fStop: number;
  dofStrength: number;
  sharpen: number;
  bloomStrength: number;
  bloomThreshold: number;
  ssao: boolean;
  godRays: boolean;
  grain: number;
  vignette: number;
  cameraMode: CameraMode;
  holdCamera: boolean;
  freezeScene: boolean;
  stayAbove: boolean;
  cleanView: boolean;
  pathSpeed: number;
  audio: boolean;
  volume: number;
}
