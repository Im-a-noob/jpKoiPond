import React from 'react';
import {
  Camera,
  Lock,
  Pause,
  Play,
  Sun,
  CloudRain,
  Leaf,
  Snowflake,
  Volume2,
  VolumeX,
  Eye,
  Hand,
  Sparkles,
  BookOpen,
  Sliders,
  HelpCircle,
} from 'lucide-react';
import { CameraMode, WeatherMode } from '../types/garden';

export interface ToolbarProps {
  cameraMode: CameraMode;
  isHeld: boolean;
  isFrozen: boolean;
  isMuted: boolean;
  weather: WeatherMode;
  cleanView: boolean;
  onToggleCamera: () => void;
  onToggleHold: () => void;
  onToggleFreeze: () => void;
  onToggleWeather: () => void;
  onToggleMute: () => void;
  onToggleCleanView: () => void;
  onStrokeKoi: () => void;
  onFeedKoi: () => void;
  onOpenKoiPedia: () => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  cameraMode,
  isHeld,
  isFrozen,
  isMuted,
  weather,
  cleanView,
  onToggleCamera,
  onToggleHold,
  onToggleFreeze,
  onToggleWeather,
  onToggleMute,
  onToggleCleanView,
  onStrokeKoi,
  onFeedKoi,
  onOpenKoiPedia,
  onOpenSettings,
  onOpenGuide,
}) => {
  if (cleanView) return null;

  const getWeatherIcon = () => {
    switch (weather) {
      case 'Sunny':
        return <Sun className="w-4 h-4 text-amber-400" />;
      case 'Rain':
        return <CloudRain className="w-4 h-4 text-cyan-400" />;
      case 'Autumn':
        return <Leaf className="w-4 h-4 text-orange-400" />;
      case 'Winter':
        return <Snowflake className="w-4 h-4 text-blue-200" />;
      default:
        return <Sun className="w-4 h-4 text-amber-400" />;
    }
  };

  return (
    <nav
      aria-label="Garden Controls"
      className="fixed bottom-4 sm:bottom-6 right-4 sm:right-6 z-30 flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl glass shadow-2xl transition-all duration-300 max-w-[calc(100vw-32px)] overflow-x-auto"
    >
      {/* Camera Mode */}
      <button
        type="button"
        onClick={onToggleCamera}
        title={`Camera: ${cameraMode} (C)`}
        className="flex items-center gap-2 h-9 px-3 rounded-xl text-xs font-medium text-emerald-100/90 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
      >
        <Camera className="w-4 h-4" />
        <span className="hidden md:inline">{cameraMode}</span>
      </button>

      {/* Hold Shot */}
      <button
        type="button"
        onClick={onToggleHold}
        title="Hold Camera Shot (P)"
        aria-pressed={isHeld}
        className={`flex items-center gap-2 h-9 px-3 rounded-xl text-xs font-medium transition-all cursor-pointer ${
          isHeld
            ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
            : 'text-emerald-100/90 hover:bg-white/10 hover:text-white'
        }`}
      >
        <Lock className="w-4 h-4" />
        <span className="hidden lg:inline">{isHeld ? 'Holding' : 'Hold'}</span>
      </button>

      {/* Freeze Time */}
      <button
        type="button"
        onClick={onToggleFreeze}
        title="Freeze Time (O)"
        aria-pressed={isFrozen}
        className={`flex items-center gap-2 h-9 px-3 rounded-xl text-xs font-medium transition-all cursor-pointer ${
          isFrozen
            ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
            : 'text-emerald-100/90 hover:bg-white/10 hover:text-white'
        }`}
      >
        {isFrozen ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
        <span className="hidden lg:inline">{isFrozen ? 'Resume' : 'Freeze'}</span>
      </button>

      {/* Weather & Seasons */}
      <button
        type="button"
        onClick={onToggleWeather}
        title={`Season: ${weather} (T)`}
        className="flex items-center gap-2 h-9 px-3 rounded-xl text-xs font-medium text-emerald-100/90 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
      >
        {getWeatherIcon()}
        <span className="hidden md:inline">{weather}</span>
      </button>

      {/* Procedural Sound */}
      <button
        type="button"
        onClick={onToggleMute}
        title={isMuted ? 'Unmute Soundscape (M)' : 'Mute Soundscape (M)'}
        aria-pressed={!isMuted}
        className={`flex items-center gap-2 h-9 px-3 rounded-xl text-xs font-medium transition-all cursor-pointer ${
          !isMuted
            ? 'text-emerald-100/90 hover:bg-white/10 hover:text-white'
            : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
        }`}
      >
        {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-300" />}
        <span className="hidden lg:inline">{isMuted ? 'Muted' : 'Sound'}</span>
      </button>

      {/* Clean View */}
      <button
        type="button"
        onClick={onToggleCleanView}
        title="Clean View / Zen Mode (V or Esc)"
        className="flex items-center justify-center h-9 w-9 md:w-auto md:px-3 rounded-xl text-xs font-medium text-emerald-100/90 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
      >
        <Eye className="w-4 h-4" />
        <span className="hidden xl:inline">Zen View</span>
      </button>

      <div className="w-[1px] h-5 bg-white/15 mx-1" aria-hidden="true" />

      {/* Koi Encyclopedia */}
      <button
        type="button"
        onClick={onOpenKoiPedia}
        title="Koi Encyclopedia (18 Varieties)"
        className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium bg-emerald-950/60 text-emerald-200 border border-emerald-500/20 hover:bg-emerald-900/60 hover:text-white transition-all cursor-pointer"
      >
        <BookOpen className="w-4 h-4 text-emerald-400" />
        <span className="hidden sm:inline">Koi-Pedia</span>
      </button>

      {/* Stroke Koi */}
      <button
        type="button"
        onClick={onStrokeKoi}
        title="Gently Stroke a Koi (G)"
        className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium text-emerald-100/90 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
      >
        <Hand className="w-4 h-4 text-amber-300" />
        <span className="hidden sm:inline">Stroke</span>
      </button>

      {/* Feed Koi */}
      <button
        type="button"
        onClick={onFeedKoi}
        title="Feed the Koi (E)"
        className="flex items-center gap-2 h-9 px-3.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#f0894c] to-[#d9612b] hover:brightness-110 shadow-lg shadow-orange-950/40 transition-all cursor-pointer active:scale-95"
      >
        <Sparkles className="w-4 h-4" />
        <span>Feed Koi</span>
      </button>

      <div className="w-[1px] h-5 bg-white/15 mx-0.5" aria-hidden="true" />

      {/* Settings */}
      <button
        type="button"
        onClick={onOpenSettings}
        title="Garden Settings"
        className="flex items-center justify-center w-9 h-9 rounded-xl text-emerald-100/80 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
      >
        <Sliders className="w-4 h-4" />
      </button>

      {/* Guide */}
      <button
        type="button"
        onClick={onOpenGuide}
        title="Keyboard Shortcuts & Guide (I)"
        className="flex items-center justify-center w-9 h-9 rounded-xl text-emerald-100/80 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
    </nav>
  );
};
