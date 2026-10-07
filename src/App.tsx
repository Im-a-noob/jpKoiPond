import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  HelpCircle,
  Compass,
} from 'lucide-react';
import { KoiGardenCanvas } from './components/KoiGardenCanvas';
import { LoadingScreen } from './components/LoadingScreen';
import { KoiPediaModal } from './components/KoiPediaModal';
import { GuideModal } from './components/GuideModal';
import { KOI_COLLECTION_DATA } from './engine/koiData';
import { KoiInfo, WeatherMode, CameraMode, GardenHUDStats } from './types/garden';

export default function App() {
  const engineRef = useRef<any>(null);

  // Loading state
  const [loadProgress, setLoadProgress] = useState<number>(0);
  const [loadMessage, setLoadMessage] = useState<string>('Preparing garden environment...');
  const [isReady, setIsReady] = useState<boolean>(false);

  // UI state
  const [cleanView, setCleanView] = useState<boolean>(false);
  const [isKoiPediaOpen, setIsKoiPediaOpen] = useState<boolean>(false);
  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(false);

  // Engine state
  const [cameraMode, setCameraMode] = useState<CameraMode>('Cinematic');
  const [isHeld, setIsHeld] = useState<boolean>(false);
  const [isFrozen, setIsFrozen] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [weather, setWeather] = useState<WeatherMode>('Sunny');
  const [followedKoi, setFollowedKoi] = useState<KoiInfo | null>(null);
  const [fps, setFps] = useState<number>(60);
  const [timeOfDay, setTimeOfDay] = useState<string>('10:30');

  // Actions
  const handleToggleCamera = useCallback(() => {
    engineRef.current?.toggleCameraMode?.();
  }, []);

  const handleToggleHold = useCallback(() => {
    setIsHeld((prev) => {
      const next = !prev;
      engineRef.current?.setHold?.(next);
      return next;
    });
  }, []);

  const handleToggleFreeze = useCallback(() => {
    setIsFrozen((prev) => {
      const next = !prev;
      engineRef.current?.setFreeze?.(next);
      return next;
    });
  }, []);

  const handleToggleWeather = useCallback(() => {
    engineRef.current?.cycleWeather?.();
  }, []);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      engineRef.current?.setMuted?.(next);
      return next;
    });
  }, []);

  const handleStrokeKoi = useCallback(() => {
    engineRef.current?.stroke?.();
  }, []);

  const handleFeedKoi = useCallback(() => {
    engineRef.current?.feed?.();
  }, []);

  const handleFollowKoiById = useCallback((index: number) => {
    engineRef.current?.followKoi?.(index);
    setFollowedKoi(KOI_COLLECTION_DATA[index % KOI_COLLECTION_DATA.length]);
  }, []);

  // Global keybindings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'KeyV') {
        setCleanView((prev) => !prev);
      } else if (e.code === 'Escape') {
        if (isKoiPediaOpen) setIsKoiPediaOpen(false);
        else if (isGuideOpen) setIsGuideOpen(false);
        else if (cleanView) setCleanView(false);
      } else if (e.code === 'KeyI') {
        setIsGuideOpen((prev) => !prev);
      } else if (e.code === 'KeyK') {
        setIsKoiPediaOpen((prev) => !prev);
      } else if (e.code === 'KeyE') {
        handleFeedKoi();
      } else if (e.code === 'KeyG') {
        handleStrokeKoi();
      } else if (e.code === 'KeyC') {
        handleToggleCamera();
      } else if (e.code === 'KeyP') {
        handleToggleHold();
      } else if (e.code === 'KeyO') {
        handleToggleFreeze();
      } else if (e.code === 'KeyT') {
        handleToggleWeather();
      } else if (e.code === 'KeyM') {
        handleToggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    cleanView,
    isKoiPediaOpen,
    isGuideOpen,
    handleFeedKoi,
    handleStrokeKoi,
    handleToggleCamera,
    handleToggleHold,
    handleToggleFreeze,
    handleToggleWeather,
    handleToggleMute,
  ]);

  // Handle HUD stats emitted from engine
  const handleHUDStats = useCallback((stats: GardenHUDStats) => {
    if (typeof stats.fps === 'number') setFps(stats.fps);
    if (stats.cameraMode) setCameraMode(stats.cameraMode as CameraMode);
    if (stats.weather) setWeather(stats.weather as WeatherMode);
    if (typeof stats.timeOfDay === 'number') {
      const h = Math.floor(stats.timeOfDay);
      const m = Math.floor((stats.timeOfDay % 1) * 60);
      setTimeOfDay(`${h}:${String(m).padStart(2, '0')}`);
    } else if (typeof stats.timeOfDay === 'string') {
      setTimeOfDay(stats.timeOfDay);
    }
  }, []);

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
    <div className="relative w-screen h-screen overflow-hidden bg-[#0b1411] select-none">
      {/* Native WebGL Canvas Engine */}
      <KoiGardenCanvas
        engineRef={engineRef}
        onProgress={(p, msg) => {
          setLoadProgress(p);
          setLoadMessage(msg);
        }}
        onReady={() => {
          setIsReady(true);
        }}
        onHUDStats={handleHUDStats}
        onCameraModeChange={(mode) => setCameraMode(mode)}
        onWeatherChange={(w) => setWeather(w)}
        onMuteChange={(m) => setIsMuted(m)}
        onHoldChange={(h) => setIsHeld(h)}
        onFreezeChange={(f) => setIsFrozen(f)}
        onFollowKoi={(k) => setFollowedKoi(k)}
      />

      {/* Loading Screen Overlay */}
      <LoadingScreen
        progress={loadProgress}
        message={loadMessage}
        isReady={isReady}
      />

      {/* Clean Mode Exit Pill */}
      {cleanView && isReady && (
        <button
          type="button"
          onClick={() => setCleanView(false)}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full glass text-xs text-emerald-100/90 hover:text-white cursor-pointer transition-all border border-white/10 flex items-center gap-2 shadow-2xl"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Zen view · Press V or Esc to show controls</span>
        </button>
      )}

      {/* Floating Modern HUD & Telemetry */}
      {!cleanView && isReady && (
        <>
          <div className="fixed top-3 sm:top-4 left-3 sm:left-4 z-30 pointer-events-none p-2.5 sm:p-3 rounded-2xl glass text-[11px] font-mono tabular-nums text-emerald-100/80 space-y-1 border border-white/10 max-w-[280px]">
            <div className="flex items-center justify-between gap-4 font-semibold text-zinc-100">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                {fps} FPS
              </span>
              <span className="text-zinc-400 text-[10px]">60 FPS Native</span>
            </div>
            <div className="flex items-center justify-between text-zinc-300 text-[10px] pt-0.5 border-t border-white/10">
              <span>Time: {timeOfDay}</span>
              <span>Koi: 20</span>
              <span>{weather}</span>
            </div>
          </div>

          {/* Follow Koi Telemetry Card */}
          {followedKoi && (
            <div className="fixed top-3 sm:top-4 right-3 sm:right-4 z-30 p-3 sm:p-3.5 rounded-2xl glass border border-amber-500/30 text-xs shadow-xl animate-in fade-in duration-200 max-w-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    <Compass className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-serif text-sm text-zinc-100 flex items-center gap-1.5">
                      <span>{followedKoi.name}</span>
                      <span className="text-amber-400 font-mono text-xs">{followedKoi.kanji}</span>
                    </div>
                    <div className="text-[11px] text-emerald-300/80 font-mono">
                      {followedKoi.category} • {followedKoi.lengthCm} cm
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Floating Frosted Glass Action Toolbar */}
          <nav
            aria-label="Garden Controls"
            className="fixed bottom-4 sm:bottom-6 right-4 sm:right-6 z-30 flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl glass shadow-2xl transition-all duration-300 max-w-[calc(100vw-32px)] overflow-x-auto"
          >
            {/* Camera Mode */}
            <button
              type="button"
              onClick={handleToggleCamera}
              title={`Camera Mode: ${cameraMode} (C)`}
              className="flex items-center gap-2 h-9 px-3 rounded-xl text-xs font-medium text-emerald-100/90 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span className="hidden md:inline">{cameraMode}</span>
            </button>

            {/* Hold Shot */}
            <button
              type="button"
              onClick={handleToggleHold}
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
              onClick={handleToggleFreeze}
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

            {/* Weather / Seasons */}
            <button
              type="button"
              onClick={handleToggleWeather}
              title={`Cycle Season: ${weather} (T)`}
              className="flex items-center gap-2 h-9 px-3 rounded-xl text-xs font-medium text-emerald-100/90 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            >
              {getWeatherIcon()}
              <span className="hidden md:inline">{weather}</span>
            </button>

            {/* Soundscape Mute */}
            <button
              type="button"
              onClick={handleToggleMute}
              title={isMuted ? 'Unmute Soundscape (M)' : 'Mute Soundscape (M)'}
              className={`flex items-center gap-2 h-9 px-3 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                !isMuted
                  ? 'text-emerald-100/90 hover:bg-white/10 hover:text-white'
                  : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
              }`}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-300" />}
              <span className="hidden lg:inline">{isMuted ? 'Muted' : 'Sound'}</span>
            </button>

            {/* Zen View */}
            <button
              type="button"
              onClick={() => setCleanView(true)}
              title="Zen Clean View (V or Esc)"
              className="flex items-center justify-center h-9 w-9 md:w-auto md:px-3 rounded-xl text-xs font-medium text-emerald-100/90 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            >
              <Eye className="w-4 h-4" />
              <span className="hidden xl:inline">Zen View</span>
            </button>

            <div className="w-[1px] h-5 bg-white/15 mx-1" aria-hidden="true" />

            {/* Koi Encyclopedia */}
            <button
              type="button"
              onClick={() => setIsKoiPediaOpen(true)}
              title="Koi Encyclopedia (18 Varieties)"
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium bg-emerald-950/60 text-emerald-200 border border-emerald-500/20 hover:bg-emerald-900/60 hover:text-white transition-all cursor-pointer"
            >
              <BookOpen className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Koi-Pedia</span>
            </button>

            {/* Stroke Koi */}
            <button
              type="button"
              onClick={handleStrokeKoi}
              title="Gently Stroke a Koi (G)"
              className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium text-emerald-100/90 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            >
              <Hand className="w-4 h-4 text-amber-300" />
              <span className="hidden sm:inline">Stroke</span>
            </button>

            {/* Feed Koi */}
            <button
              type="button"
              onClick={handleFeedKoi}
              title="Feed the Koi (E)"
              className="flex items-center gap-2 h-9 px-3.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#f0894c] to-[#d9612b] hover:brightness-110 shadow-lg shadow-orange-950/40 transition-all cursor-pointer active:scale-95"
            >
              <Sparkles className="w-4 h-4" />
              <span>Feed Koi</span>
            </button>

            <div className="w-[1px] h-5 bg-white/15 mx-0.5" aria-hidden="true" />

            {/* Guide */}
            <button
              type="button"
              onClick={() => setIsGuideOpen(true)}
              title="Keyboard Shortcuts & Guide (I)"
              className="flex items-center justify-center w-9 h-9 rounded-xl text-emerald-100/80 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </nav>
        </>
      )}

      {/* Koi Encyclopedia Modal */}
      <KoiPediaModal
        isOpen={isKoiPediaOpen}
        onClose={() => setIsKoiPediaOpen(false)}
        onFollowKoi={handleFollowKoiById}
        activeFollowedKoi={followedKoi}
      />

      {/* Garden Guide Modal */}
      <GuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
    </div>
  );
}
